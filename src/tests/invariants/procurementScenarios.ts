import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DocumentService } from '../../services/document.service.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.10 — سناریوی سخت‌گیرانه تحویل تدارکات به انبار (TD-267) برای سوئیت business_invariants.
 * تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const USER = { username: 'inv', role: 'admin' };

async function docRow(id: number): Promise<{ type: string; status: string } | undefined> {
  return (await pool.query<{ type: string; status: string }>('SELECT type, status FROM documents WHERE id = $1', [id])).rows[0];
}

async function salesAccountLines(documentId: number): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND a.code IN ('5001', '6001')`, [documentId]);
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * TD-267: تحویل تدارکات فقط سند ورودی خرید را نهایی می‌کند (پیش‌فاکتور فروش رد می‌شود)؛ «پیش‌فاکتور خرید» تدارکات رسید
 * با وضعیت پیش‌فاکتور است و تحویلش کالا را وارد انبار می‌کند، نه فروش؛ نهایی‌سازی سند نوع purchase ورود است.
 */
export async function checkProcurementDeliveryIncomingOnly(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  await receive(item.id, 10, 100000, wh, '2026-02-01');

  // الف) پیش‌فاکتور فروش از مسیر تحویل تدارکات نهایی نمی‌شود
  const salesProforma = await DocumentService.createDocument({
    docType: 'proforma', status: 'proforma', inOut: 'out', date: '2026-02-02', user: 'inv', buyerName: 'مشتری آزمون تدارکات',
    items: [{ itemId: item.id, quantity: 3, unitPrice: 250000, location: wh }],
  });
  let refused: string | null = null;
  try {
    await ProcurementService.deliverOrderToWarehouse(salesProforma, USER);
  } catch (err) {
    refused = getErrorMessage(err);
  }
  const proformaRow = await docRow(salesProforma);
  if (!refused?.includes('سند خرید نیست') || proformaRow?.type !== 'proforma' || proformaRow.status !== 'proforma') {
    problems.push(`procurement delivery did not refuse a sales proforma (${refused ?? 'accepted'}; ${JSON.stringify(proformaRow)})`);
  }
  if ((await itemState(item.id)).stock !== 10) problems.push('the refused delivery changed the stock');

  // ب) «پیش‌فاکتور خرید» تدارکات: رسید با وضعیت پیش‌فاکتور؛ تحویلش ورود کالاست، نه فروش
  const requisition = await ProcurementService.createRequisition({
    title: 'درخواست خرید آزمون TD-267',
    items: [{ itemId: item.id, itemCode: item.code, itemName: item.name, unit: 'عدد', requestedQty: 4, unitPriceEstimate: 90000 }],
  }, USER);
  const { createdDocuments } = await ProcurementService.convertToPurchaseOrders({
    requisitionId: requisition.id,
    orderGroups: [{ supplierName: 'تامین‌کننده آزمون TD-267', docType: 'proforma', targetWarehouse: wh, items: [{ itemId: item.id, quantity: 4, unitPrice: 90000 }] }],
  }, USER);
  const orderId = Number(createdDocuments[0]?.id);
  const orderRow = await docRow(orderId);
  if (orderRow?.type !== 'receipt' || orderRow.status !== 'proforma') problems.push(`a procurement purchase proforma must be a receipt with status proforma: ${JSON.stringify(orderRow)}`);
  await ProcurementService.deliverOrderToWarehouse(orderId, USER);
  const afterDelivery = await itemState(item.id);
  if (afterDelivery.stock !== 14) problems.push(`delivering the purchase proforma must bring 4 units into the warehouse: stock ${afterDelivery.stock}, expected 14`);
  if (await salesAccountLines(orderId) > 0) problems.push('delivering the purchase proforma created a sales voucher (sales revenue or cost of sales)');

  // ج) نهایی‌سازی سند نوع purchase ورود کالاست (همان قاعده ثبت سند)
  const purchaseDraft = await DocumentService.createDocument({
    docType: 'purchase', status: 'draft', date: await businessTodayIsoDate(), user: 'inv', buyerName: 'تامین‌کننده آزمون TD-267',
    items: [{ itemId: item.id, quantity: 2, unitPrice: 95000, location: wh }],
  });
  await DocumentService.finalizeDocument(purchaseDraft, 'inv');
  const afterPurchase = await itemState(item.id);
  if (afterPurchase.stock !== 16) problems.push(`finalizing the purchase document (purchase) must bring 2 units into the warehouse: stock ${afterPurchase.stock}, expected 16`);

  problems.push(...await invariantProblems(scope, 'end of the procurement scenario'));
  return problems;
}

/** درخواست تبدیل از راه API با همان بدنه‌ای که فرم «تقسیم سفارش» (SplitOrderModal) می‌فرستد */
export async function postSplitOrderForm(requisitionId: number, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = (await import('supertest')).default;
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const session = await getAdminSession();
  const res = await request(app).post(`/api/procurement/requisitions/${requisitionId}/convert-to-orders`)
    .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> };
}

/**
 * TD-291: مسیر تبدیل درخواست به سفارش بدنه فرم «تقسیم سفارش» را می‌پذیرد — پیش‌تر شناسه عددی ردیف درخواست (که فرم
 * نمی‌فرستد) الزامی بود و هر درخواست فرم با خطای ۴۰۰ رد می‌شد، و انبار مقصد و وضعیت بسته سفارش از بدنه حذف می‌شد.
 */
export async function checkSplitOrderFormAccepted(): Promise<string[]> {
  const problems: string[] = [];
  const { createTestWarehouse } = await import('../fixtures/factories.js');
  const target = await createTestWarehouse({ name: `انبار مقصد آزمون TD-291 ${Date.now()}` });
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const req = await ProcurementService.createRequisition({ title: 'درخواست آزمون فرم تقسیم سفارش', items: [{ itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 } as never] }, USER);

  const res = await postSplitOrderForm(req.id, {
    orderGroups: [{
      supplierName: 'تامین‌کننده آزمون TD-291', targetWarehouse: target.code, docType: 'receipt', status: 'draft', notes: 'بسته ۱',
      items: [{ itemId: item.id, itemCode: item.code, itemName: item.name, quantity: 5, unitPrice: 1000, unit: 'عدد' }],
    }],
    closeRequisition: true,
    closureReason: 'تطابق کامل خرید با درخواست متقاضی',
  });
  if (res.status !== 200) return [...problems, `فرم تقسیم سفارش رد شد (${res.status}): ${String(res.body.message ?? res.body.error ?? '').slice(0, 200)}`];

  const created = ((res.body.data as { createdDocuments?: Array<{ id: number }> } | undefined)?.createdDocuments ?? []).map(d => d.id);
  const lines = await pool.query<{ location: string; status: string }>(
    `SELECT di.location, d.status FROM document_items di JOIN documents d ON d.id = di.document_id
      WHERE di.item_id = $1 AND di.is_deleted = 0 AND d.is_deleted = 0 AND d.id = ANY($2::int[])`, [item.id, created]);
  if (lines.rows.length !== 1) problems.push(`the created order has ${lines.rows.length} lines, expected 1`);
  else {
    if (lines.rows[0].location !== target.code) problems.push(`order target warehouse "${lines.rows[0].location}", expected "${target.code}"`);
    if (lines.rows[0].status !== 'draft') problems.push(`order status ${lines.rows[0].status}, expected draft`);
  }
  const ordered = (await ProcurementService.getRequisitionById(req.id)).items as unknown as Array<{ orderedQty?: number }>;
  if (Number(ordered[0]?.orderedQty ?? 0) !== 5) problems.push(`requisition ordered quantity ${ordered[0]?.orderedQty}, expected 5`);
  return problems;
}

/** ردیف اول درخواست و اسناد سفارشی که یادداشتشان کد درخواست را دارد */
async function requisitionState(requisitionId: number): Promise<{ ordered: number; overOrders: Array<{ quantity: number; reason: string; documentIds: number[] }>; notes: string; orders: Array<{ id: number; notes: string }> }> {
  const req = await ProcurementService.getRequisitionById(requisitionId);
  const row = (req.items as unknown as Array<{ orderedQty?: number; overOrders?: Array<{ quantity: number; reason: string; documentIds: number[] }> }>)[0];
  const orders = await pool.query<{ id: number; notes: string }>(
    `SELECT id, notes FROM documents WHERE is_deleted = 0 AND position($1 in notes) > 0 ORDER BY id`, [`[تدارکات: درخواست ${req.code}]`]);
  return { ordered: Number(row?.orderedQty ?? 0), overOrders: row?.overOrders ?? [], notes: String(req.notes ?? ''), orders: orders.rows };
}

/**
 * TD-289 (تصمیم مالک محصول — گزینه ب): سفارش بیش از درخواست فقط با دلیل. درخواستِ کامل‌سفارش‌شده (۱۰ از ۱۰) دوباره بی‌دلیل
 * سفارش داده نمی‌شود — نه از سرویس، نه از فرم (کد OVER_ORDER_REASON_REQUIRED) — و چیزی ساخته نمی‌شود؛ با دلیل ۴ واحد اضافه
 * ثبت و دلیل روی ردیف، یادداشت درخواست و سند سفارش می‌نشیند. سفارش بیشتر از مانده (۷ برای ۵) فقط اضافه را دلیل‌دار می‌کند. تبدیل
 * یک‌جاست: اگر بسته دوم شکست بخورد، سفارش بسته اول هم نمی‌ماند.
 */
export async function checkRequisitionOverOrderNeedsReason(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const group = (quantity: number, itemId = item.id) => ({ supplierName: 'تامین‌کننده آزمون TD-289', targetWarehouse: wh, items: [{ itemId, quantity, unitPrice: 1000 }] });
  const convert = (requisitionId: number, groups: unknown[], overOrderReason?: string) =>
    ProcurementService.convertToPurchaseOrders({ requisitionId, orderGroups: groups as never, overOrderReason }, USER);
  const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (err) { return getErrorMessage(err); } };

  // درخواست ۱۰ کامل سفارش داده می‌شود (بی‌دلیل، چون بیش از درخواست نیست)
  const full = await ProcurementService.createRequisition({ title: 'درخواست آزمون سفارش دوباره', items: [{ itemId: item.id, requestedQty: 10, unitPriceEstimate: 1000 } as never] }, USER);
  const first = await refusal(() => convert(full.id, [group(10)]));
  if (first) problems.push(`ordering 10 of 10 was refused: ${first}`);

  const again = await refusal(() => convert(full.id, [group(10)]));
  if (!again?.includes('دلیل')) problems.push(`ordering a fully ordered requisition again without a reason was not refused (${again ?? 'accepted'})`);
  const form = await postSplitOrderForm(full.id, { orderGroups: [{ ...group(10), docType: 'receipt', status: 'draft', items: [{ itemId: item.id, itemName: item.name, quantity: 10, unitPrice: 1000 }] }] });
  if (form.status !== 422 || form.body.code !== 'OVER_ORDER_REASON_REQUIRED') problems.push(`form without a reason: ${form.status} / ${String(form.body.code)}, expected 422 / OVER_ORDER_REASON_REQUIRED`);
  const refused = await requisitionState(full.id);
  if (refused.ordered !== 10 || refused.orders.length !== 1) problems.push(`after the refusals: ordered ${refused.ordered} in ${refused.orders.length} documents, expected 10 in 1 document`);

  const reason = 'حداقل تیراژ تامین‌کننده';
  const withReason = await refusal(() => convert(full.id, [group(4)], reason));
  if (withReason) problems.push(`extra order with a reason was refused: ${withReason}`);
  const accepted = await requisitionState(full.id);
  const record = accepted.overOrders[0];
  if (accepted.ordered !== 14) problems.push(`ordered after the extra order ${accepted.ordered}, expected 14`);
  if (!record || record.quantity !== 4 || record.reason !== reason || record.documentIds.length !== 1) problems.push(`extra order record on the row: ${JSON.stringify(accepted.overOrders)}`);
  if (!accepted.notes.includes(reason)) problems.push('extra order reason did not appear in the requisition notes');
  const extraOrder = accepted.orders.find(o => o.id === record?.documentIds[0]);
  if (!extraOrder?.notes.includes(reason)) problems.push('extra order reason did not appear in the order document notes');

  // بیشتر از مانده: فقط اضافه (۲ از ۷) دلیل‌دار است
  const partial = await ProcurementService.createRequisition({ title: 'درخواست آزمون مانده', items: [{ itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 } as never] }, USER);
  const partialRefusal = await refusal(() => convert(partial.id, [group(7)]));
  if (!partialRefusal?.includes('۲ بیش از درخواست')) problems.push(`ordering 7 of 5 without a reason: ${partialRefusal ?? 'accepted'}; expected a refusal naming the excess of 2`);
  await convert(partial.id, [group(7)], 'پک ۷ تایی');
  const partialState = await requisitionState(partial.id);
  if (partialState.overOrders[0]?.quantity !== 2) problems.push(`recorded extra order quantity ${partialState.overOrders[0]?.quantity}, expected 2`);

  // تبدیل یک‌جا: بسته دوم با کالای ناموجود شکست می‌خورد و سفارش بسته اول هم نمی‌ماند
  const atomic = await ProcurementService.createRequisition({ title: 'درخواست آزمون یک‌جا', items: [{ itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 } as never] }, USER);
  const broken = await refusal(() => convert(atomic.id, [group(5), group(1, 2_000_000_000)], 'آزمون شکست'));
  const atomicState = await requisitionState(atomic.id);
  if (!broken) problems.push('conversion with a non-existent item was accepted');
  if (atomicState.orders.length !== 0 || atomicState.ordered !== 0) problems.push(`after the second package failed: ${atomicState.orders.length} documents and ordered ${atomicState.ordered}, expected 0 and 0`);
  return problems;
}
