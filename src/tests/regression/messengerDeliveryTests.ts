import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { deadLetterEvents, integrationDeliveryJobs, notifications, userMessengerLinks } from '../../db/schema.js';
import { IntegrationDeliveryService } from '../../services/events/integrationDelivery.service.js';
import { createNotifications } from '../../services/notifications/notificationCreator.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, runCase } from './fiscalClosingTests.js';
import { brief, clientFor, codeOf, inSandbox, TOKEN, withFakeBotApi, type FakeBotApi } from './messengerLinkTests.js';

/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): an in-app notification reaches the recipient's linked Bale or
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
    await runCase(results, flowId, 'v10.1.39: a daily log mention reaches the mentioned user\'s linked Bale account as a personal Persian message with the app link; a rolled-back write sends nothing; a category turned off in the profile stays in the bell only', async () => inSandbox(() => withAppUrl(() => withFakeBotApi(async (api) => {
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
      for (const part of ['زهرا احمدی،', 'اشاره در گزارش کار روزانه', 'علی رضایی', '۱۵', `${APP_URL}/daily-logs?id=`]) {
        if (!sent.text.includes(part)) throw new Error(`the message lacks «${part}»: ${sent.text}`);
      }
      if (/15|FAKE/.test(sent.text.replace(APP_URL, '').replace(/\?id=\d+/, ''))) throw new Error(`the message has Latin digits or a token: ${sent.text}`);
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
      if (rows.find(r => r.category === 'mention')?.sendToMessenger !== false || rows.find(r => r.category === 'payslip')?.sendToMessenger !== true) {
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
    await runCase(results, failId, 'v10.1.39: a 5xx is retried later, a 403 closes the link (shown in the profile) and the job without a dead letter, any other refusal goes to the dead letter queue as a messenger delivery', async () => inSandbox(() => withFakeBotApi(async (api) => {
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

  return results;
}
