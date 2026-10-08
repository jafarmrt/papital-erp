import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { documents, items, projectBomAllocations, transactions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DocumentService } from '../../services/document.service.js';
import { ProjectService } from '../../services/projects.service.js';
import { ProjectBomAllocationService } from '../../services/inventory/projectBomAllocation.service.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { createTestItem } from '../fixtures/factories.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { inventoryValueGap } from './businessInvariants.js';

/**
 * v8.0.32 — سناریوهای حوزه E (خرید، پروژه، BOM و تولید) برای سوئیت business_invariants: آزمون سخت‌گیرانه رفع‌ها (فهرست
 * مشکلات؛ خالی یعنی رفتار درست) و کاوش یافته‌های باز (true یعنی یافته هنوز رخ می‌دهد). همه حرکت‌ها تاریخ امروز کسب‌وکار
 * دارند، چون تخصیص و تحویل پروژه با تاریخ امروز ثبت می‌شوند (قاعده تاریخ گردش کالا، TD-257).
 */

const USER = { username: 'inv', role: 'admin' };

async function voucherMark(): Promise<number> {
  return Number((await pool.query<{ m: string }>('SELECT COALESCE(MAX(id), 0)::text AS m FROM journal_vouchers')).rows[0].m);
}

async function stockOf(itemId: number): Promise<string> {
  return fin((await pool.query<{ s: string }>('SELECT COALESCE(current_stock, 0)::text AS s FROM items WHERE id = $1', [itemId])).rows[0]?.s ?? 0).toString();
}

async function rawWithStock(wh: string, quantity: number, unitPrice: number): Promise<{ itemId: number; documentId: number }> {
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const documentId = await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: await businessTodayIsoDate(), user: 'inv', items: [{ itemId: item.id, quantity, unitPrice, location: wh }],
  });
  return { itemId: item.id, documentId };
}

/** products: محصولات پروژه و مقدار برنامه‌ریزی‌شده؛ «ورود به انبار» فقط همین کالاها را می‌پذیرد (v8.0.72، TD-327) */
async function newProject(title: string, products: Array<{ itemId: number; quantity: number }> = []): Promise<number> {
  const { project } = await ProjectService.createProject({
    title, startDate: await businessTodayIsoDate(), quantity: 1,
    products: products.map((p, i) => ({ id: `prod-${i + 1}`, item_id: p.itemId, item_code: '', item_name: '', customer_code: '', quantity: p.quantity, unit: 'عدد', needs_assembly: false })),
  } as Parameters<typeof ProjectService.createProject>[0]);
  return project.id;
}

async function refusalOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-287 (تصمیم مالک محصول — گزینه الف): تخصیص «رسید مستقیم BOM» بی‌رسید ثبت‌شده رد می‌شود (موجودی از هیچ ساخته نمی‌شود)؛
 * تخصیص از رسید ثبت‌شده مانند تخصیص عادی مواد را از انبار خارج می‌کند و آزادسازی آن موجودی را دقیقاً برمی‌گرداند.
 */
export async function checkBomReceiptAllocationNeedsReceipt(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const { itemId, documentId } = await rawWithStock(wh, 10, 100000);
  const projectId = await newProject('پروژه آزمون تخصیص رسید');

  const refused = await refusalOf(() => ProjectBomAllocationService.allocateReceiptItemsForProjectBom({
    projectId, allocations: [{ itemId, quantity: 3, location: wh }], username: 'inv',
  }));
  if (!refused?.includes('رسید ثبت‌شده')) problems.push(`direct receipt allocation without a receipt was not refused (${refused ?? 'accepted'})`);
  if (!fin(await stockOf(itemId)).equals(10)) problems.push(`stock after the refused allocation ${await stockOf(itemId)}, expected 10`);

  const allocated = await ProjectBomAllocationService.allocateReceiptItemsForProjectBom({
    projectId, allocations: [{ itemId, quantity: 4, location: wh, documentId }], username: 'inv',
  });
  if (!fin(await stockOf(itemId)).equals(6)) problems.push(`allocation from a registered receipt did not take the stock (${await stockOf(itemId)}, expected 6)`);
  const sourceId = allocated.allocations[0]?.sourceTransactionId ?? 0;
  const [source] = await orm.select({ type: transactions.type }).from(transactions).where(eq(transactions.id, sourceId));
  if (source?.type !== 'out') problems.push(`allocation source movement is ${source?.type ?? 'missing'}, expected out`);

  await ProjectBomAllocationService.releaseAllocation(allocated.allocations[0].id, { username: 'inv' });
  if (!fin(await stockOf(itemId)).equals(10)) problems.push(`releasing the receipt allocation made the stock ${await stockOf(itemId)}, expected 10`);
  return problems;
}

