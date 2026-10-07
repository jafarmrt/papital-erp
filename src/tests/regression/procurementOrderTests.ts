import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';
import { pool } from '../../db/drizzle.js';
import { createHarness, draftSalesDocument, type Harness, type Row, type ShouldRun } from '../security/workflowTestHarness.js';
import { approvedRequisition, fixture, formRow, type Fixture } from './procurementRequisitionTests.js';
import { consolidationCase, legacyConsolidationHealthCase } from './procurementConsolidationTests.js';

/**
 * Package 10 (purchasing and procurement), PR B: what a procurement order is (the requisition link column), duplicate
 * submissions, consolidation and receiving never-ordered rows, through the real Express routes with real sessions. Each
 * case reproduces a finding of the package 10 review and is red on the code before its fix.
 */
export async function runProcurementOrderTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_procurement_orders_linked_only_td_691',
      'v9.0.272: the procurement order list, the desk summary and delivery see only documents linked to a requisition; a plain warehouse receipt is neither listed nor delivered and a sales proforma is not counted (TD-691)',
      ['td691', 'procurement', 'orders', 'security', 'package10'], linkedOrdersCase],
    ['reg_procurement_orders_paged_in_sql_td_698',
      'v9.0.272: the procurement order list filters, counts and pages in SQL and reads only the rows of the requested page (TD-698)',
      ['td698', 'procurement', 'orders', 'performance', 'package10'], pagedOrdersCase],
    ['reg_procurement_double_submit_td_693',
      'v9.0.273: a repeated procurement submission with the same Idempotency-Key (create requisition, convert to orders, consolidate, deliver) replays the first response and creates nothing new (TD-693)',
      ['td693', 'procurement', 'idempotency', 'concurrency', 'package10'], doubleSubmitCase],
    ['reg_procurement_consolidation_closes_sources_td_694',
      'v9.0.274: consolidation takes only unapproved requisitions without orders, refuses a missing id, and in one transaction closes the sources as consolidated with a link and a terminated workflow; a closed source takes no action (TD-694)',
      ['td694', 'procurement', 'consolidation', 'concurrency', 'package10'], consolidationCase],
    ['reg_procurement_consolidation_legacy_sources_td_694',
      'v9.0.274: the financial health check lists the still-open sources of a consolidation made before the fix and changes nothing (TD-694)',
      ['td694', 'procurement', 'consolidation', 'health', 'package10'], legacyConsolidationHealthCase],
    ['reg_procurement_receive_never_ordered_td_699',
      'v9.0.275: "receive items" refuses a row that was never ordered (order with a supplier and a price first) instead of a final receipt from the generic procurement supplier at the estimate, which posted donated-goods income (TD-699)',
      ['td699', 'procurement', 'receive', 'accounting', 'package10'], neverOrderedReceiveCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_api', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_api', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

/** A draft warehouse receipt recorded outside procurement (the «ورود و خروج انبار» page) */
async function plainReceipt(h: Harness, f: Fixture, itemId: number, quantity: number, unitPrice: number): Promise<{ id: number; refNumber: string }> {
  const { DocumentService } = await import('../../services/document.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const id = Number(await DocumentService.createDocument({
    docType: 'receipt', status: 'draft', inOut: 'in', date: await businessTodayIsoDate(), user: 'آزمون بسته ۱۰',
    buyer_name: `تامین‌کننده محرمانه ${h.tag}`, items: [{ itemId, quantity, unit_price: unitPrice, location: f.wh }],
  } as never));
  const [row] = await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [id]);
  return { id, refNumber: String(row?.ref_number ?? '') };
}

async function summary(h: Harness): Promise<Row> {
  return ((await h.get('/api/procurement/inbox/summary')).body?.data ?? {}) as Row;
}

