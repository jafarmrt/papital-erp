import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { deadLetterEvents, integrationDeliveryJobs, notifications, userMessengerLinks, users } from '../../db/schema.js';
import { DeadLetterQueueService } from '../../services/events/deadLetterQueueService.js';
import { IntegrationDeliveryService } from '../../services/events/integrationDelivery.service.js';
import { createNotifications } from '../../services/notifications/notificationCreator.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, runCase } from './fiscalClosingTests.js';
import { brief, clientFor, codeOf, inSandbox, TOKEN, withFakeBotApi, type FakeBotApi } from './messengerLinkTests.js';

/**
 * v10.1.41 (messenger notifications plan part 2, §2.3): an in-app notification reaches the recipient's linked Bale or
 * Telegram account. `createNotifications` queues one `messenger` job per active link in the notification's own
 * transaction; the delivery worker sends a personal Persian text with the app's link, retries a network error or 5xx,
 * closes the link on a 403 and moves any other refusal to the dead letter queue; a category the user turned off in the
 * profile stays in the bell only. Real routes on PostgreSQL in an isolated schema, the bot API replaced by a fake `fetch`;
 * each case is red on v10.1.38, which queues nothing and has no `messenger` job kind.
 */

const APP_URL = 'https://erp.example.test';

async function withAppUrl<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.APP_URL;
  process.env.APP_URL = APP_URL;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.APP_URL; else process.env.APP_URL = before;
  }
}

async function linkUser(userId: number, chatId: string): Promise<number> {
  const [link] = await orm.insert(userMessengerLinks).values({ userId, messenger: 'bale', chatId, chatName: 'test' }).returning({ id: userMessengerLinks.id });
  return link.id;
}

async function jobsOfLink(linkId: number) {
  return orm.select().from(integrationDeliveryJobs)
    .where(and(eq(integrationDeliveryJobs.kind, 'messenger'), eq(integrationDeliveryJobs.targetId, linkId)))
    .orderBy(integrationDeliveryJobs.id);
}

async function notify(userId: number, title: string, category: 'mention' | 'crm_followup' = 'crm_followup'): Promise<number> {
  const [id] = await orm.transaction(tx => createNotifications(tx, [{ userId, category, type: 'task', title, message: `${title} 42`, link: '/crm?activityId=9' }]));
  return id;
}

const sentTexts = (api: FakeBotApi) => api.calls.filter(c => c.url.endsWith('/sendMessage')).map(c => ({ chat: String(c.body.chat_id), text: String(c.body.text) }));

async function dueNow(jobId: number): Promise<void> {
  await orm.update(integrationDeliveryJobs).set({ nextAttemptAt: '2000-01-01 00:00:00' }).where(eq(integrationDeliveryJobs.id, jobId));
}

