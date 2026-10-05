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
    if (secondEarly === null) problems.push('بازپخش دوم هم‌زمان گرداننده رویداد را دوباره اجرا کرد');
    else if (secondEarly.ok || !secondEarly.message.includes('در حال بازپخش')) {
      problems.push(`بازپخش دوم هم‌زمان با پیام «در حال بازپخش» رد نشد (${secondEarly.ok ? 'پذیرفته شد' : secondEarly.message})`);
    }
    const requeued = await requeuedIdsDryRun();
    if (requeued.includes(row.id)) problems.push('بازگردانی گروهی به Outbox رویداد در حال بازپخش را هم برداشت');
    const dismiss = await settle(DeadLetterQueueService.dismissEvent(row.id));
    if (dismiss.ok) problems.push('صرف‌نظر هم‌زمان با بازپخش پذیرفته شد');
  } finally {
    handler.release();
  }
  const outcomes = await Promise.all([first, second]);
  if (!outcomes[0].ok) problems.push(`بازپخش اول پذیرفته نشد (${outcomes[0].message})`);
  const accepted = outcomes.filter(o => o.ok).length;
  if (accepted !== 1) problems.push(`از دو بازپخش هم‌زمان ${accepted} پذیرفته شد، نه یکی`);
  if (handler.runs() !== 1) problems.push(`گرداننده رویداد ${handler.runs()} بار اجرا شد، نه یک بار`);
  const afterRace = await statusOf(row.id);
  if (afterRace !== 'replayed') problems.push(`وضعیت پس از بازپخش «${afterRace}» است، نه replayed`);

  // ۲) پشت هم: رویداد بازپخش‌شده دوباره بازپخش یا صرف‌نظر نمی‌شود
  const again = await settle(DeadLetterQueueService.replayEvent(row.id));
  if (again.ok || !again.message.includes('پیش‌تر بازپخش')) problems.push(`بازپخش دوباره رویداد بازپخش‌شده رد نشد (${again.ok ? 'پذیرفته شد' : again.message})`);
  const lateDismiss = await settle(DeadLetterQueueService.dismissEvent(row.id));
  if (lateDismiss.ok) problems.push('صرف‌نظر از رویداد بازپخش‌شده پذیرفته شد');
  if (handler.runs() !== 1) problems.push(`پس از بازپخش دوباره گرداننده ${handler.runs()} بار اجرا شده است، نه یک بار`);
  const final = await statusOf(row.id);
  if (final !== 'replayed') problems.push(`وضعیت نهایی «${final}» است، نه replayed`);

  // ۳) رویداد صرف‌نظرشده را می‌توان یک بار بازپخش کرد
  const dismissedRow = await quarantine(eventType, `${tag}_d`);
  const dismissed = await settle(DeadLetterQueueService.dismissEvent(dismissedRow.id));
  if (!dismissed.ok) problems.push(`صرف‌نظر از رویداد قرنطینه پذیرفته نشد (${dismissed.message})`);
  const replayDismissed = await settle(DeadLetterQueueService.replayEvent(dismissedRow.id));
  if (!replayDismissed.ok) problems.push(`بازپخش رویداد صرف‌نظرشده پذیرفته نشد (${replayDismissed.message})`);
  if (handler.runs() !== 2) problems.push(`بازپخش رویداد صرف‌نظرشده گرداننده را یک بار اجرا نکرد (جمع اجراها ${handler.runs()}، نه ۲)`);
  return problems;
}