/**
 * TD-288: آزادسازی تخصیص مواد را به بهای کاردکس خروج همان تخصیص برمی‌گرداند — پس از خرید گران‌تر ارزشی از هیچ ساخته
 * نمی‌شود (ارزش انبار = جمع دو رسید) — و تخصیصِ رسیدِ پیش از v8.0.32 (حرکت منبع «ورود») موجودی اضافه نمی‌کند.
 */
export async function checkBomReleaseAtOwnCost(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const { itemId, documentId } = await rawWithStock(wh, 10, 100000);
  const projectId = await newProject('پروژه آزمون آزادسازی');
  const allocated = await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId, quantity: 4, location: wh }], username: 'inv' });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: await businessTodayIsoDate(), user: 'inv', items: [{ itemId, quantity: 10, unitPrice: 200000, location: wh }],
  });
  await ProjectBomAllocationService.releaseAllocation(allocated.allocations[0].id, { username: 'inv' });
  const [back] = await orm.select({ unitPrice: transactions.unitPrice }).from(transactions)
    .where(and(eq(transactions.itemId, itemId), eq(transactions.type, 'in'), eq(transactions.documentType, 'آزادسازی تخصیص BOM')));
  if (!back || !fin(back.unitPrice ?? 0).equals(100000)) problems.push(`release return cost is ${back?.unitPrice ?? 'missing'}, expected 100,000 (the allocation's outflow cost)`);
  const [item] = await orm.select({ wac: items.weightedAverageCost, stock: items.currentStock }).from(items).where(eq(items.id, itemId));
  if (!fin(item?.wac ?? 0).equals(150000)) problems.push(`weighted average cost after release ${item?.wac}, expected 150,000`);
  const value = fin(item?.stock ?? 0).multiply(item?.wac ?? 0);
  if (!value.equals(3000000)) problems.push(`warehouse value ${value}, expected 3,000,000 (sum of the two receipts)`);

  // تخصیصِ رسیدِ پیش از v8.0.32: حرکت منبع «ورود» است و موجودی از انبار خارج نشده بود
  const [receiptIn] = await orm.select({ id: transactions.id }).from(transactions)
    .where(and(eq(transactions.documentId, documentId), eq(transactions.itemId, itemId), eq(transactions.type, 'in')));
  const [legacy] = await orm.insert(projectBomAllocations).values({
    projectId, projectCode: 'LEGACY', itemId, itemCode: 'LEGACY', itemName: 'LEGACY', quantity: 2, sourceTransactionId: receiptIn.id, sourceLocation: wh, status: 'allocated',
  }).returning({ id: projectBomAllocations.id });
  await ProjectBomAllocationService.releaseAllocation(legacy.id, { username: 'inv' });
  if (!fin(await stockOf(itemId)).equals(20)) problems.push(`releasing the older receipt allocation made the stock ${await stockOf(itemId)}, expected 20`);
  return problems;
}

/** گردش یک حساب برای تفصیلی پروژه در اسناد و ردیف‌های فعال (همه وضعیت‌ها) */
async function projectNet(code: string, projectId: number): Promise<string> {
  const res = await pool.query<{ n: string }>(
    `SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS n FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = $1 AND i.detailed_type = 'project' AND i.detailed_id = $2`, [code, projectId]);
  return fin(res.rows[0]?.n ?? 0).toString();
}

