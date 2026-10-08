import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.71 — سناریوهای سخت‌گیرانه درخواست خرید حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const ADMIN = { username: 'inv', role: 'admin', permissions: [] as string[] };
/** کاربری بی مجوز «ثبت سند انبار با تاریخ گذشته» (warehouse.backdate) */
const CLERK = { username: 'inv-clerk', role: 'procurement_officer', permissions: [] as string[] };

async function requisition(itemId: number, quantity: number): Promise<number> {
  const res = await pool.query<{ code: string; name: string }>('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const req = await ProcurementService.createRequisition({
    title: 'درخواست آزمون همزمانی',
    items: [{ itemId, itemCode: res.rows[0]?.code, itemName: res.rows[0]?.name, unit: 'عدد', requestedQty: quantity, unitPriceEstimate: 1000 }],
  }, ADMIN);
  return req.id;
}

async function order(requisitionId: number, itemId: number, quantity: number, wh: string): Promise<number> {
  const res = await ProcurementService.convertToPurchaseOrders({
    requisitionId,
    orderGroups: [{ supplierName: 'تامین‌کننده آزمون همزمانی', targetWarehouse: wh, status: 'draft', items: [{ itemId, quantity, unitPrice: 1000 }] }],
  }, ADMIN);
  return res.createdDocuments[0].id;
}

/** v9.0.323 (TD-699): پیام رد «دریافت کالا»ی ردیف سفارش‌نشده */
const NOT_ORDERED_HINT = 'ابتدا سفارش خرید با تأمین‌کننده و قیمت صادر کنید';

const receiveItems = (requisitionId: number, user: typeof ADMIN = ADMIN) =>
  ProcurementService.executeWorkflowAction(requisitionId, 'receive_items', user);

async function requisitionRow(requisitionId: number): Promise<{ status: string; receivedQty: number }> {
  const res = await pool.query<{ status: string; items: Array<{ receivedQty?: number }> }>(
    'SELECT status, items FROM purchase_requisitions WHERE id = $1', [requisitionId]);
  return { status: res.rows[0]?.status ?? '', receivedQty: Number(res.rows[0]?.items?.[0]?.receivedQty ?? 0) };
}