async function linkedOrdersCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const before = await summary(h);
  const receipt = await plainReceipt(h, f, x.id, 7, 4321000);
  await draftSalesDocument(h, 'proforma');
  const after = await summary(h);
  if (Number(after.pendingDeliveryOrdersCount) !== Number(before.pendingDeliveryOrdersCount) || Number(after.totalOrdersCount) !== Number(before.totalOrdersCount)) {
    wrong.push(`summary counted a plain receipt or a sales proforma: pending ${String(before.pendingDeliveryOrdersCount)} -> ${String(after.pendingDeliveryOrdersCount)}, total ${String(before.totalOrdersCount)} -> ${String(after.totalOrdersCount)}`);
  }

  const projectReader = await h.sessionWith(['projects.view']);
  const listed = await h.get(`/api/procurement/orders?search=${encodeURIComponent(`تامین‌کننده محرمانه ${h.tag}`)}`, projectReader);
  const rows = (listed.body?.data ?? []) as Row[];
  if (listed.status !== 200 || rows.some(r => Number(r.id) === receipt.id) || Number(listed.body?.total) !== 0) {
    wrong.push(`plain receipt in the procurement order list: ${listed.status}, total ${String(listed.body?.total)}, ids ${rows.map(r => r.id).join(',')}`);
  }

  const manager = await h.sessionWith(['procurement.view', 'procurement.manage']);
  const delivered = await f.deliver(receipt.id, manager);
  if (delivered.status !== 422 || delivered.body?.code !== 'PROCUREMENT_ORDER_NOT_LINKED') wrong.push(`delivery of a plain receipt: ${delivered.status} ${String(delivered.body?.code)}`);
  if (await f.docStatus(receipt.id) !== 'draft' || await f.stock(x.id) !== 0) wrong.push(`refused delivery changed the receipt or stock: ${await f.docStatus(receipt.id)}, stock ${await f.stock(x.id)}`);

  // an order made by "convert to orders" is linked, listed with its requisition and delivered
  const req = await approvedRequisition(h, f, [formRow(x, 4, 1000)]);
  const order = await f.convert(req.id, [{ itemId: x.id, quantity: 4 }]);
  const [link] = await h.q(`SELECT procurement_requisition_id FROM documents WHERE id = $1`, [order.docIds[0]]);
  if (Number(link?.procurement_requisition_id) !== req.id) wrong.push(`order link column ${String(link?.procurement_requisition_id)}, expected ${req.id}`);
  const ofRequisition = await h.get(`/api/procurement/orders?requisitionId=${req.id}`, projectReader);
  const orderRow = ((ofRequisition.body?.data ?? []) as Row[])[0];
  if (ofRequisition.status !== 200 || Number(ofRequisition.body?.total) !== 1 || Number(orderRow?.id) !== order.docIds[0] || orderRow?.requisitionCode !== req.code) {
    wrong.push(`orders of the requisition: ${ofRequisition.status}, total ${String(ofRequisition.body?.total)}, ${JSON.stringify(orderRow ?? {}).slice(0, 160)}`);
  }
  const withOrder = await summary(h);
  if (Number(withOrder.pendingDeliveryOrdersCount) !== Number(after.pendingDeliveryOrdersCount) + 1) wrong.push(`summary after convert: pending ${String(withOrder.pendingDeliveryOrdersCount)}`);
  const accepted = await f.deliver(order.docIds[0], manager);
  if (accepted.status !== 200 || await f.stock(x.id) !== 4) wrong.push(`delivery of the linked order: ${accepted.status}, stock ${await f.stock(x.id)}`);
  return 'a plain draft receipt and a sales proforma were not counted, the receipt was not listed for a projects.view reader and its delivery was refused with 422; the converted order carried the link, was listed with its requisition code and was delivered';
}

