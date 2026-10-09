import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type Row, type ShouldRun } from '../security/workflowTestHarness.js';
import { approvedRequisition, fixture, formRow, type Fixture } from './procurementRequisitionTests.js';

/**
 * Series 10 phase 3, lane L2, package 10: a procurement order and its requisition after the order is converted. The order
 * group has no currency or line discount (TD-941), the goods come in on the delivery day (TD-914), voiding a delivered order
 * rebuilds the requisition (TD-912) and editing a linked order asks the over-order reason (TD-913). Owner decision ت۹ of
 * 17 Mehr 1405. Each case is red on v10.0.36.
 */
export async function runProcurementOrderSyncTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_procurement_order_group_no_currency_td_941',
      'v10.0.37: convert-to-orders refuses an order group currency or a line discount with 400 instead of dropping it into an IRR order without discount (TD-941)',
      ['td941', 'procurement', 'contract', 'package10'], noCurrencyCase],
    ['reg_procurement_delivery_on_delivery_day_td_914',
      'v10.0.38: a delivered procurement order takes the delivery day for its document and Kardex rows, so a movement of the item after the conversion does not block it as backdated (TD-914)',
      ['td914', 'procurement', 'delivery', 'date', 'package10'], deliveryDayCase],
    ['reg_procurement_void_rebuilds_requisition_td_912',
      'v10.0.39: voiding a delivered order rebuilds the ordered and received quantities of its requisition from the live documents, so the requisition can be ordered again (TD-912)',
      ['td912', 'procurement', 'void', 'package10'], voidRebuildCase],
    ['reg_procurement_order_edit_over_order_reason_td_913',
      'v10.0.40: editing a linked order beyond the requisition needs the over-order reason, which is recorded on the requisition row and the order notes (TD-913)',
      ['td913', 'procurement', 'edit', 'package10'], editReasonCase],
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

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 200)}`;
const codeOf = (res: { body?: unknown }) => String((res.body as Row | undefined)?.code ?? '');

async function orderOf(h: Harness, f: Fixture, qty: number): Promise<{ reqId: number; itemId: number; docId: number }> {
  const item = await f.item();
  const req = await approvedRequisition(h, f, [formRow(item, qty, 1000)]);
  const converted = await f.convert(req.id, [{ itemId: item.id, quantity: qty }]);
  if (converted.status !== 200 || converted.docIds.length !== 1) throw new Error(`setup convert: ${converted.status} ${JSON.stringify(converted.body).slice(0, 200)}`);
  return { reqId: req.id, itemId: item.id, docId: converted.docIds[0] };
}

/** P5-P14 (TD-941): the group currency and the line discount were dropped silently */
async function noCurrencyCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item();
  const req = await approvedRequisition(h, f, [formRow(item, 2, 1000)]);
  const group = (extra: Record<string, unknown>, line: Record<string, unknown> = {}) => ({
    orderGroups: [{
      supplierName: `تامین‌کننده ${h.tag}`, targetWarehouse: f.wh, docType: 'receipt', status: 'draft', ...extra,
      items: [{ itemId: item.id, quantity: 2, unitPrice: 1000, unit: 'عدد', ...line }],
    }],
  });
  const url = `/api/procurement/requisitions/${req.id}/convert-to-orders`;
  const usd = await h.post(url, group({ currency: 'USD' }));
  if (usd.status !== 400) wrong.push(`an order group in USD answered ${brief(usd)}, expected 400 (the order would be IRR)`);
  const discounted = await h.post(url, group({}, { discount: 500 }));
  if (discounted.status !== 400) wrong.push(`an order line with a discount answered ${brief(discounted)}, expected 400 (the discount would be dropped)`);
  const plain = await h.post(url, group({}));
  if (plain.status !== 200) wrong.push(`the form body answered ${brief(plain)}, expected 200`);
  return 'a group currency or a line discount is 400; the form body converts';
}

/** P5-P05 (TD-914): the order kept the conversion day and a later movement of the item made its delivery backdated */
async function deliveryDayCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const today = await businessTodayIsoDate();
  const { reqId, itemId, docId } = await orderOf(h, f, 3);
  // the order was converted three days ago
  const [stored] = await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [docId]);
  await h.q(`UPDATE documents SET date = date - interval '3 days' WHERE id = $1`, [docId]);
  // another receipt of the item today
  const other = await h.post('/api/documents', {
    docType: 'receipt', status: 'final', refNumber: 'auto', date: today, buyer_name: `تامین‌کننده دیگر ${h.tag}`,
    items: [{ itemId, quantity: 1, unit_price: 1000, location: f.wh }],
  });
  if (other.status !== 200) throw new Error(`setup receipt: ${brief(other)}`);

  const keeper = await h.sessionWith(['procurement.view', 'procurement.order', 'warehouse.view', 'warehouse.in']);
  const delivered = await f.deliver(docId, keeper);
  if (delivered.status !== 200) {
    wrong.push(`delivering the order converted three days ago answered ${brief(delivered)}, expected 200 on the delivery day`);
    return `requisition ${reqId}`;
  }
  const [doc] = await h.q(`SELECT to_char(date, 'YYYY-MM-DD') AS date, ref_number, notes FROM documents WHERE id = $1`, [docId]);
  if (String(doc.date).slice(0, 10) !== today) wrong.push(`the delivered order is dated ${String(doc.date)}, expected ${today}`);
  if (doc.ref_number !== stored.ref_number) wrong.push(`the order number changed from ${String(stored.ref_number)} to ${String(doc.ref_number)} in the same fiscal year`);
  const kardex = await h.q(`SELECT left(date::text, 10) AS date FROM transactions WHERE document_id = $1 AND is_deleted = 0`, [docId]);
  if (kardex.length === 0 || kardex.some(k => String(k.date).slice(0, 10) !== today)) wrong.push(`the Kardex rows of the order are dated ${JSON.stringify(kardex.map(k => k.date))}, expected ${today}`);
  if (!String(doc.notes ?? '').includes('تاریخ سفارش')) wrong.push(`the order notes do not keep the order date: ${String(doc.notes)}`);
  return `an order converted three days ago, after another receipt of its item today, is delivered by a warehouse keeper on ${today} with the same number`;
}

/** P5-P03 (TD-912): voiding a delivered order left the requisition received with the voided quantity */
async function voidRebuildCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { reqId, itemId, docId } = await orderOf(h, f, 3);
  const delivered = await f.deliver(docId);
  if (delivered.status !== 200) throw new Error(`setup deliver: ${brief(delivered)}`);
  const voided = await h.del(`/api/documents/${docId}`);
  if (voided.status !== 200) throw new Error(`void: ${brief(voided)}`);
  const row = (await f.requisition(reqId)).items[0];
  if (Number(row.receivedQty ?? 0) !== 0 || Number(row.orderedQty ?? 0) !== 0 || row.status !== 'pending') {
    wrong.push(`after the void the requisition row is ${JSON.stringify({ ordered: row.orderedQty, received: row.receivedQty, status: row.status })}, expected ordered 0, received 0, pending`);
  }
  const again = await f.convert(reqId, [{ itemId, quantity: 3 }]);
  if (again.status !== 200) wrong.push(`ordering the requisition again answered ${again.status} ${JSON.stringify(again.body).slice(0, 200)}, expected 200 without an over-order reason`);
  else {
    const redelivered = await f.deliver(again.docIds[0]);
    const after = (await f.requisition(reqId)).items[0];
    if (redelivered.status !== 200 || Number(after.receivedQty) !== 3) wrong.push(`the new order delivered ${brief(redelivered)} with received ${String(after.receivedQty)}, expected 200 and 3`);
  }
  return 'an order of 3 delivered and voided leaves the row at ordered 0 / received 0; a new order of 3 needs no reason and is received';
}

/** P5-P04 (TD-913): editing a linked order from 6 to 9 needed no reason */
async function editReasonCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { reqId, itemId, docId } = await orderOf(h, f, 6);
  const versionOf = async () => Number((await h.q(`SELECT version FROM documents WHERE id = $1`, [docId]))[0]?.version);
  const body = (quantity: number, price: number, extra: Record<string, unknown> = {}) => ({
    version: 0, items: [{ itemId, quantity, unit_price: price, location: f.wh }], ...extra,
  });
  const put = async (b: Record<string, unknown>) => h.put(`/api/documents/${docId}`, { ...b, version: await versionOf() });

  const noReason = await put(body(9, 1000));
  if (noReason.status !== 422 || codeOf(noReason) !== 'OVER_ORDER_REASON_REQUIRED') wrong.push(`editing the order from 6 to 9 without a reason answered ${brief(noReason)}, expected 422 OVER_ORDER_REASON_REQUIRED`);
  const reason = `تخفیف حجمی ${h.tag}`;
  const withReason = await put(body(9, 1000, { overOrderReason: reason }));
  if (withReason.status !== 200) wrong.push(`editing with a reason answered ${brief(withReason)}, expected 200`);
  else {
    const row = (await f.requisition(reqId)).items[0] as unknown as Row & { overOrders?: Array<{ quantity: number; reason: string; documentIds: number[] }> };
    const over = (row.overOrders ?? []).find(o => o.reason === reason);
    if (Number(row.orderedQty) !== 9) wrong.push(`the requisition row is ordered ${String(row.orderedQty)}, expected 9`);
    if (!over || Number(over.quantity) !== 3 || !over.documentIds.includes(docId)) wrong.push(`the row over-orders are ${JSON.stringify(row.overOrders)}, expected 3 with the reason and the order`);
    const [doc] = await h.q(`SELECT notes FROM documents WHERE id = $1`, [docId]);
    if (!String(doc.notes ?? '').includes(reason)) wrong.push(`the order notes do not carry the reason: ${String(doc.notes)}`);
  }
  const priceOnly = await put(body(9, 1200));
  if (priceOnly.status !== 200) wrong.push(`a price edit of the already over-ordered order answered ${brief(priceOnly)}, expected 200 without a new reason`);
  const down = await put(body(5, 1200));
  if (down.status !== 200) wrong.push(`lowering the order to 5 answered ${brief(down)}, expected 200`);
  else if (Number((await f.requisition(reqId)).items[0].orderedQty) !== 5) wrong.push('the requisition row did not follow the order down to 5');
  return 'an edit from 6 to 9 needs a reason, recorded as 3 on the row and in the notes; a price edit and an edit down to 5 need none';
}