/**
 * TD-286 (تصمیم مالک محصول — گزینه الف): تخصیص مواد BOM سند می‌گیرد — بدهکار کالای در جریان ساخت (۱۴۰۲، تفصیلی پروژه) /
 * بستانکار موجودی مواد (۱۴۰۱) یا کالای ساخته‌شده (۱۴۰۳) به بهای کاردکس؛ ارزش انبار با دفتر کل یکی می‌ماند. آزادسازی سند را
 * باطل می‌کند: پیش‌نویس حذف نرم، تأییدشده سند معکوس؛ گردش ۱۴۰۲ پروژه صفر می‌شود.
 */
export async function checkBomAllocationPostsVoucher(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await voucherMark();
  const raw = await rawWithStock(wh, 10, 100000);
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: await businessTodayIsoDate(), user: 'inv', items: [{ itemId: product.id, quantity: 5, unitPrice: 300000, location: wh }],
  });
  const scope = { itemIds: [raw.itemId, product.id], documentIdAfter: 0, voucherIdAfter: mark };
  const projectId = await newProject('پروژه آزمون سند تخصیص');
  const gapIsZero = async (label: string) => {
    const { gap } = await inventoryValueGap(scope);
    if (!gap.isZero()) problems.push(`${label}: warehouse value vs general ledger difference ${gap}`);
  };

  const first = await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId: raw.itemId, quantity: 4, location: wh }, { itemId: product.id, quantity: 1, location: wh }], username: 'inv' });
  const wip = await projectNet('1402', projectId);
  if (!fin(wip).equals(700000)) problems.push(`project work in progress ${wip}, expected 700,000 (4 × 100,000 + 300,000)`);
  const linked = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE is_deleted = 0 AND source_bom_allocation_id = ANY($1::int[])', [first.allocations.map(a => a.id)]);
  if (Number(linked.rows[0].n) !== 2) problems.push(`vouchers linked to the allocations ${linked.rows[0].n}, expected 2`);
  await gapIsZero('پس از تخصیص');

  // آزادسازی تخصیص مواد با سند پیش‌نویس ← سند حذف نرم
  await ProjectBomAllocationService.releaseAllocation(first.allocations[0].id, { username: 'inv' });
  if (!fin(await projectNet('1402', projectId)).equals(300000)) problems.push(`project 1402 after releasing the materials ${await projectNet('1402', projectId)}, expected 300,000`);
  await gapIsZero('پس از آزادسازی سند پیش‌نویس');

  // آزادسازی تخصیص کالا با سند تأییدشده ← سند معکوس
  const [productVoucher] = (await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE is_deleted = 0 AND source_bom_allocation_id = $1', [first.allocations[1].id])).rows;
  if (productVoucher) await VoucherService.approveJournalVouchers([productVoucher.id], undefined, 'inv');
  await ProjectBomAllocationService.releaseAllocation(first.allocations[1].id, { username: 'inv' });
  if (!fin(await projectNet('1402', projectId)).isZero()) problems.push(`project 1402 after releasing the goods ${await projectNet('1402', projectId)}, expected 0`);
  await gapIsZero('پس از آزادسازی سند تأییدشده');
  return problems;
}

/**
 * TD-285 (تصمیم مالک محصول — گزینه الف): «ورود به انبار» زبانه پروژه سند «رسید تولید» نهایی با پیوند پروژه صادر می‌کند که
 * سند حسابداری دارد — بدهکار کالای ساخته‌شده / بستانکار کالای در جریان ساخت پروژه. با تخصیص ۴ × ۱۰۰٬۰۰۰ و تحویل ۲ × ۲۰۰٬۰۰۰،
 * ۱۴۰۲ پروژه صفر می‌شود؛ تحویل بی‌بها به میانگین موزون ثبت می‌شود و ارزش انبار با دفتر کل یکی می‌ماند.
 */
