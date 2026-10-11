import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { notifications } from '../../db/schema.js';

/**
 * v10.0.248 (TD-960, OBS-R2-01): the bell's writes moved from the route to `notificationInbox.service.ts` with the same
 * behaviour: «read» and «read all» change only the caller's own notifications, and dismissal keeps the row.
 */
export async function runNotificationReadScopeTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const id = 'reg_notification_writes_in_service_td_960';
  if (!shouldRun(id, 'td960', 'notifications', 'routeWrites')) return [];
  const name = 'v10.0.248: marking one or all notifications read and dismissing one change only the caller\'s own rows (TD-960)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const ids: number[] = [];
  try {
    const owner = await h.sessionWith(['crm.view']);
    const other = await h.sessionWith(['crm.view']);
    const make = async (userId: number, title: string) => {
      const [row] = await orm.insert(notifications).values({ userId, type: 'td960', title, message: title }).returning({ id: notifications.id });
      ids.push(row.id);
      return row.id;
    };
    const ownA = await make(owner.userId, `TD960 own A ${h.tag}`);
    const ownB = await make(owner.userId, `TD960 own B ${h.tag}`);
    const foreign = await make(other.userId, `TD960 other ${h.tag}`);
    const state = async (rowId: number) => {
      const [row] = await orm.select({ isRead: notifications.isRead, dismissedAt: notifications.dismissedAt }).from(notifications).where(eq(notifications.id, rowId));
      return row;
    };
    const wrong: string[] = [];

    await h.put(`/api/notifications/${foreign}/read`, {}, owner);
    if ((await state(foreign))?.isRead !== 0) wrong.push('another user marked a foreign notification read');
    const one = await h.put(`/api/notifications/${ownA}/read`, {}, owner);
    if (one.status !== 200 || (await state(ownA))?.isRead !== 1) wrong.push(`marking own notification read answered ${one.status}`);
    if ((await state(ownB))?.isRead !== 0) wrong.push('marking one notification read changed another one');

    const all = await h.put('/api/notifications/read-all', {}, owner);
    if (all.status !== 200 || (await state(ownB))?.isRead !== 1) wrong.push(`read-all answered ${all.status} and left own rows unread`);
    if ((await state(foreign))?.isRead !== 0) wrong.push('read-all changed another user\'s notification');

    await h.del(`/api/notifications/${foreign}`, owner);
    if ((await state(foreign))?.dismissedAt !== null) wrong.push('another user dismissed a foreign notification');
    const dismissed = await h.del(`/api/notifications/${ownA}`, owner);
    const kept = await state(ownA);
    if (dismissed.status !== 200 || !kept || kept.dismissedAt === null) wrong.push(`dismissal answered ${dismissed.status} and left ${JSON.stringify(kept)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'read, read-all and dismiss touched only the caller\'s rows' })];
  } catch (err) {
    return [makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err) })];
  } finally {
    if (ids.length > 0) await orm.delete(notifications).where(inArray(notifications.id, ids)).catch(() => undefined);
    await h.cleanup();
  }
}