/** سفارش‌های پیش‌نویس باقی‌مانده درخواست را تحویل می‌دهد (همان کاری که کاربر پس از هم‌زمانی می‌کند) */
async function deliverOpenOrders(requisitionCode: string): Promise<void> {
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM documents WHERE is_deleted = 0 AND status <> 'final' AND strpos(notes, $1) > 0 ORDER BY id`, [requisitionCode]);
  for (const row of res.rows) await ProcurementService.deliverOrderToWarehouse(row.id, ADMIN);
}

async function rejection(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-326: «دریافت کالا»ی درخواست خرید فقط یک بار کالا را وارد انبار می‌کند. پیش‌تر این اقدام بی‌تراکنش و بی‌قفل بود:
 * هم‌زمان با «تبدیل به سفارش»، یا پیش از تبدیل و تحویل، درخواست ۱۰ عددی ۲۰ عدد وارد انبار می‌کرد؛ دو «دریافت» هم‌زمان
 * درخواست بی‌نمونه گردش‌کار دو رسید و دو نمونه می‌ساختند؛ مقدار دریافتی برابر مقدار درخواست گذاشته می‌شد حتی وقتی فقط
 * ۶ عدد سفارش و وارد انبار شده بود؛ و خطای نهایی‌سازی سفارش فقط در لاگ می‌آمد و درخواست «دریافت‌شده» می‌شد.
 */
export async function checkRequisitionReceivedOnce(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const itemIds: number[] = [];
  const newItem = async () => {
    const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    itemIds.push(item.id);
    return item.id;
  };
  const expectStock = async (itemId: number, requisitionId: number, expected: number, label: string) => {
    const { stock } = await itemState(itemId);
    if (stock !== expected) problems.push(`${label}: موجودی ${stock} است، نه ${expected}`);
    const { receivedQty } = await requisitionRow(requisitionId);
    if (receivedQty !== stock) problems.push(`${label}: مقدار دریافتی درخواست ${receivedQty} است ولی موجودی ${stock}`);
  };

  // ۱) دریافت کالا هم‌زمان با تبدیل به سفارش، سپس تحویل سفارش پیش‌نویسِ باقی‌مانده
  const racedItem = await newItem();
  const raced = await requisition(racedItem, 10);
  const racedCode = (await pool.query<{ code: string }>('SELECT code FROM purchase_requisitions WHERE id = $1', [raced])).rows[0].code;
  const outcomes = await raceBehindRowLock<unknown>('purchase_requisitions', [raced], [() => receiveItems(raced), () => order(raced, racedItem, 10, wh)]);
  // v9.0.323 (TD-699): «دریافت کالا» پیش از سفارش رد می‌شود (ابتدا سفارش خرید)؛ پس از سفارش، سفارش را نهایی می‌کند
  problems.push(...outcomeProblems(['دریافت کالا', 'تبدیل به سفارش'], outcomes, (label, message) =>
    (label === 'تبدیل به سفارش' && message.includes('قبلاً دریافت')) || (label === 'دریافت کالا' && message.includes(NOT_ORDERED_HINT))));
  await deliverOpenOrders(racedCode);
  await expectStock(racedItem, raced, 10, 'دریافت و تبدیل هم‌زمان');

  // ۲) دریافت کالای سفارش‌نشده رد می‌شود (v9.0.323، TD-699، ت۴)؛ پس از سفارش، دریافت و سپس تبدیل دوباره
  const seqItem = await newItem();
  const seq = await requisition(seqItem, 10);
  const beforeOrder = await rejection(() => receiveItems(seq));
  if (!beforeOrder?.includes(NOT_ORDERED_HINT)) problems.push(`receiving a never-ordered requisition was not refused (${beforeOrder ?? 'accepted'})`);
  if ((await itemState(seqItem)).stock !== 0 || (await requisitionRow(seq)).status === 'received') problems.push('a refused receive moved stock or the requisition');
  await order(seq, seqItem, 10, wh);
  await receiveItems(seq);
  const reorder = await rejection(() => order(seq, seqItem, 10, wh));
  if (!reorder?.includes('قبلاً دریافت')) problems.push(`تبدیل درخواستِ دریافت‌شده به سفارش رد نشد (${reorder ?? 'پذیرفته شد'})`);
  const receiveAgain = await rejection(() => receiveItems(seq));
  if (!receiveAgain?.includes('قبلاً دریافت')) problems.push(`دریافت دوباره درخواستِ دریافت‌شده رد نشد (${receiveAgain ?? 'پذیرفته شد'})`);
  await expectStock(seqItem, seq, 10, 'دریافت سپس تبدیل');

  // ۳) سفارش ۶ از ۱۰ و سپس دریافت کالا: مقدار دریافتی همان ۶ است
  const partialItem = await newItem();
  const partial = await requisition(partialItem, 10);
  await order(partial, partialItem, 6, wh);
  await receiveItems(partial);
  await expectStock(partialItem, partial, 6, 'سفارش جزئی سپس دریافت');

  // ۴) دو دریافت هم‌زمان درخواستی که نمونه گردش‌کار ندارد (درخواست قدیمی)
  const legacyItem = await newItem();
  const legacy = await requisition(legacyItem, 10);
  await order(legacy, legacyItem, 10, wh);
  await pool.query(`UPDATE workflow_instances SET entity_id = 'detached-' || entity_id WHERE entity_type = 'purchase_requisition' AND entity_id = $1`, [String(legacy)]);
  await pool.query('UPDATE purchase_requisitions SET workflow_instance_id = NULL WHERE id = $1', [legacy]);
  const twice = await raceBehindRowLock<unknown>('purchase_requisitions', [legacy], [() => receiveItems(legacy), () => receiveItems(legacy)]);
  problems.push(...outcomeProblems(['دریافت اول', 'دریافت دوم'], twice, (_label, message) => message.includes('قبلاً دریافت')));
  const accepted = twice.filter(o => o.status === 'fulfilled').length;
  if (accepted !== 1) problems.push(`از دو دریافت هم‌زمان درخواست بی‌نمونه ${accepted} پذیرفته شد، نه یکی`);
  const instances = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM workflow_instances WHERE entity_type = 'purchase_requisition' AND entity_id = $1`, [String(legacy)]);
  if ((instances.rows[0]?.n ?? 0) !== 1) problems.push(`درخواست بی‌نمونه پس از دو دریافت هم‌زمان ${instances.rows[0]?.n ?? 0} نمونه گردش‌کار دارد، نه یکی`);
  await expectStock(legacyItem, legacy, 10, 'دو دریافت هم‌زمان');

  // ۵) نهایی‌سازی سفارش رد شود (تاریخ گذشته بی‌مجوز): دریافت کالا رد می‌شود و درخواست «دریافت‌شده» نمی‌شود
  const backItem = await newItem();
  const back = await requisition(backItem, 10);
  const backOrder = await order(back, backItem, 10, wh);
  await pool.query(`UPDATE documents SET date = '2026-01-01' WHERE id = $1`, [backOrder]);
  await receive(backItem, 1, 1000, wh, await businessTodayIsoDate());
  const refused = await rejection(() => receiveItems(back, CLERK));
  if (refused === null) problems.push('دریافت کالا با سفارشی که نهایی نشد پذیرفته شد');
  const { status } = await requisitionRow(back);
  if (status === 'received') problems.push('درخواستی که سفارشش نهایی نشد «دریافت‌شده» ماند');
  const { stock } = await itemState(backItem);
  if (stock !== 1) problems.push(`موجودی پس از دریافتِ ردشده ${stock} است، نه ۱`);

  const scope: InvariantScope = { ...mark, itemIds };
  problems.push(...await invariantProblems(scope, 'پس از دریافت کالای درخواست خرید'));
  return problems;
}