/** Rows that queries naming documents or purchase_requisitions returned while `run` was running */
async function rowsReadDuring(run: () => Promise<unknown>): Promise<number> {
  const target = pool as unknown as { query: (...args: unknown[]) => Promise<{ rows?: unknown[] }> };
  const original = target.query;
  let rowsRead = 0;
  target.query = async function patched(this: unknown, ...args: unknown[]) {
    const first = args[0] as string | { text?: string } | undefined;
    const text = typeof first === 'string' ? first : String(first?.text ?? '');
    const res = await original.apply(pool, args);
    if (/"documents"|"purchase_requisitions"|\bdocuments\b|\bpurchase_requisitions\b/.test(text)) rowsRead += res?.rows?.length ?? 0;
    return res;
  };
  try {
    await run();
  } finally {
    target.query = original;
  }
  return rowsRead;
}

async function pagedOrdersCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { ProcurementService } = await import('../../services/procurement.service.js');
  const x = await f.item();
  // receipts that are not procurement orders: the old list read every one of them for each page
  for (let i = 0; i < 20; i += 1) await plainReceipt(h, f, x.id, 1, 1000);
  const req = await approvedRequisition(h, f, [formRow(x, 3, 1000)]);
  const orderIds: number[] = [];
  for (let i = 0; i < 3; i += 1) orderIds.push(...(await f.convert(req.id, [{ itemId: x.id, quantity: 1 }])).docIds);
  orderIds.sort((a, b) => b - a);

  let page: Awaited<ReturnType<typeof ProcurementService.getProcurementOrders>> | undefined;
  const rowsRead = await rowsReadDuring(async () => {
    page = await ProcurementService.getProcurementOrders({ requisitionId: req.id, page: 2, limit: 1 });
  });
  if (page?.total !== 3 || page.data.length !== 1 || page.data[0]?.id !== orderIds[1]) {
    wrong.push(`page 2 of 3 orders: total ${String(page?.total)}, ids ${page?.data.map(o => o.id).join(',')}, expected ${orderIds[1]}`);
  }
  if (rowsRead > 6) wrong.push(`one page of one order read ${rowsRead} rows of documents and requisitions (expected at most 6)`);

  const searched = await h.get(`/api/procurement/orders?search=${encodeURIComponent(req.code)}&limit=2`);
  const ids = ((searched.body?.data ?? []) as Row[]).map(r => Number(r.id));
  if (searched.status !== 200 || Number(searched.body?.total) !== 3 || ids.join(',') !== orderIds.slice(0, 2).join(',')) {
    wrong.push(`search by requisition code: ${searched.status}, total ${String(searched.body?.total)}, ids ${ids.join(',')}`);
  }
  return `page 2 of the requisition's 3 orders returned the middle order and read ${rowsRead} rows despite 20 other receipts; searching by the requisition code paged in SQL`;
}

/** POST with the Idempotency-Key header, the way `fetchJson` sends a mutating request */
function keyedPost(h: Harness, url: string, body: unknown, key: string): Promise<request.Response> {
  return request(h.app as never).post(url).set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken)
    .set('Idempotency-Key', key).send(body as object).then(res => res);
}

/** Both answers of a concurrent pair: one ran, the other replayed it or was told it is in flight */
function pairAnswered(pair: request.Response[], okStatus: number): boolean {
  const ran = pair.filter(r => r.status === okStatus && r.headers['x-idempotency-hit'] !== 'true');
  const other = pair.filter(r => (r.status === okStatus && r.headers['x-idempotency-hit'] === 'true') || (r.status === 409 && r.body?.code === 'IDEMPOTENCY_IN_FLIGHT'));
  return ran.length === 1 && other.length === 1;
}

