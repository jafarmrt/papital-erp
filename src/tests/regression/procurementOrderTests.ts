import { TestCaseResult, makeTestCase } from '../types.js';
import { pool } from '../../db/drizzle.js';
import { createHarness, draftSalesDocument, type Harness, type Row, type ShouldRun } from '../security/workflowTestHarness.js';
import { approvedRequisition, fixture, formRow, type Fixture } from './procurementRequisitionTests.js';

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