export async function checkProjectDeliveryPostsVoucher(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await voucherMark();
  const raw = await rawWithStock(wh, 10, 100000);
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const projectId = await newProject('پروژه آزمون تحویل', [{ itemId: product.id, quantity: 3 }]);
  const scope = { itemIds: [raw.itemId, product.id], documentIdAfter: 0, voucherIdAfter: mark };
  await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId: raw.itemId, quantity: 4, location: wh }], username: 'inv' });

  const delivered = await ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: product.id, quantity: 2, unitPrice: 200000, location: wh }], currentUser: 'inv' });
  const [doc] = delivered.documentId
    ? await orm.select({ type: documents.type, status: documents.status, projectId: documents.projectId }).from(documents).where(eq(documents.id, delivered.documentId))
    : [];
  if (doc?.type !== 'production_receipt' || doc.status !== 'final' || doc.projectId !== projectId) {
    problems.push(`delivery did not create a final production receipt document linked to the project (${doc ? `${doc.type}/${doc.status}/${doc.projectId}` : 'no document'})`);
  }
  const linked = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE is_deleted = 0 AND source_document_id = $1', [delivered.documentId ?? 0]);
  if (Number(linked.rows[0].n) !== 1) problems.push(`production receipt journal vouchers ${linked.rows[0].n}, expected 1`);
  if (!fin(await stockOf(product.id)).equals(2)) problems.push(`product stock after delivery ${await stockOf(product.id)}, expected 2`);
  const wip = await projectNet('1402', projectId);
  if (!fin(wip).isZero()) problems.push(`project 1402 after delivery ${wip}, expected 0 (400,000 allocation − 400,000 delivery)`);
  const afterFirst = await inventoryValueGap(scope);
  if (!afterFirst.gap.isZero()) problems.push(`after delivery: warehouse value vs general ledger difference ${afterFirst.gap}`);

  // تحویل بی‌بها: به میانگین موزون فعلی (۲۰۰٬۰۰۰) ثبت می‌شود
  await ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: product.id, quantity: 1, location: wh }], currentUser: 'inv' });
  const wipAfter = await projectNet('1402', projectId);
  if (!fin(wipAfter).equals(-200000)) problems.push(`project 1402 after the unpriced delivery ${wipAfter}, expected −200,000 (at weighted average cost)`);
  const afterSecond = await inventoryValueGap(scope);
  if (!afterSecond.gap.isZero()) problems.push(`after the unpriced delivery: warehouse value vs general ledger difference ${afterSecond.gap}`);
  return problems;
}

/** مقدار دریافتی و وضعیت ردیف‌های یک درخواست خرید */
async function requisitionRows(requisitionId: number): Promise<Array<{ receivedQty: number; status: string }>> {
  const req = await ProcurementService.getRequisitionById(requisitionId);
  return (req.items as unknown as Array<{ receivedQty?: number; status?: string }>).map(r => ({ receivedQty: Number(r.receivedQty ?? 0), status: String(r.status ?? '') }));
}

/** سفارش خرید یک گروه از درخواست؛ شناسه سند سفارش */
async function orderOf(requisitionId: number, wh: string, lines: Array<{ itemId: number; quantity: number }>): Promise<number> {
  const converted = await ProcurementService.convertToPurchaseOrders({ requisitionId, orderGroups: [
    { supplierName: 'تامین‌کننده آزمون TD-290', targetWarehouse: wh, items: lines.map(l => ({ ...l, unitPrice: 1000 })) },
  ] as never }, USER);
  return converted.createdDocuments[0].id;
}