async function doubleSubmitCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const key = (step: string) => `p10-td693-${h.tag}-${step}-${Math.floor(Math.random() * 1e9)}`;

  // 1) create: two concurrent submissions of one form, then a late repeat
  const title = `درخواست ارسال دوباره ${h.tag}`;
  const createBody = { title, priority: 'normal', requiredDate: f.jalaliDate, notes: '', items: [formRow(x, 10, 1000)] };
  const createKey = key('create');
  const created = await Promise.all([keyedPost(h, '/api/procurement/requisitions', createBody, createKey), keyedPost(h, '/api/procurement/requisitions', createBody, createKey)]);
  const repeatCreate = await keyedPost(h, '/api/procurement/requisitions', createBody, createKey);
  const [{ n: requisitionCount }] = await h.q(`SELECT count(*)::int AS n FROM purchase_requisitions WHERE title = $1`, [title]);
  if (!pairAnswered(created, 201) || Number(requisitionCount) !== 1 || repeatCreate.headers['x-idempotency-hit'] !== 'true') {
    wrong.push(`create twice: ${created.map(r => `${r.status}/${String(r.headers['x-idempotency-hit'] ?? '-')}`).join(' ')}, repeat ${repeatCreate.status}/${String(repeatCreate.headers['x-idempotency-hit'] ?? '-')}, requisitions ${String(requisitionCount)}`);
  }

  // 2) convert to orders: 5 of 10, submitted twice at once (S06)
  const req = await approvedRequisition(h, f, [formRow(x, 10, 1000)]);
  const convertBody = {
    orderGroups: [{
      supplierName: `تامین‌کننده بسته ۱۰ ${h.tag}`, targetWarehouse: f.wh, docType: 'receipt', status: 'draft',
      items: [{ itemId: x.id, quantity: 5, unitPrice: 1000, unit: 'عدد' }],
    }],
  };
  const convertKey = key('convert');
  const convertUrl = `/api/procurement/requisitions/${req.id}/convert-to-orders`;
  const converted = await Promise.all([keyedPost(h, convertUrl, convertBody, convertKey), keyedPost(h, convertUrl, convertBody, convertKey)]);
  const orders = await h.q(`SELECT id FROM documents WHERE procurement_requisition_id = $1 AND is_deleted = 0 ORDER BY id`, [req.id]);
  const ordered = (await f.requisition(req.id)).items.reduce((sum, row) => sum + Number(row.orderedQty ?? 0), 0);
  if (!pairAnswered(converted, 200) || orders.length !== 1 || ordered !== 5) {
    wrong.push(`convert twice: ${converted.map(r => `${r.status}/${String(r.headers['x-idempotency-hit'] ?? '-')}`).join(' ')}, orders ${orders.length}, ordered ${ordered}`);
  }

  // 3) deliver: the repeat replays the first answer
  const orderId = Number(orders[0]?.id);
  const deliverKey = key('deliver');
  const delivered = await keyedPost(h, `/api/procurement/orders/${orderId}/deliver`, {}, deliverKey);
  const repeatDeliver = await keyedPost(h, `/api/procurement/orders/${orderId}/deliver`, {}, deliverKey);
  if (delivered.status !== 200 || repeatDeliver.status !== 200 || repeatDeliver.headers['x-idempotency-hit'] !== 'true' || await f.stock(x.id) !== 5) {
    wrong.push(`deliver twice: ${delivered.status}, repeat ${repeatDeliver.status}/${String(repeatDeliver.headers['x-idempotency-hit'] ?? '-')}, stock ${await f.stock(x.id)}`);
  }

  // 4) consolidate two pending requisitions, submitted twice at once
  const a = await f.create({ title: `درخواست تجمیع الف ${h.tag}`, priority: 'normal', requiredDate: f.jalaliDate, notes: '', items: [formRow(x, 2, 1000)] });
  const b = await f.create({ title: `درخواست تجمیع ب ${h.tag}`, priority: 'normal', requiredDate: f.jalaliDate, notes: '', items: [formRow(x, 3, 1000)] });
  const consolidatedTitle = `تجمیع ارسال دوباره ${h.tag}`;
  const consolidateBody = { requisitionIds: [a.id, b.id], title: consolidatedTitle };
  const consolidateKey = key('consolidate');
  const consolidated = await Promise.all([keyedPost(h, '/api/procurement/consolidate', consolidateBody, consolidateKey), keyedPost(h, '/api/procurement/consolidate', consolidateBody, consolidateKey)]);
  const [{ n: consolidatedCount }] = await h.q(`SELECT count(*)::int AS n FROM purchase_requisitions WHERE title = $1`, [consolidatedTitle]);
  if (!pairAnswered(consolidated, 201) || Number(consolidatedCount) !== 1) {
    wrong.push(`consolidate twice: ${consolidated.map(r => `${r.status}/${String(r.headers['x-idempotency-hit'] ?? '-')}`).join(' ')}, consolidated requisitions ${String(consolidatedCount)}`);
  }
  return 'create, convert to orders and consolidate submitted twice at once with one key ran once (the other answer was a replay or in flight), and a repeated delivery replayed its first answer';
}

