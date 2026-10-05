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
    problems.push(`تحویل تدارکات پیش‌فاکتور فروش را رد نکرد (${refused ?? 'پذیرفته شد'}؛ ${JSON.stringify(proformaRow)})`);
  }
  if ((await itemState(item.id)).stock !== 10) problems.push('تحویل ردشده موجودی را تغییر داد');

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
  if (orderRow?.type !== 'receipt' || orderRow.status !== 'proforma') problems.push(`پیش‌فاکتور خرید تدارکات باید رسید با وضعیت پیش‌فاکتور باشد: ${JSON.stringify(orderRow)}`);
  await ProcurementService.deliverOrderToWarehouse(orderId, USER);
  const afterDelivery = await itemState(item.id);
  if (afterDelivery.stock !== 14) problems.push(`تحویل پیش‌فاکتور خرید باید ۴ عدد وارد انبار کند: موجودی ${afterDelivery.stock}، انتظار ۱۴`);
  if (await salesAccountLines(orderId) > 0) problems.push('تحویل پیش‌فاکتور خرید سند فروش (درآمد فروش یا بهای تمام‌شده) ساخت');

  // ج) نهایی‌سازی سند نوع purchase ورود کالاست (همان قاعده ثبت سند)
  const purchaseDraft = await DocumentService.createDocument({
    docType: 'purchase', status: 'draft', date: await businessTodayIsoDate(), user: 'inv', buyerName: 'تامین‌کننده آزمون TD-267',
    items: [{ itemId: item.id, quantity: 2, unitPrice: 95000, location: wh }],
  });
  await DocumentService.finalizeDocument(purchaseDraft, 'inv');
  const afterPurchase = await itemState(item.id);
  if (afterPurchase.stock !== 16) problems.push(`نهایی‌سازی سند خرید (purchase) باید ۲ عدد وارد انبار کند: موجودی ${afterPurchase.stock}، انتظار ۱۶`);

  problems.push(...await invariantProblems(scope, 'پایان سناریوی تدارکات'));
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
  if (lines.rows.length !== 1) problems.push(`سفارش ساخته‌شده ${lines.rows.length} سطر دارد، انتظار ۱`);
  else {
    if (lines.rows[0].location !== target.code) problems.push(`انبار مقصد سفارش «${lines.rows[0].location}»، انتظار «${target.code}»`);
    if (lines.rows[0].status !== 'draft') problems.push(`وضعیت سفارش ${lines.rows[0].status}، انتظار draft`);
  }
  const ordered = (await ProcurementService.getRequisitionById(req.id)).items as unknown as Array<{ orderedQty?: number }>;
  if (Number(ordered[0]?.orderedQty ?? 0) !== 5) problems.push(`مقدار سفارش‌شده درخواست ${ordered[0]?.orderedQty}، انتظار ۵`);
  return problems;
}
