import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, deadLetterEvents, outboxEvents } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-716 / B15-14: the payload of a replayed DLQ row is never edited, an edit of an
 * open row is locked and audited and touches the outbox row only while it has not completed, and «تلاش دوباره» of a
 * failed outbox event resolves its DLQ row in the same transaction and never re-runs a completed event. On v9.0.431 the
 * payload of a replayed row and of its completed outbox row were both rewritten with no audit row, retrying left the DLQ
 * row quarantined, and a completed event could be retried.
 */
export async function runDeadLetterEditRetryTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_dlq_payload_edit_and_outbox_retry_td_716';
  if (!shouldRun(id, 'td716', 'b15-14', 'dlq', 'outbox', 'package15')) return results;

  const name = 'v9.0.432: a replayed DLQ row is never edited, an open row\'s edit is audited and spares a completed outbox row, and an outbox retry resolves its DLQ row and refuses a completed event (TD-716)';
  const tStart = Date.now();
  const tag = `td716_${Date.now()}`;
  const eventIds: string[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const send = (method: 'post' | 'put', url: string, body: object) =>
      request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];

    const seed = async (suffix: string, outboxStatus: string, dlqStatus: string) => {
      const eventId = `${tag}_${suffix}`;
      eventIds.push(eventId);
      await orm.insert(outboxEvents).values({ eventId, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '1', status: outboxStatus, payload: { amount: 5_000_000 } });
      const [row] = await orm.insert(deadLetterEvents).values({
        originalEventId: eventId, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '1', source: 'outbox',
        payload: { amount: 5_000_000 }, failureReason: 'test failure', status: dlqStatus,
      }).returning({ id: deadLetterEvents.id });
      return { eventId, dlqId: row.id };
    };
    const outboxOf = async (eventId: string) => (await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, eventId)))[0];
    const dlqOf = async (dlqId: number) => (await orm.select().from(deadLetterEvents).where(eq(deadLetterEvents.id, dlqId)))[0];
    const auditsOf = async (dlqId: number) => orm.select({ details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'صف خطاهای قرنطینه (DLQ)'), eq(activityLogs.entityId, String(dlqId)), like(activityLogs.description, '%InvoiceApproved%')));

    // 1. a replayed row (its event ran and completed) is never edited
    const replayed = await seed('replayed', 'completed', 'replayed');
    const refused = await send('put', `/api/events/dlq/${replayed.dlqId}/payload`, { payload: { amount: 1 } });
    if (refused.status !== 409 || refused.body?.code !== 'DLQ_EVENT_REPLAYED') wrong.push(`edit replayed row: ${refused.status} ${refused.body?.code}`);
    if (((await outboxOf(replayed.eventId))?.payload as { amount?: number })?.amount !== 5_000_000 || ((await dlqOf(replayed.dlqId))?.payload as { amount?: number })?.amount !== 5_000_000) wrong.push('the replayed row or its completed outbox row was rewritten');
    if ((await auditsOf(replayed.dlqId)).length !== 0) wrong.push('a refused edit wrote an audit row');

    // 2. an open row is edited with an audit row (before / after), and its failed outbox row follows
    const open = await seed('open', 'failed', 'quarantined');
    const edited = await send('put', `/api/events/dlq/${open.dlqId}/payload`, { payload: { amount: 2 } });
    if (edited.status !== 200) wrong.push(`edit open row: ${edited.status} ${edited.body?.message}`);
    if (((await dlqOf(open.dlqId))?.payload as { amount?: number })?.amount !== 2 || ((await outboxOf(open.eventId))?.payload as { amount?: number })?.amount !== 2) wrong.push('the open row edit did not reach the DLQ and failed outbox rows');
    const audits = await auditsOf(open.dlqId);
    const details = (audits[0]?.details ?? {}) as { before?: { payload?: { amount?: number } }; after?: { payload?: { amount?: number } } };
    if (audits.length !== 1 || details.before?.payload?.amount !== 5_000_000 || details.after?.payload?.amount !== 2) wrong.push(`edit audit rows: ${JSON.stringify(audits)}`);
    const notObject = await send('put', `/api/events/dlq/${open.dlqId}/payload`, { payload: [1, 2] });
    if (notObject.status !== 422 || notObject.body?.code !== 'DLQ_PAYLOAD_INVALID') wrong.push(`array payload: ${notObject.status} ${notObject.body?.code}`);

    // 3. retrying the failed event puts it back in the outbox and resolves its DLQ row; a completed event is refused
    const retried = await send('post', `/api/events/outbox/${open.eventId}/retry`, {});
    if (retried.status !== 200 || (await outboxOf(open.eventId))?.status !== 'pending' || (await dlqOf(open.dlqId))?.status !== 'replayed') {
      wrong.push(`retry failed event: ${retried.status}, outbox ${(await outboxOf(open.eventId))?.status}, dlq ${(await dlqOf(open.dlqId))?.status}`);
    }
    const completedRetry = await send('post', `/api/events/outbox/${replayed.eventId}/retry`, {});
    if (completedRetry.status !== 409 || completedRetry.body?.code !== 'OUTBOX_EVENT_NOT_FAILED' || (await outboxOf(replayed.eventId))?.status !== 'completed') wrong.push(`retry completed event: ${completedRetry.status} ${completedRetry.body?.code}`);

    // 4. «retry all failed» resolves the DLQ rows of the events it puts back
    const batch = await seed('batch', 'failed', 'quarantined');
    const all = await send('post', '/api/events/outbox/retry-failed', {});
    if (all.status !== 200 || (await outboxOf(batch.eventId))?.status !== 'pending' || (await dlqOf(batch.dlqId))?.status !== 'replayed') {
      wrong.push(`retry all: ${all.status}, outbox ${(await outboxOf(batch.eventId))?.status}, dlq ${(await dlqOf(batch.dlqId))?.status}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'replayed row edit 409 (nothing rewritten, no audit); open row edit 200 with one audit row and the failed outbox row synced; array payload 422; retry of a failed event: outbox pending, DLQ replayed; retry of a completed event 409; retry-all resolved its DLQ row',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (eventIds.length > 0) {
      const dlqRows = await orm.select({ id: deadLetterEvents.id }).from(deadLetterEvents).where(inArray(deadLetterEvents.originalEventId, eventIds)).catch(() => []);
      if (dlqRows.length > 0) {
        await orm.delete(activityLogs).where(and(eq(activityLogs.entity, 'صف خطاهای قرنطینه (DLQ)'), inArray(activityLogs.entityId, dlqRows.map(r => String(r.id))))).catch(() => undefined);
      }
      await orm.delete(deadLetterEvents).where(inArray(deadLetterEvents.originalEventId, eventIds)).catch(() => undefined);
      await orm.delete(outboxEvents).where(inArray(outboxEvents.eventId, eventIds)).catch(() => undefined);
    }
  }
  return results;
}
