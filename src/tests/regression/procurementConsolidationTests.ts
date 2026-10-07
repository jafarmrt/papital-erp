import type { Harness, Row } from '../security/workflowTestHarness.js';
import { approvedRequisition, fixture, formRow, type Fixture } from './procurementRequisitionTests.js';

async function pendingRequisition(h: Harness, f: Fixture, label: string, rows: Array<Record<string, unknown>>): Promise<{ id: number; code: string }> {
  const created = await f.create({ title: `درخواست تجمیع ${label} ${h.tag}`, priority: 'normal', requiredDate: f.jalaliDate, notes: '', items: rows });
  if (created.status !== 201) throw new Error(`create requisition ${label}: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  return { id: created.id, code: created.code };
}

async function consolidate(h: Harness, ids: number[], title: string): Promise<{ status: number; code?: string; id: number; body: Row }> {
  const res = await h.post('/api/procurement/consolidate', { requisitionIds: ids, title });
  const data = (res.body?.data ?? {}) as Row;
  return { status: res.status, code: res.body?.code as string | undefined, id: Number(data.id ?? 0), body: res.body as Row };
}

async function countTitled(h: Harness, title: string): Promise<number> {
  const [row] = await h.q(`SELECT count(*)::int AS n FROM purchase_requisitions WHERE title = $1`, [title]);
  return Number(row?.n ?? 0);
}

/**
 * v9.0.274 (TD-694، B10-07، ت۳ الف): تجمیع فقط درخواست تأییدنشده و بی سفارش را می‌پذیرد، شناسه ناموجود را رد می‌کند و
 * منبع‌ها را در همان تراکنش «تجمیع‌شده» با پیوند و گردش کار خاتمه‌یافته می‌کند؛ منبع بسته اقدامی نمی‌پذیرد.
 */
export async function consolidationCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const y = await f.item();
  const a = await pendingRequisition(h, f, 'الف', [formRow(x, 5, 1000), formRow(y, 1, 300)]);
  const b = await pendingRequisition(h, f, 'ب', [formRow(x, 3, 2000)]);

  // ج: already ordered and received (S07)
  const c = await approvedRequisition(h, f, [formRow(x, 2, 1000)]);
  const order = await f.convert(c.id, [{ itemId: x.id, quantity: 2 }]);
  const delivered = await f.deliver(order.docIds[0]);
  if (delivered.status !== 200 || (await f.requisition(c.id)).status !== 'received') throw new Error(`setup: requisition C not received (${delivered.status})`);

  const withReceived = await consolidate(h, [a.id, b.id, c.id], `تجمیع با دریافت‌شده ${h.tag}`);
  if (withReceived.status !== 409 || withReceived.code !== 'REQUISITION_NOT_CONSOLIDATABLE' || await countTitled(h, `تجمیع با دریافت‌شده ${h.tag}`) !== 0) {
    wrong.push(`consolidating a received requisition: ${withReceived.status} ${String(withReceived.code)}`);
  }
  const withMissing = await consolidate(h, [a.id, b.id, 2_000_000_000], `تجمیع با ناموجود ${h.tag}`);
  if (withMissing.status !== 404 || withMissing.code !== 'REQUISITION_NOT_FOUND' || await countTitled(h, `تجمیع با ناموجود ${h.tag}`) !== 0) {
    wrong.push(`consolidating a missing id: ${withMissing.status} ${String(withMissing.code)}`);
  }
  if ((await f.requisition(a.id)).status !== 'pending' || (await f.requisition(b.id)).status !== 'pending') wrong.push('a refused consolidation changed its sources');

  const d = await pendingRequisition(h, f, 'د', [formRow(y, 4, 500)]);
  // two consolidations sharing one source at once: one runs, the other finds the source consolidated
  const e = await pendingRequisition(h, f, 'ه', [formRow(y, 1, 100)]);
  const g = await pendingRequisition(h, f, 'و', [formRow(y, 1, 100)]);
  const k = await pendingRequisition(h, f, 'ز', [formRow(y, 1, 100)]);
  const pair = await Promise.all([consolidate(h, [e.id, g.id], `تجمیع ه و و ${h.tag}`), consolidate(h, [g.id, k.id], `تجمیع و و ز ${h.tag}`)]);
  if (pair.filter(r => r.status === 201).length !== 1 || pair.filter(r => r.status === 409 && r.code === 'REQUISITION_NOT_CONSOLIDATABLE').length !== 1) {
    wrong.push(`two consolidations sharing a source: ${pair.map(r => `${r.status} ${String(r.code)}`).join(', ')}`);
  }

  const title = `تجمیع الف و ب ${h.tag}`;
  const first = await consolidate(h, [b.id, a.id, a.id], title);
  if (first.status !== 201 || await countTitled(h, title) !== 1) wrong.push(`consolidating two pending requisitions: ${first.status} ${String(first.code)}`);
  const target = first.status === 201 ? await f.requisition(first.id) : null;
  if (target) {
    const rows = target.items;
    const xRow = rows.find(r => Number(r.itemId) === x.id);
    const yRow = rows.find(r => Number(r.itemId) === y.id);
    if (rows.length !== 2 || Number(xRow?.requestedQty) !== 8 || Number(yRow?.requestedQty) !== 1 || target.total !== 5 * 1000 + 300 + 3 * 2000) {
      wrong.push(`consolidated rows: ${JSON.stringify(rows.map(r => [r.itemId, r.requestedQty]))}, total ${target.total}`);
    }
    for (const source of [a, b]) {
      const [row] = await h.q(`SELECT status, consolidated_into_id FROM purchase_requisitions WHERE id = $1`, [source.id]);
      const wf = await f.workflow(source.id);
      const [{ n: pendingTasks }] = await h.q(
        `SELECT count(*)::int AS n FROM workflow_tasks t JOIN workflow_instances i ON i.id = t.instance_id
          WHERE i.entity_type = 'purchase_requisition' AND i.entity_id = $1 AND t.status = 'pending'`, [String(source.id)]);
      if (row?.status !== 'consolidated' || Number(row?.consolidated_into_id) !== first.id) wrong.push(`source ${source.code}: ${String(row?.status)} -> ${String(row?.consolidated_into_id)}`);
      if (wf.status !== 'TERMINATED' || !wf.history.some(e => e.action_key === 'terminate') || Number(pendingTasks) !== 0) {
        wrong.push(`source ${source.code} workflow ${wf.status}, pending tasks ${String(pendingTasks)}`);
      }
      const [audit] = await h.q(
        `SELECT details FROM activity_logs WHERE entity = 'درخواست خرید' AND entity_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1`, [String(source.id)]);
      if ((audit?.details as { after?: { status?: string } } | undefined)?.after?.status !== 'consolidated') wrong.push(`source ${source.code} has no consolidation audit row`);
    }
    const detail = await h.get(`/api/procurement/requisitions/${a.id}`);
    const [{ code: targetCode }] = await h.q(`SELECT code FROM purchase_requisitions WHERE id = $1`, [first.id]);
    if (detail.body?.data?.consolidatedIntoCode !== targetCode) {
      wrong.push(`detail of a consolidated source: consolidatedIntoCode ${String(detail.body?.data?.consolidatedIntoCode)}`);
    }

    // a closed source takes no action
    const converted = await f.convert(a.id, [{ itemId: x.id, quantity: 5 }]);
    const approved = await f.action(a.id, 'approve_request');
    const edited = await h.put(`/api/procurement/requisitions/${a.id}`, { title: 'ویرایش منبع بسته' });
    const deleted = await h.del(`/api/procurement/requisitions/${a.id}`);
    const again = await consolidate(h, [a.id, d.id], `تجمیع دوباره ${h.tag}`);
    const answers = [converted.status, converted.body?.code, approved.status, approved.code, edited.status, edited.body?.code, deleted.status, deleted.body?.code, again.status, again.code];
    if (converted.status !== 409 || converted.body?.code !== 'REQUISITION_CONSOLIDATED' || approved.status !== 409 || approved.code !== 'REQUISITION_CONSOLIDATED'
      || edited.status !== 409 || deleted.status !== 409 || again.status !== 409) {
      wrong.push(`actions on a consolidated source: ${answers.map(String).join(' ')}`);
    }
    const [{ n: ordersOfSource }] = await h.q(`SELECT count(*)::int AS n FROM documents WHERE procurement_requisition_id = $1`, [a.id]);
    if (Number(ordersOfSource) !== 0) wrong.push(`a consolidated source got ${String(ordersOfSource)} orders`);
  }
  return 'received and missing sources refused the whole consolidation; two consolidations sharing a source ran one after the other and the second was refused; the sources became consolidated with a link, a terminated workflow and an audit row, and took no further action';
}

/** v9.0.274 (TD-694): منبع باز تجمیع قدیمی (یادداشت «تجمیع شده از درخواست‌های: …») در بررسی سلامت فهرست می‌شود */
export async function legacyConsolidationHealthCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const legacySource = await pendingRequisition(h, f, 'قدیمی', [formRow(x, 2, 1000)]);
  const legacyTarget = await pendingRequisition(h, f, 'تجمیعی قدیمی', [formRow(x, 2, 1000)]);
  await h.q(`UPDATE purchase_requisitions SET notes = $2 WHERE id = $1`, [legacyTarget.id, `تجمیع شده از درخواست‌های: ${legacySource.code}، PR-0000-NONE`]);
  const closedSource = await pendingRequisition(h, f, 'تازه', [formRow(x, 1, 1000)]);
  const other = await pendingRequisition(h, f, 'دیگر', [formRow(x, 1, 1000)]);
  const merged = await consolidate(h, [closedSource.id, other.id], `تجمیع تازه ${h.tag}`);
  if (merged.status !== 201) throw new Error(`setup consolidation: ${merged.status} ${String(merged.code)}`);

  const { findOpenLegacyConsolidationSources, buildConsolidationSourcesHealthTest } = await import('../../services/procurement/consolidationSourceHealth.js');
  const rows = await findOpenLegacyConsolidationSources();
  const listed = rows.filter(r => [legacySource.id, closedSource.id, other.id].includes(Number(r.sourceId)));
  if (listed.length !== 1 || Number(listed[0]?.sourceId) !== legacySource.id || Number(listed[0]?.consolidatedId) !== legacyTarget.id) {
    wrong.push(`open legacy consolidation sources: ${JSON.stringify(listed)}`);
  }
  const test = buildConsolidationSourcesHealthTest(rows);
  if (test.status !== 'warning' || test.id !== 'procurement_consolidation_open_sources') wrong.push(`health test ${test.id} ${test.status}`);
  if ((await f.requisition(legacySource.id)).status !== 'pending') wrong.push('the health check changed a legacy source');
  return 'the open source of a legacy consolidation was listed (and not changed); sources closed by a new consolidation were not';
}
