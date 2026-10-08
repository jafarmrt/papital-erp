import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 15 (events and integrations), TD-711 / B15-09: the event timeline of an entity shows its own events and audit
 * rows. The picker gives the entity id the events carry, outbox and dead-letter rows match the publisher's aggregate type
 * and the exact id, and audit rows are read only for the section's own entity names and the exact id, only for holders of
 * `audit_logs.view`. On v9.0.385 the picker gave the document number, the outbox query compared «document» with
 * «Document» and found nothing, and audit rows of any entity whose id or description contained the id came back, also to a
 * role holding only `events.view`.
 */
export async function runEventTimelineTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_event_timeline_own_events_and_audit_td_711';
  if (!shouldRun(id, 'td711', 'b15-09', 'events', 'timeline', 'package15')) return results;

  const name = 'v9.0.386: the event timeline shows the entity\'s own outbox events and audit rows, and audit rows only to holders of the audit log permission (TD-711)';
  const tStart = Date.now();
  let h: Harness | undefined;
  const noiseTag = `td711_${Date.now()}`;
  try {
    h = await createHarness();
    const f = await fixture(h);
    const wrong: string[] = [];
    const item = await f.item(10, 400);
    const res = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: item, quantity: 1, unit_price: 1_000, location: f.wh }]));
    const docId = Number(res.body?.docId);
    const refNumber = String(res.body?.refNumber ?? '');
    if (res.status !== 200 || !docId) throw new Error(`setup invoice: ${brief(res)}`);

    // audit rows of other entities that share the id or mention it in their text
    for (const [entity, entityId, description] of [
      [`اشتراک وب‌هوک: ${noiseTag}`, String(docId), `${noiseTag} webhook row`],
      ['قانون واکنش خودکار', '999999', `${noiseTag} mentions ${docId}`],
    ]) {
      await h.q('INSERT INTO activity_logs (username, action, entity, entity_id, description) VALUES ($1, $2, $3, $4, $5)', ['system', 'UPDATE', entity, entityId, description]);
    }

    // 1. the picker gives the document id
    const picker = await h.get(`/api/events/event-sourcing/aggregates?type=document&search=${encodeURIComponent(refNumber)}`);
    const pickedIds = (Array.isArray(picker.body?.data) ? picker.body.data : []).map((r: { id: string }) => r.id);
    if (picker.status !== 200 || !pickedIds.includes(String(docId))) wrong.push(`picker ids ${JSON.stringify(pickedIds)}, expected ${docId}`);

    type Row = { source: string; eventType: string; metadata?: { entity?: string; entityId?: string } };
    const timelineOf = async (s?: Parameters<Harness['get']>[1]) => {
      const t = await h!.get(`/api/events/event-sourcing/timeline?type=document&id=${docId}`, s);
      return { status: t.status, auditIncluded: t.body?.auditIncluded, rows: (Array.isArray(t.body?.data) ? t.body.data : []) as Row[] };
    };

    // 2. an admin sees the invoice's outbox event and its own audit rows only
    const admin = await timelineOf();
    const outboxRows = admin.rows.filter(r => r.source === 'outbox');
    const auditRows = admin.rows.filter(r => r.source === 'audit_log');
    if (!outboxRows.some(r => r.eventType === 'InvoiceApproved')) wrong.push(`admin timeline outbox events: ${JSON.stringify(outboxRows.map(r => r.eventType))}`);
    if (auditRows.length === 0) wrong.push('admin timeline has no audit row of the invoice');
    const foreign = auditRows.filter(r => r.metadata?.entityId !== String(docId) || String(r.metadata?.entity ?? '').includes(noiseTag) || r.metadata?.entity === 'قانون واکنش خودکار');
    if (foreign.length > 0) wrong.push(`admin timeline shows audit rows of other entities: ${JSON.stringify(foreign.map(r => r.metadata))}`);
    if (admin.auditIncluded !== true) wrong.push(`admin auditIncluded ${admin.auditIncluded}`);

    // 3. a role with only events.view sees the events, never audit rows
    const viewer = await h.sessionWith(['events.view']);
    const limited = await timelineOf(viewer);
    if (limited.status !== 200 || !limited.rows.some(r => r.source === 'outbox')) wrong.push(`events.view timeline: ${limited.status}, ${limited.rows.length} rows`);
    if (limited.rows.some(r => r.source === 'audit_log') || limited.auditIncluded !== false) wrong.push(`events.view timeline shows ${limited.rows.filter(r => r.source === 'audit_log').length} audit rows (auditIncluded ${limited.auditIncluded})`);

    // 4. an id that is only part of another id matches nothing
    if (docId >= 10) {
      const partial = await h.get(`/api/events/event-sourcing/timeline?type=document&id=${String(docId).slice(0, -1)}`);
      const partialRows = (Array.isArray(partial.body?.data) ? partial.body.data : []) as Array<{ eventId?: string; payload?: { documentId?: number } }>;
      if (partialRows.some(r => r.payload?.documentId === docId)) wrong.push('a prefix of the id matched the invoice events');
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'picker gives the document id; admin timeline: InvoiceApproved outbox event and only the invoice\'s audit rows (no row of another entity with the same id or mentioning it); events.view only: events, no audit rows',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h?.q('DELETE FROM activity_logs WHERE description LIKE $1', [`${noiseTag}%`]).catch(() => undefined);
    await h?.cleanup();
  }
  return results;
}
