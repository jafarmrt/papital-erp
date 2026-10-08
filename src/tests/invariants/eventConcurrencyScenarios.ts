import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { deadLetterEvents } from '../../db/schema.js';
import { DeadLetterQueueService } from '../../services/events/deadLetterQueueService.js';
import { domainEventBus } from '../../services/events/domainEventBus.js';
import { getErrorMessage } from '../../utils/formatters.js';

/**
 * v8.0.75 — سناریوهای سخت‌گیرانه صف خطای رویدادها (DLQ) حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

type Settled = { ok: true } | { ok: false; message: string };

function settle(run: Promise<unknown>): Promise<Settled> {
  return run.then(() => ({ ok: true as const }), (err: unknown) => ({ ok: false as const, message: getErrorMessage(err) }));
}

/**
 * گرداننده آزمونی یک نوع رویداد که اجراهایش را می‌شمارد و تا `release` منتظر می‌ماند — یعنی بازپخش در میانه اجرای
 * گرداننده (مثل فراخوانی وب‌هوک) نگه داشته می‌شود تا کار هم‌زمان دیگر روی همان ردیف آزموده شود.
 */
function gatedHandler(eventType: string) {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiters: Array<{ n: number; resolve: () => void }> = [];
  domainEventBus.subscribe(eventType, async () => {
    runs++;
    for (const w of waiters) if (runs >= w.n) w.resolve();
    await gate;
  }, `inv_td_342_${eventType}`);
  return {
    runs: () => runs,
    reached: (n: number) => (runs >= n ? Promise.resolve() : new Promise<void>(resolve => { waiters.push({ n, resolve }); })),
    release: () => release(),
  };
}

async function quarantine(eventType: string, tag: string) {
  return DeadLetterQueueService.moveToDeadLetter({
    originalEventId: `inv_td_342_${tag}`, eventType, aggregateType: 'Document', aggregateId: '1', source: 'manual',
    payload: { tag }, metadata: { timestamp: new Date().toISOString() }, failureReason: 'آزمون TD-342',
  });
}

async function statusOf(id: number): Promise<string | undefined> {
  const [row] = await orm.select({ status: deadLetterEvents.status }).from(deadLetterEvents).where(eq(deadLetterEvents.id, id));
  return row?.status;
}

class RollbackProbe extends Error {}

/** بازگردانی گروهی DLQ به Outbox در تراکنشی که برگردانده می‌شود: شناسه ردیف‌هایی که برمی‌گزید */
async function requeuedIdsDryRun(): Promise<number[]> {
  let ids: number[] = [];
  await orm.transaction(async tx => {
    ids = (await DeadLetterQueueService.requeueUnresolvedToOutbox(tx)).dlqIds;
    throw new RollbackProbe();
  }).catch((err: unknown) => {
    if (!(err instanceof RollbackProbe)) throw err;
  });
  return ids;
}

/**
 * TD-342: یک رویداد صف خطا (DLQ) فقط یک بار بازپخش می‌شود. پیش‌تر بازپخش دوم هم‌زمان (در میانه اجرای گرداننده‌ها)
 * گرداننده‌ها را دوباره اجرا می‌کرد، رویداد «بازپخش‌شده» پشت هم دوباره بازپخش می‌شد، صرف‌نظر هم‌زمان با بازپخش
 * پذیرفته می‌شد و بازگردانی گروهی به Outbox همان رویداد در حال بازپخش را هم برمی‌داشت (اجرای دوباره در Outbox).
 */
export async function checkDlqReplayedOnce(): Promise<string[]> {
  const problems: string[] = [];
  const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const eventType = `InvTd342Replay_${tag}`;
  const handler = gatedHandler(eventType);
  const row = await quarantine(eventType, tag);

  // ۱) در میانه بازپخش اول: بازپخش دوم، بازگردانی گروهی و صرف‌نظر
  const first = settle(DeadLetterQueueService.replayEvent(row.id));
  let second: Promise<Settled> = Promise.resolve({ ok: true });
  try {
    await handler.reached(1);
    second = settle(DeadLetterQueueService.replayEvent(row.id));
    const secondEarly = await Promise.race([second, handler.reached(2).then(() => null)]);
    if (secondEarly === null) problems.push('The concurrent second replay ran the event handler again');
    else if (secondEarly.ok || !secondEarly.message.includes('در حال بازپخش')) {
      problems.push(`the concurrent second replay was not refused with the message "being replayed" (${secondEarly.ok ? 'accepted' : secondEarly.message})`);
    }
    const requeued = await requeuedIdsDryRun();
    if (requeued.includes(row.id)) problems.push('The bulk requeue to the Outbox also took the event being replayed');
    const dismiss = await settle(DeadLetterQueueService.dismissEvent(row.id));
    if (dismiss.ok) problems.push('A dismiss concurrent with the replay was accepted');
  } finally {
    handler.release();
  }
  const outcomes = await Promise.all([first, second]);
  if (!outcomes[0].ok) problems.push(`The first replay was not accepted (${outcomes[0].message})`);
  const accepted = outcomes.filter(o => o.ok).length;
  if (accepted !== 1) problems.push(`${accepted} of two concurrent replays were accepted, not one`);
  if (handler.runs() !== 1) problems.push(`The event handler ran ${handler.runs()} times, not once`);
  const afterRace = await statusOf(row.id);
  if (afterRace !== 'replayed') problems.push(`Status after the replay is "${afterRace}", not replayed`);

  // ۲) پشت هم: رویداد بازپخش‌شده دوباره بازپخش یا صرف‌نظر نمی‌شود
  const again = await settle(DeadLetterQueueService.replayEvent(row.id));
  if (again.ok || !again.message.includes('پیش‌تر بازپخش')) problems.push(`replaying an already replayed event again was not refused (${again.ok ? 'accepted' : again.message})`);
  const lateDismiss = await settle(DeadLetterQueueService.dismissEvent(row.id));
  if (lateDismiss.ok) problems.push('Dismissing a replayed event was accepted');
  if (handler.runs() !== 1) problems.push(`After the repeated replay the handler has run ${handler.runs()} times, not once`);
  const final = await statusOf(row.id);
  if (final !== 'replayed') problems.push(`Final status is "${final}", not replayed`);

  // ۳) رویداد صرف‌نظرشده را می‌توان یک بار بازپخش کرد
  const dismissedRow = await quarantine(eventType, `${tag}_d`);
  const dismissed = await settle(DeadLetterQueueService.dismissEvent(dismissedRow.id));
  if (!dismissed.ok) problems.push(`Dismissing a quarantined event was not accepted (${dismissed.message})`);
  const replayDismissed = await settle(DeadLetterQueueService.replayEvent(dismissedRow.id));
  if (!replayDismissed.ok) problems.push(`Replaying a dismissed event was not accepted (${replayDismissed.message})`);
  if (handler.runs() !== 2) problems.push(`Replaying the dismissed event did not run the handler once (total runs ${handler.runs()}, not 2)`);
  return problems;
}