async function donatedIncomeRows(h: Harness, documentIds: number[]): Promise<number> {
  if (documentIds.length === 0) return 0;
  const [row] = await h.q(
    `SELECT count(*)::int AS n FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = ANY($1::int[]) AND v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = '5204'`, [documentIds]);
  return Number(row?.n ?? 0);
}

/** S12: «دریافت کالا»ی ردیف هرگز سفارش‌نشده (ت۴ الف) */
async function neverOrderedReceiveCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { receive } = await import('../invariants/scenarioHelpers.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const fresh = await f.item();
  const stocked = await f.item();
  await receive(stocked.id, 5, 100000, f.wh, await businessTodayIsoDate());
  const docsBefore = await h.q(`SELECT id FROM documents WHERE is_deleted = 0 ORDER BY id DESC LIMIT 1`);
  const lastDocBefore = Number(docsBefore[0]?.id ?? 0);

  const req = await approvedRequisition(h, f, [formRow(fresh, 3, 0), formRow(stocked, 3, 0)]);
  const refused = await f.action(req.id, 'receive_items');
  const newDocs = (await h.q(`SELECT id FROM documents WHERE id > $1`, [lastDocBefore])).map(r => Number(r.id));
  if (refused.status !== 409 || refused.code !== 'REQUISITION_ROWS_NOT_ORDERED' || !String(refused.error ?? '').includes('ابتدا سفارش خرید با تأمین‌کننده و قیمت صادر کنید')) {
    wrong.push(`receive of never-ordered rows: ${refused.status} ${String(refused.code)} ${String(refused.error ?? '').slice(0, 120)}`);
  }
  if (await f.stock(fresh.id) !== 0 || await f.stock(stocked.id) !== 5 || newDocs.length !== 0 || await donatedIncomeRows(h, newDocs) !== 0) {
    wrong.push(`refused receive moved stock or issued documents: stock ${await f.stock(fresh.id)} / ${await f.stock(stocked.id)}, new documents ${newDocs.join(',')}, 5204 rows ${await donatedIncomeRows(h, newDocs)}`);
  }
  if ((await f.requisition(req.id)).status === 'received') wrong.push('the requisition became received');

  // ordered with a supplier and a price: «receive items» finalizes the order, debt to the supplier and no donated income
  const order = await f.convert(req.id, [{ itemId: fresh.id, quantity: 3 }, { itemId: stocked.id, quantity: 3 }]);
  const received = await f.action(req.id, 'receive_items');
  if (order.status !== 200 || received.status !== 200 || await f.stock(fresh.id) !== 3 || await f.stock(stocked.id) !== 8 || await f.docStatus(order.docIds[0]) !== 'final') {
    wrong.push(`receive after ordering: convert ${order.status}, receive ${received.status} ${String(received.code)}, stock ${await f.stock(fresh.id)} / ${await f.stock(stocked.id)}`);
  }
  if (await donatedIncomeRows(h, order.docIds) !== 0) wrong.push('the ordered receipt posted donated-goods income (5204)');
  return 'receive items of never-ordered rows was refused with the "order with a supplier and a price first" message and moved nothing; after an order with a supplier and a price it finalized the order without donated-goods income';
}