export async function runMessengerDeliveryTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const flowId = 'reg_messenger_notification_delivery';
  if (shouldRun(flowId, 'messenger')) {
    await runCase(results, flowId, 'v10.1.41: a daily log mention reaches the mentioned user\'s linked Bale account as a personal Persian message with the app link; a rolled-back write sends nothing; a category turned off in the profile stays in the bell only', async () => inSandbox(() => withAppUrl(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      const saved = await admin.put('/api/messenger/bots/bale', { token: TOKEN });
      if (saved.status !== 200) throw new Error(`bot: ${brief(saved)}`);
      const author = await clientFor(['daily_logs.view', 'daily_logs.create'], 'علی رضایی');
      const reader = await clientFor(['daily_logs.view'], 'زهرا احمدی');
      const linkId = await linkUser(reader.userId, '7001');

      const created = await author.post('/api/daily-logs', { title: 'بسته‌بندی سفارش 15', content: 'شرح', mentions: [reader.userId] });
      if (created.status !== 201 && created.status !== 200) throw new Error(`daily log: ${brief(created)}`);
      const [bell] = await orm.select().from(notifications).where(eq(notifications.userId, reader.userId));
      if (!bell) throw new Error('the mention has no bell row');
      const [job] = await jobsOfLink(linkId);
      if (!job || job.status !== 'pending' || job.eventId !== `notification:${bell.id}`) throw new Error(`the mention queued no messenger job: ${JSON.stringify(job ?? null)}`);

      await IntegrationDeliveryService.processDueJobs();
      const [sent] = sentTexts(api);
      if (!sent || sent.chat !== '7001') throw new Error(`nothing was sent to the linked chat: ${JSON.stringify(api.calls.map(c => c.url.split('/').pop()))}`);
      for (const part of ['زهرا احمدی،', 'به شما اشاره شد', `${APP_URL}/daily-logs`]) {
        if (!sent.text.includes(part)) throw new Error(`the message lacks «${part}»: ${sent.text}`);
      }
      // the log title and the author's name are typed by users: the messenger gets a fixed sentence and the section's page
      for (const part of ['بسته‌بندی', 'علی رضایی', '?id=', '15', '۱۵', 'FAKE']) {
        if (sent.text.includes(part)) throw new Error(`the message carries «${part}»: ${sent.text}`);
      }
      const [done] = await jobsOfLink(linkId);
      if (done.status !== 'succeeded') throw new Error(`the job must be succeeded, got ${done.status} ${done.lastError}`);

      const jobsBefore = (await jobsOfLink(linkId)).length;
      const bellBefore = (await orm.select().from(notifications).where(eq(notifications.userId, reader.userId))).length;
      await orm.transaction(async (tx) => {
        await createNotifications(tx, [{ userId: reader.userId, category: 'mention', type: 'mention', title: 'برگشت', message: 'برگشت' }]);
        throw new Error('rollback');
      }).catch(() => undefined);
      if ((await jobsOfLink(linkId)).length !== jobsBefore) throw new Error('a rolled-back notification queued a message');
      if ((await orm.select().from(notifications).where(eq(notifications.userId, reader.userId))).length !== bellBefore) throw new Error('a rolled-back notification left a bell row');

      const turnedOff = await reader.put('/api/messenger/preferences/mine', { category: 'mention', sendToMessenger: false });
      const offRow = (turnedOff.body as { data?: Array<{ category: string; sendToMessenger: boolean }> }).data?.find(r => r.category === 'mention');
      if (turnedOff.status !== 200 || offRow?.sendToMessenger !== false) throw new Error(`turn off: ${brief(turnedOff)}`);
      const unknown = await reader.put('/api/messenger/preferences/mine', { category: 'salary', sendToMessenger: false });
      if (unknown.status !== 400) throw new Error(`an unknown category must be 400: ${brief(unknown)}`);
      await notify(reader.userId, 'اشاره خاموش', 'mention');
      if ((await jobsOfLink(linkId)).length !== jobsBefore) throw new Error('a category turned off still queued a message');
      const followupTitle = 'پیگیری روشن';
      await notify(reader.userId, followupTitle, 'crm_followup');
      if ((await jobsOfLink(linkId)).length !== jobsBefore + 1) throw new Error('another category must still be queued');
      const listed = await reader.get('/api/messenger/preferences/mine');
      const rows = (listed.body as { data?: Array<{ category: string; sendToMessenger: boolean }> }).data ?? [];
      if (rows.find(r => r.category === 'mention')?.sendToMessenger !== false || rows.find(r => r.category === 'crm_won')?.sendToMessenger !== true
        || rows.find(r => r.category === 'payslip')?.sendToMessenger !== true || rows.find(r => r.category === 'workflow_task')?.sendToMessenger !== true) {
        throw new Error(`preferences: ${brief(listed)}`);
      }

      const unlinked = await clientFor(['daily_logs.view'], 'بی‌اتصال');
      await notify(unlinked.userId, 'بی اتصال');
      const stray = await orm.select().from(integrationDeliveryJobs).where(eq(integrationDeliveryJobs.kind, 'messenger'));
      if (stray.some(j => (j.event as { payload?: { userId?: number } }).payload?.userId === unlinked.userId)) throw new Error('a user without a link got a messenger job');
      return 'mention sent to the linked chat with the app link; rollback and a turned-off category queue nothing';
    }))));
  }

  const failId = 'reg_messenger_delivery_failures';
  if (shouldRun(failId, 'messenger')) {
    await runCase(results, failId, 'v10.1.41: a 5xx is retried later, a 403 closes the link (shown in the profile) and the job without a dead letter, any other refusal goes to the dead letter queue as a messenger delivery', async () => inSandbox(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      if ((await admin.put('/api/messenger/bots/bale', { token: TOKEN })).status !== 200) throw new Error('bot not saved');
      const user = await clientFor([], 'رضا کریمی');
      const linkId = await linkUser(user.userId, '8001');

      api.sendStatus = 502;
      await notify(user.userId, 'پیگیری یک');
      await IntegrationDeliveryService.processDueJobs();
      let [job] = await jobsOfLink(linkId);
      if (job.status !== 'pending' || job.attempts !== 1 || !job.lastError.includes('502')) throw new Error(`a 502 must be retried: ${job.status} ${job.attempts} ${job.lastError}`);
      if (job.lastError.includes('FAKE')) throw new Error('the token reached the error text');

      api.sendStatus = 403;
      await dueNow(job.id);
      await IntegrationDeliveryService.processDueJobs();
      [job] = await jobsOfLink(linkId);
      if (job.status !== 'cancelled') throw new Error(`a 403 must close the job, got ${job.status}`);
      const [link] = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.id, linkId));
      if (link.isActive !== 0 || link.unlinkReason !== 'blocked') throw new Error(`a 403 must close the link as blocked: ${JSON.stringify(link)}`);
      const mine = await user.get('/api/messenger/links/mine');
      const bale = (mine.body as { data?: Array<{ messenger: string; linked: boolean; lastUnlink?: { reason?: string } }> }).data?.find(l => l.messenger === 'bale');
      if (bale?.linked !== false || bale.lastUnlink?.reason !== 'blocked') throw new Error(`the profile must show the block: ${brief(mine)}`);
      if ((await orm.select().from(deadLetterEvents)).length !== 0) throw new Error('a blocked bot must not fill the dead letter queue');

      const relinkId = await linkUser(user.userId, '8002');
      api.sendStatus = 400;
      const notificationId = await notify(user.userId, 'پیگیری دو');
      await IntegrationDeliveryService.processDueJobs();
      const [failed] = await jobsOfLink(relinkId);
      if (failed.status !== 'failed') throw new Error(`a 400 must fail at once, got ${failed.status} after ${failed.attempts}`);
      const [dead] = await orm.select().from(deadLetterEvents).where(eq(deadLetterEvents.originalEventId, `notification:${notificationId}#messenger:${relinkId}`));
      if (!dead || dead.source !== 'messenger') throw new Error(`the failed message must be in the dead letter queue as a messenger delivery: ${JSON.stringify(dead ?? null)}`);

      const closedCode = await user.del('/api/messenger/links/bale');
      if (closedCode.status !== 200) throw new Error(`unlink: ${brief(closedCode)} ${codeOf(closedCode)}`);
      api.sendStatus = 200;
      await orm.update(integrationDeliveryJobs).set({ status: 'pending', nextAttemptAt: '2000-01-01 00:00:00' }).where(eq(integrationDeliveryJobs.id, failed.id));
      const callsBefore = sentTexts(api).length;
      await IntegrationDeliveryService.processDueJobs();
      const [closed] = await jobsOfLink(relinkId);
      if (closed.status !== 'cancelled' || sentTexts(api).length !== callsBefore) throw new Error(`a job of a closed link must be cancelled unsent, got ${closed.status}`);
      return '502 retried, 403 closed the link, 400 in the dead letter queue, a closed link sends nothing';
    })));
  }

  const reviewId = 'reg_messenger_delivery_review_fixes';
  if (shouldRun(reviewId, 'messenger')) {
    await runCase(results, reviewId, 'v10.1.41: a messenger dead letter is replayed and requeued as its own delivery, never through the event bus; a user deleted or a category turned off after queueing sends nothing and deleting a user closes their links; a 429 waits for its retry_after; a messenger job has ten attempts', async () => inSandbox(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      if ((await admin.put('/api/messenger/bots/bale', { token: TOKEN })).status !== 200) throw new Error('bot not saved');
      const user = await clientFor([], 'نرگس کاظمی');
      const linkId = await linkUser(user.userId, '9001');

      api.sendStatus = 400;
      const firstId = await notify(user.userId, 'پیگیری صف');
      await IntegrationDeliveryService.processDueJobs();
      const [failed] = await jobsOfLink(linkId);
      if (failed.maxAttempts !== 10) throw new Error(`a messenger job must have 10 attempts, got ${failed.maxAttempts}`);
      const deadOf = async (notificationId: number) => (await orm.select().from(deadLetterEvents).where(eq(deadLetterEvents.originalEventId, `notification:${notificationId}#messenger:${linkId}`)))[0];
      const dead = await deadOf(firstId);
      if (!dead) throw new Error('no dead letter for the refused message');
      api.sendStatus = 200;
      const sentBefore = sentTexts(api).length;
      const replayed = await DeadLetterQueueService.replayEvent(dead.id);
      const [afterReplay] = await jobsOfLink(linkId);
      if (!replayed.success || sentTexts(api).length !== sentBefore + 1 || afterReplay.status !== 'succeeded') {
        throw new Error(`the replay must send the message itself: ${replayed.message}, sent ${sentTexts(api).length - sentBefore}, job ${afterReplay.status}`);
      }

      api.sendStatus = 400;
      const secondId = await notify(user.userId, 'پیگیری صف دو');
      await IntegrationDeliveryService.processDueJobs();
      if (!(await deadOf(secondId))) throw new Error('no dead letter for the second message');
      const requeued = await orm.transaction(tx => DeadLetterQueueService.requeueUnresolvedToOutbox(tx));
      const [, secondJob] = await jobsOfLink(linkId);
      const outbox = await orm.execute(sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_id LIKE ${`notification:${secondId}%`}`);
      if (requeued.requeuedCount !== 1 || secondJob.status !== 'pending' || Number((outbox.rows[0] as { n: number }).n) !== 0) {
        throw new Error(`the requeue must put the delivery back in its own queue: ${JSON.stringify(requeued)} job ${secondJob.status}`);
      }
      api.sendStatus = 200;

      await orm.update(integrationDeliveryJobs).set({ status: 'succeeded' }).where(eq(integrationDeliveryJobs.id, secondJob.id));
      await user.put('/api/messenger/preferences/mine', { category: 'crm_followup', sendToMessenger: true });
      await notify(user.userId, 'خاموش پس از صف');
      await user.put('/api/messenger/preferences/mine', { category: 'crm_followup', sendToMessenger: false });
      await IntegrationDeliveryService.processDueJobs();
      const offJob = (await jobsOfLink(linkId)).at(-1);
      if (offJob?.status !== 'cancelled') throw new Error(`a category turned off after queueing must not send: ${offJob?.status}`);
      await user.put('/api/messenger/preferences/mine', { category: 'crm_followup', sendToMessenger: true });

      api.sendStatus = 429;
      api.sendRetryAfter = 120;
      await notify(user.userId, 'محدودیت');
      await IntegrationDeliveryService.processDueJobs();
      const limited = (await jobsOfLink(linkId)).at(-1);
      const waitSeconds = (Date.parse(`${String(limited?.nextAttemptAt).replace(' ', 'T')}Z`) - Date.now()) / 1000;
      if (limited?.status !== 'pending' || waitSeconds < 100) throw new Error(`a 429 must wait for its retry_after: ${limited?.status} in ${Math.round(waitSeconds)} s`);
      api.sendStatus = 200;

      await orm.update(users).set({ isDeleted: 1 }).where(eq(users.id, user.userId));
      if (limited) await dueNow(limited.id);
      const before = sentTexts(api).length;
      await IntegrationDeliveryService.processDueJobs();
      const deletedJob = (await jobsOfLink(linkId)).at(-1);
      if (deletedJob?.status !== 'cancelled' || sentTexts(api).length !== before) throw new Error(`a deleted user's queued message must not be sent: ${deletedJob?.status}`);
      await orm.update(users).set({ isDeleted: 0 }).where(eq(users.id, user.userId));

      const removed = await admin.del(`/api/users/${user.userId}`);
      if (removed.status !== 200) throw new Error(`delete user: ${brief(removed)}`);
      const [link] = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.id, linkId));
      if (link.isActive !== 0 || link.unlinkReason !== 'user_deleted') throw new Error(`deleting a user must close their link: ${JSON.stringify(link)}`);
      return 'replay sent the message, requeue went to its own queue; turned off, deleted and 429 cases held; link closed on delete';
    })));
  }

  const editedId = 'reg_messenger_dlq_replay_rebuilds_payload';
  if (shouldRun(editedId, 'messenger')) {
    await runCase(results, editedId, 'v10.1.41: replaying a messenger dead letter whose payload was edited, or with a payload passed to the replay, sends the text and link rebuilt from the notification, never the edited ones, and keeps the queued category; a job whose notification is gone is closed unsent', async () => inSandbox(() => withAppUrl(() => withFakeBotApi(async (api) => {
      const admin = await clientFor('admin');
      if ((await admin.put('/api/messenger/bots/bale', { token: TOKEN })).status !== 200) throw new Error('bot not saved');
      const user = await clientFor([], 'مریم صادقی');
      const linkId = await linkUser(user.userId, '9101');
      const forged = { notificationId: 1, userId: user.userId, messenger: 'bale', category: 'workflow_sla', text: 'مبلغ 5000000 ریال واریز شد EDITED', link: 'https://evil.example/pay' };

      api.sendStatus = 400;
      const notificationId = await notify(user.userId, 'پیگیری ویرایش');
      await IntegrationDeliveryService.processDueJobs();
      const [dead] = await orm.select().from(deadLetterEvents).where(eq(deadLetterEvents.originalEventId, `notification:${notificationId}#messenger:${linkId}`));
      if (!dead) throw new Error('no dead letter for the refused message');
      await DeadLetterQueueService.editPayload(dead.id, forged);
      api.sendStatus = 200;
      const before = sentTexts(api).length;
      const replayed = await DeadLetterQueueService.replayEvent(dead.id, forged);
      const sent = sentTexts(api).slice(before);
      if (!replayed.success || sent.length !== 1) throw new Error(`the replay must send one message: ${replayed.message}, sent ${sent.length}`);
      for (const part of ['EDITED', '5000000', 'evil.example']) {
        if (sent[0].text.includes(part)) throw new Error(`the replay sent the edited payload («${part}»): ${sent[0].text}`);
      }
      for (const part of ['مریم صادقی،', `${APP_URL}/crm`]) {
        if (!sent[0].text.includes(part)) throw new Error(`the rebuilt message lacks «${part}»: ${sent[0].text}`);
      }
      const [job] = await jobsOfLink(linkId);
      const stored = (job.event as { payload?: { category?: string; text?: string } }).payload;
      if (job.status !== 'succeeded' || stored?.category !== 'crm_followup' || String(stored?.text).includes('EDITED')) {
        throw new Error(`the job must keep its own category and text: ${job.status} ${JSON.stringify(stored)}`);
      }

      api.sendStatus = 400;
      const goneId = await notify(user.userId, 'پیگیری حذف‌شده');
      await IntegrationDeliveryService.processDueJobs();
      const [goneDead] = await orm.select().from(deadLetterEvents).where(eq(deadLetterEvents.originalEventId, `notification:${goneId}#messenger:${linkId}`));
      if (!goneDead) throw new Error('no dead letter for the second message');
      await orm.delete(notifications).where(eq(notifications.id, goneId));
      api.sendStatus = 200;
      const beforeGone = sentTexts(api).length;
      await DeadLetterQueueService.replayEvent(goneDead.id, forged).catch(() => undefined);
      const goneJob = (await jobsOfLink(linkId)).at(-1);
      if (sentTexts(api).length !== beforeGone || goneJob?.status !== 'cancelled') throw new Error(`a job without its notification must be closed unsent: ${goneJob?.status}`);
      return 'edited payload ignored, text and link rebuilt from the notification; a missing notification closes the job';
    }))));
  }

  return results;
}
