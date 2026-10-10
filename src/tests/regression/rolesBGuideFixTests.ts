import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type Row, type ShouldRun } from '../security/workflowTestHarness.js';
import { approvedRequisition, fixture, formRow, type ReqRow } from './procurementRequisitionTests.js';

/**
 * Phase 3 lane L2, fresh-eyes guide test (warehouse and purchasing roles, roles-b bugs 1 and 2): a customer is never the
 * supplier of a purchase document on any path, and voiding an undelivered procurement order gives its quantity back to
 * the requisition. Through the real Express routes; each case fails on v10.0.97.
 */
export async function runRolesBGuideFixTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_purchase_party_customer_refused_td_1194',
      'v10.0.98: a purchase order, a direct receipt and the delivery of an unlinked draft order refuse a customer as supplier with 422 DOCUMENT_PARTY_KIND_MISMATCH (TD-1194)',
      ['td1194', 'procurement', 'party'], customerAsSupplierCase],
    ['reg_void_order_releases_ordered_qty_td_1195',
      'v10.0.99: voiding an undelivered procurement order gives its ordered quantity back to the requisition (TD-1195)',
      ['td1195', 'procurement', 'void'], voidOrderCase],
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

const codeOf = (body: unknown) => String((body as Row | undefined)?.code ?? '');

async function customerAsSupplierCase(h: Harness, wrong: string[]): Promise<string> {
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const date = await businessTodayIsoDate();
  const f = await fixture(h);
  const x = await f.item();
  const customer = await createTestCustomer({ name: `بوتیک آزمون ${h.tag}`, partyType: 'customer' });
  const supplier = await createTestCustomer({ name: `تأمین آزمون ${h.tag}`, partyType: 'supplier' });

  // (a) the split order of the procurement desk, with the customer's name as supplier
  const req = await approvedRequisition(h, f, [formRow(x, 4, 1000)]);
  const order = await h.post(`/api/procurement/requisitions/${req.id}/convert-to-orders`, {
    orderGroups: [{ supplierName: customer.name, targetWarehouse: f.wh, docType: 'receipt', status: 'draft',
      items: [{ itemId: x.id, quantity: 4, unitPrice: 1000, unit: 'عدد' }] }],
  });
  if (order.status !== 422 || codeOf(order.body) !== 'DOCUMENT_PARTY_KIND_MISMATCH') {
    wrong.push(`split order to a customer: ${order.status} ${codeOf(order.body)}, expected 422 DOCUMENT_PARTY_KIND_MISMATCH`);
  }

  // (b) the direct final receipt of the reorder alert page
  const direct = await h.post('/api/documents', {
    docType: 'receipt', status: 'final', refNumber: 'auto', inOut: 'in', buyer_name: customer.name, location: f.wh, date,
    notes: 'td1194', items: [{ itemId: x.id, quantity: 2, unit_price: 1000 }],
  });
  if (direct.status !== 422 || codeOf(direct.body) !== 'DOCUMENT_PARTY_KIND_MISMATCH') {
    wrong.push(`direct receipt from a customer: ${direct.status} ${codeOf(direct.body)}, expected 422 DOCUMENT_PARTY_KIND_MISMATCH`);
  }
  if (await f.stock(x.id) !== 0) wrong.push(`stock moved: ${await f.stock(x.id)}`);

  // (c) a draft order stored before the fix with the customer's name and no party is not delivered
  const req2 = await approvedRequisition(h, f, [formRow(x, 4, 1000)]);
  const legacy = await f.convert(req2.id, [{ itemId: x.id, quantity: 4 }]);
  const legacyId = legacy.docIds[0];
  if (!legacyId) throw new Error(`setup: order to an unknown supplier ${legacy.status} ${JSON.stringify(legacy.body).slice(0, 200)}`);
  await h.q(`UPDATE documents SET buyer_name = $1, party_id = NULL WHERE id = $2`, [customer.name, legacyId]);
  const delivery = await f.deliver(legacyId);
  if (delivery.status !== 422 || codeOf(delivery.body) !== 'DOCUMENT_PARTY_KIND_MISMATCH') {
    wrong.push(`delivering a draft order named after a customer: ${delivery.status} ${codeOf(delivery.body)}, expected 422 DOCUMENT_PARTY_KIND_MISMATCH`);
  }
  if (await f.docStatus(legacyId) !== 'draft') wrong.push(`the legacy order is ${await f.docStatus(legacyId)}, expected draft`);

  // a supplier's name still links the order to the supplier
  const ok = await h.post('/api/documents', {
    docType: 'receipt', status: 'draft', refNumber: 'auto', inOut: 'in', buyer_name: supplier.name, location: f.wh, date,
    notes: 'td1194', items: [{ itemId: x.id, quantity: 2, unit_price: 1000 }],
  });
  const okId = Number((ok.body as Row)?.docId ?? 0);
  const [okRow] = okId ? await h.q(`SELECT party_id FROM documents WHERE id = $1`, [okId]) : [];
  if (ok.status !== 201 && ok.status !== 200) wrong.push(`receipt from a supplier: ${ok.status} ${codeOf(ok.body)}`);
  else if (Number(okRow?.party_id) !== Number(supplier.id)) wrong.push(`receipt from a supplier linked party ${String(okRow?.party_id)}, expected ${supplier.id}`);
  return 'split order, direct receipt and delivery of an unlinked order refuse a customer; a supplier name links the supplier';
}

async function voidOrderCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const req = await approvedRequisition(h, f, [formRow(x, 35, 1000)]);
  const first = await f.convert(req.id, [{ itemId: x.id, quantity: 35 }]);
  const orderId = first.docIds[0];
  if (!orderId) throw new Error(`setup: convert ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
  const voided = await h.del(`/api/documents/${orderId}`);
  if (voided.status !== 200) throw new Error(`setup: void order ${voided.status} ${JSON.stringify(voided.body).slice(0, 200)}`);

  const row = (await f.requisition(req.id)).items[0] as ReqRow & { remainingQty?: number };
  if (Number(row.orderedQty ?? 0) !== 0 || Number(row.remainingQty ?? -1) !== 35 || row.status !== 'pending') {
    wrong.push(`after the void the row is ordered ${row.orderedQty}, remaining ${row.remainingQty}, status ${row.status}; expected 0, 35, pending`);
  }
  if ((row.linkedDocumentIds ?? []).includes(orderId)) wrong.push('the row still links the voided order');
  const again = await f.convert(req.id, [{ itemId: x.id, quantity: 35 }]);
  if (again.status !== 200) wrong.push(`ordering the 35 again: ${again.status} ${codeOf(again.body)}, expected 200 without an over-order reason`);
  const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'درخواست خرید' AND entity_id = $1`, [String(req.id)]);
  if (!audit.some(r => (r.details as Row | null)?.operation === 'VOID_PROCUREMENT_ORDER')) wrong.push('no audit row of the requisition change');
  return 'the voided order released 35, the row is pending again and the 35 were ordered again without a reason';
}
