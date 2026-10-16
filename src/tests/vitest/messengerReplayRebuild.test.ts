import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { DbExecutor } from '../../db/drizzle';
import { messengerJobNotificationId, rebuildMessengerJobEvent } from '../../services/notifications/notificationCreator';

/**
 * v10.1.41 (messenger notifications plan part 2, review): a dead letter replay of a messenger job never sends the payload it
 * is given or that was edited in the dead letter queue; the text, link and category are rebuilt from the notification row,
 * the recipient and the category the job was queued with. Before, `replayDeadJob` sent `{ ...event, payload }` as is, so an
 * edited dead letter could put any text, amount or address into a staff member's Bale or Telegram chat.
 */
const ROOT = path.resolve(__dirname, '../../..');

/** A select chain that answers each `select` with the next row list, whatever joins and conditions follow */
function fakeExecutor(answers: unknown[][]): DbExecutor {
  let call = 0;
  const select = () => {
    const rows = answers[call++] ?? [];
    const chain: Record<string, unknown> = {};
    for (const step of ['from', 'leftJoin', 'innerJoin', 'where']) chain[step] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };
  return { select } as unknown as DbExecutor;
}

const NOTIFICATION = { userId: 7, title: 'پیگیری تماس با مشتری', message: 'تماس با شرکت نمونه 42', link: '/crm?activityId=9', recipientName: 'زهرا احمدی' };
const FORGED = { notificationId: 99, userId: 7, messenger: 'bale', category: 'workflow_sla', text: 'مبلغ 5000000 ریال EDITED', link: 'https://evil.example/pay' };

describe('messenger dead letter replay rebuilds its payload', () => {
  it('reads the notification id only from the job event id', () => {
    expect(messengerJobNotificationId('notification:42')).toBe(42);
    expect(messengerJobNotificationId('notification:0')).toBeNull();
    expect(messengerJobNotificationId('notification:42#messenger:3')).toBeNull();
    expect(messengerJobNotificationId('evt-1')).toBeNull();
  });

  it('writes the text and link from the notification and keeps the queued category, whatever the job payload says', async () => {
    const executor = fakeExecutor([[NOTIFICATION], [{ userId: 7, messenger: 'bale' }]]);
    const event = await rebuildMessengerJobEvent(executor, {
      eventId: 'notification:42', targetId: 3,
      event: { payload: { ...FORGED, category: 'crm_followup' } },
    });
    expect(event?.payload.notificationId).toBe(42);
    expect(event?.payload.category).toBe('crm_followup');
    expect(event?.payload.link).toBe('/crm');
    expect(event?.payload.text).toContain('زهرا احمدی،');
    for (const part of ['EDITED', '5000000', 'evil.example', 'شرکت نمونه']) expect(event?.payload.text).not.toContain(part);
  });

  it('reads an unknown queued category as a fixed sentence', async () => {
    const executor = fakeExecutor([[NOTIFICATION], [{ userId: 7, messenger: 'bale' }]]);
    const event = await rebuildMessengerJobEvent(executor, { eventId: 'notification:42', targetId: 3, event: { payload: { category: 'salary' } } });
    expect(event?.payload.category).toBe('event_rule');
    expect(event?.payload.text).not.toContain('شرکت نمونه');
  });

  it('gives nothing when the notification or the link is gone, or the link is another user\'s', async () => {
    expect(await rebuildMessengerJobEvent(fakeExecutor([[]]), { eventId: 'notification:42', targetId: 3, event: {} })).toBeNull();
    expect(await rebuildMessengerJobEvent(fakeExecutor([[NOTIFICATION], []]), { eventId: 'notification:42', targetId: 3, event: {} })).toBeNull();
    expect(await rebuildMessengerJobEvent(fakeExecutor([[NOTIFICATION], [{ userId: 8, messenger: 'bale' }]]), { eventId: 'notification:42', targetId: 3, event: {} })).toBeNull();
  });

  it('the replay of a messenger job goes through the rebuild, never the given payload', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/services/events/integrationDelivery.service.ts'), 'utf8');
    const replay = source.slice(source.indexOf('static async replayDeadJob'), source.indexOf('static async requeueDeadJobs'));
    expect(replay).toMatch(/job\.kind === MESSENGER_DELIVERY_KIND \? await messengerReplayEvent\(job\)/);
    expect(source).toMatch(/rebuildMessengerJobEvent\(orm, job\)/);
  });
});