/**
 * TD-290: تحویل سفارش خرید مقدار دریافتی درخواست را از جمع همه سطرهای فعال هر کالا می‌شمارد (۲ + ۳ = ۵) و میان ردیف‌های
 * همان کالا به ترتیب پر می‌کند (۵ ← ۳ و ۲)؛ به‌روزرسانی درخواست در تراکنش تحویل و زیر قفل ردیف درخواست است، پس تحویلی که
 * هم‌زمان با نوشتن دیگری روی همان درخواست اجرا شود آن را بازنویسی نمی‌کند (۴ + ۵ = ۹)؛ تحویل دوباره همان سفارش چیزی اضافه نمی‌کند.
 */
export async function checkRequisitionReceiptSumsLines(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });

  // دو سطر از یک کالا در یک سفارش
  const req = await ProcurementService.createRequisition({ title: 'درخواست آزمون دو سطر', items: [{ itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 } as never] }, USER);
  const order = await orderOf(req.id, wh, [{ itemId: item.id, quantity: 2 }, { itemId: item.id, quantity: 3 }]);
  await ProcurementService.deliverOrderToWarehouse(order, USER);
  const [row] = await requisitionRows(req.id);
  if (row?.receivedQty !== 5 || row.status !== 'received') problems.push(`two lines 2 and 3: received ${row?.receivedQty} with status ${row?.status}, expected 5 and received`);
  await ProcurementService.deliverOrderToWarehouse(order, USER);
  if ((await requisitionRows(req.id))[0]?.receivedQty !== 5) problems.push(`delivering the same order again made received ${(await requisitionRows(req.id))[0]?.receivedQty}, expected 5`);

  // دو ردیف از یک کالا در درخواست
  const split = await ProcurementService.createRequisition({ title: 'درخواست آزمون دو ردیف', items: [
    { itemId: item.id, requestedQty: 3, unitPriceEstimate: 1000 }, { itemId: item.id, requestedQty: 2, unitPriceEstimate: 1000 },
  ] as never }, USER);
  await ProcurementService.deliverOrderToWarehouse(await orderOf(split.id, wh, [{ itemId: item.id, quantity: 5 }]), USER);
  const splitRows = (await requisitionRows(split.id)).map(r => r.receivedQty);
  if (splitRows.join(',') !== '3,2') problems.push(`rows of 3 and 2 with a delivery of 5: received ${splitRows.join(' and ')}, expected 3 and 2`);

  // نوشتن هم‌زمان روی همان درخواست (مانند تحویل سفارشی دیگر): تحویل منتظر قفل می‌ماند و مقدار تازه را می‌خواند
  const racing = await ProcurementService.createRequisition({ title: 'درخواست آزمون هم‌زمانی', items: [{ itemId: item.id, requestedQty: 10, unitPriceEstimate: 1000 } as never] }, USER);
  const racingOrder = await orderOf(racing.id, wh, [{ itemId: item.id, quantity: 5 }]);
  const other = await pool.connect();
  let delivering: Promise<unknown> | null = null;
  try {
    await other.query('BEGIN');
    await other.query(`UPDATE purchase_requisitions SET items = jsonb_set(items, '{0,receivedQty}', '4'::jsonb) WHERE id = $1`, [racing.id]);
    delivering = ProcurementService.deliverOrderToWarehouse(racingOrder, USER).catch((err: unknown) => err);
    for (let i = 0; i < 200; i++) {
      const waiting = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1`, [(other as unknown as { processID: number }).processID]);
      if (Number(waiting.rows[0].n) > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await other.query('COMMIT');
  } finally {
    other.release();
  }
  const outcome = await delivering;
  if (outcome instanceof Error) problems.push(`concurrent delivery failed: ${getErrorMessage(outcome)}`);
  const raced = (await requisitionRows(racing.id))[0]?.receivedQty;
  if (raced !== 9) problems.push(`concurrent write: received ${raced}, expected 9 (4 written + 5 delivered)`);
  return problems;
}

// ── کاوش یافته‌های باز (true = یافته هنوز رخ می‌دهد) ───────────────────────────

/** TD-287 (کاوش رگرسیون؛ رفع v8.0.32): «رسید مستقیم BOM» بی‌رسید موجودی را بی‌تأمین‌کننده و بی‌سند حسابداری بالا می‌برد */
export async function probeBomReceiptAllocationFromNothing(wh: string): Promise<boolean> {
  const { itemId } = await rawWithStock(wh, 5, 100000);
  const projectId = await newProject('پروژه کاوش رسید مستقیم');
  const refused = await refusalOf(() => ProjectBomAllocationService.allocateReceiptItemsForProjectBom({
    projectId, allocations: [{ itemId, quantity: 3, location: wh }], username: 'inv',
  }));
  return !refused && fin(await stockOf(itemId)).greaterThan(5);
}

/** TD-285 (کاوش رگرسیون؛ رفع v8.0.35): تحویل کالای ساخته‌شده پروژه به انبار («ورود به انبار») موجودی را بی‌سند حسابداری بالا می‌برد */
export async function probeProjectDeliveryWithoutVoucher(wh: string): Promise<boolean> {
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const projectId = await newProject('پروژه کاوش تحویل', [{ itemId: product.id, quantity: 2 }]);
  const mark = await voucherMark();
  await ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: product.id, quantity: 2, unitPrice: 300000, location: wh }], currentUser: 'inv' });
  const { gap } = await inventoryValueGap({ itemIds: [product.id], documentIdAfter: 0, voucherIdAfter: mark });
  return !gap.isZero();
}

/** TD-286 (کاوش رگرسیون؛ رفع v8.0.34): تخصیص مواد BOM به پروژه موجودی را به بهای میانگین کم می‌کرد ولی سند حسابداری نداشت */
export async function probeBomAllocationWithoutVoucher(wh: string): Promise<boolean> {
  const mark = await voucherMark();
  const { itemId } = await rawWithStock(wh, 10, 100000);
  const projectId = await newProject('پروژه کاوش تخصیص');
  await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId, quantity: 4, location: wh }], username: 'inv' });
  const { gap } = await inventoryValueGap({ itemIds: [itemId], documentIdAfter: 0, voucherIdAfter: mark });
  return !gap.isZero();
}

/** TD-288 (کاوش رگرسیون؛ رفع v8.0.33): آزادسازی تخصیص مواد را به میانگین موزون روز برمی‌گرداند، نه به بهای خروج همان تخصیص */
export async function probeBomReleaseAtCurrentWac(wh: string): Promise<boolean> {
  const { itemId } = await rawWithStock(wh, 10, 100000);
  const projectId = await newProject('پروژه کاوش آزادسازی');
  const allocated = await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId, quantity: 4, location: wh }], username: 'inv' });
  await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: await businessTodayIsoDate(), user: 'inv', items: [{ itemId, quantity: 10, unitPrice: 200000, location: wh }],
  });
  await ProjectBomAllocationService.releaseAllocation(allocated.allocations[0].id, { username: 'inv' });
  const [out] = await orm.select({ unitPrice: transactions.unitPrice }).from(transactions).where(eq(transactions.id, allocated.allocations[0].sourceTransactionId ?? 0));
  const [back] = await orm.select({ unitPrice: transactions.unitPrice }).from(transactions)
    .where(and(eq(transactions.itemId, itemId), eq(transactions.type, 'in'), eq(transactions.documentType, 'آزادسازی تخصیص BOM')));
  return Boolean(out && back) && !fin(back.unitPrice ?? 0).equals(out.unitPrice ?? 0);
}

/** TD-289 (کاوش رگرسیون؛ رفع v8.0.38): درخواست خریدی که کامل سفارش داده شده بی‌دلیل دوباره به سفارش خرید تبدیل می‌شود (۲۰ سفارش برای ۱۰ درخواست) */
export async function probeRequisitionReconvertedOverOrdered(wh: string): Promise<boolean> {
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const req = await ProcurementService.createRequisition({ title: 'درخواست کاوش سفارش دوباره', items: [{ itemId: item.id, requestedQty: 10, unitPriceEstimate: 1000 } as never] }, USER);
  const group = (quantity: number) => ({ supplierName: 'تامین‌کننده کاوش', targetWarehouse: wh, items: [{ itemId: item.id, quantity, unitPrice: 1000 }] });
  await ProcurementService.convertToPurchaseOrders({ requisitionId: req.id, orderGroups: [group(10)] as never }, USER);
  const again = await refusalOf(() => ProcurementService.convertToPurchaseOrders({ requisitionId: req.id, orderGroups: [group(10)] as never }, USER));
  return again === null;
}

/** TD-290 (کاوش رگرسیون؛ رفع v8.0.36): تحویل سفارشی با دو سطر از یک کالا فقط سطر اول را در مقدار دریافت‌شده درخواست می‌شمارد */
export async function probeRequisitionReceiptCountsFirstLine(wh: string): Promise<boolean> {
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const req = await ProcurementService.createRequisition({ title: 'درخواست کاوش دو سطر', items: [{ itemId: item.id, requestedQty: 5, unitPriceEstimate: 1000 } as never] }, USER);
  const converted = await ProcurementService.convertToPurchaseOrders({ requisitionId: req.id, orderGroups: [
    { supplierName: 'تامین‌کننده کاوش', targetWarehouse: wh, items: [{ itemId: item.id, quantity: 2, unitPrice: 1000 }, { itemId: item.id, quantity: 3, unitPrice: 1000 }] },
  ] as never }, USER);
  await ProcurementService.deliverOrderToWarehouse(converted.createdDocuments[0].id, USER);
  const after = await ProcurementService.getRequisitionById(req.id);
  const received = (after.items as unknown as Array<{ receivedQty?: number }>)[0]?.receivedQty ?? 0;
  return Number(received) !== 5;
}

/**
 * TD-412 (تصمیم مالک محصول — گزینه الف): پروژه‌ای که تخصیص مواد باز دارد حذف نمی‌شود (پروژه، تخصیص و گردش ۱۴۰۲ آن دست
 * نمی‌خورند)؛ پس از آزادسازی تخصیص حذف می‌شود، و تخصیص به پروژه حذف‌شده رد می‌شود.
 */
export async function checkProjectDeleteNeedsReleasedAllocations(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const { itemId } = await rawWithStock(wh, 10, 100000);
  const projectId = await newProject('پروژه آزمون حذف با تخصیص باز');
  const allocated = await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId, quantity: 4, location: wh }], username: 'inv' });
  const wipBefore = await projectNet('1402', projectId);
  const isDeleted = async () => Number((await pool.query<{ d: number }>('SELECT is_deleted AS d FROM production_projects WHERE id = $1', [projectId])).rows[0]?.d ?? -1);

  const refused = await refusalOf(() => ProjectService.deleteProject(projectId));
  if (!refused?.includes('تخصیص مواد باز')) problems.push(`deleting a project with an open allocation was not refused (${refused ?? 'accepted'})`);
  if (await isDeleted() !== 0) problems.push('project with an open allocation was deleted');
  if (await projectNet('1402', projectId) !== wipBefore) problems.push('the refused delete changed the project work in progress balance');

  await ProjectBomAllocationService.releaseAllocation(allocated.allocations[0].id, { username: 'inv' });
  const afterRelease = await refusalOf(() => ProjectService.deleteProject(projectId));
  if (afterRelease) problems.push(`deleting the project after releasing the allocation was refused (${afterRelease})`);
  if (await isDeleted() !== 1) problems.push('project was not deleted after releasing the allocation');
  if (!fin(await projectNet('1402', projectId)).isZero()) problems.push(`1402 balance of the deleted project ${await projectNet('1402', projectId)}, expected zero`);
  const late = await refusalOf(() => ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId, quantity: 1, location: wh }], username: 'inv' }));
  if (!late) problems.push('material allocation to a deleted project was accepted');
  return problems;
}
