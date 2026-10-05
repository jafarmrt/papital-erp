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

async function newProject(title: string): Promise<number> {
  const { project } = await ProjectService.createProject({ title, startDate: await businessTodayIsoDate(), quantity: 1 } as Parameters<typeof ProjectService.createProject>[0]);
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
  if (!refused?.includes('رسید ثبت‌شده')) problems.push(`تخصیص رسید مستقیم بی‌رسید رد نشد (${refused ?? 'پذیرفته شد'})`);
  if (!fin(await stockOf(itemId)).equals(10)) problems.push(`موجودی پس از تخصیص ردشده ${await stockOf(itemId)}، انتظار ۱۰`);

  const allocated = await ProjectBomAllocationService.allocateReceiptItemsForProjectBom({
    projectId, allocations: [{ itemId, quantity: 4, location: wh, documentId }], username: 'inv',
  });
  if (!fin(await stockOf(itemId)).equals(6)) problems.push(`تخصیص از رسید ثبت‌شده موجودی را برنداشت (${await stockOf(itemId)}، انتظار ۶)`);
  const sourceId = allocated.allocations[0]?.sourceTransactionId ?? 0;
  const [source] = await orm.select({ type: transactions.type }).from(transactions).where(eq(transactions.id, sourceId));
  if (source?.type !== 'out') problems.push(`حرکت منبع تخصیص ${source?.type ?? 'ندارد'}، انتظار out`);

  await ProjectBomAllocationService.releaseAllocation(allocated.allocations[0].id, { username: 'inv' });
  if (!fin(await stockOf(itemId)).equals(10)) problems.push(`آزادسازی تخصیص رسید موجودی را ${await stockOf(itemId)} کرد، انتظار ۱۰`);
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
  if (!back || !fin(back.unitPrice ?? 0).equals(100000)) problems.push(`بهای بازگشت آزادسازی ${back?.unitPrice ?? 'ندارد'}، انتظار ۱۰۰٬۰۰۰ (بهای خروج تخصیص)`);
  const [item] = await orm.select({ wac: items.weightedAverageCost, stock: items.currentStock }).from(items).where(eq(items.id, itemId));
  if (!fin(item?.wac ?? 0).equals(150000)) problems.push(`میانگین موزون پس از آزادسازی ${item?.wac}، انتظار ۱۵۰٬۰۰۰`);
  const value = fin(item?.stock ?? 0).multiply(item?.wac ?? 0);
  if (!value.equals(3000000)) problems.push(`ارزش انبار ${value}، انتظار ۳٬۰۰۰٬۰۰۰ (جمع دو رسید)`);

  // تخصیصِ رسیدِ پیش از v8.0.32: حرکت منبع «ورود» است و موجودی از انبار خارج نشده بود
  const [receiptIn] = await orm.select({ id: transactions.id }).from(transactions)
    .where(and(eq(transactions.documentId, documentId), eq(transactions.itemId, itemId), eq(transactions.type, 'in')));
  const [legacy] = await orm.insert(projectBomAllocations).values({
    projectId, projectCode: 'LEGACY', itemId, itemCode: 'LEGACY', itemName: 'LEGACY', quantity: 2, sourceTransactionId: receiptIn.id, sourceLocation: wh, status: 'allocated',
  }).returning({ id: projectBomAllocations.id });
  await ProjectBomAllocationService.releaseAllocation(legacy.id, { username: 'inv' });
  if (!fin(await stockOf(itemId)).equals(20)) problems.push(`آزادسازی تخصیصِ رسیدِ پیشین موجودی را ${await stockOf(itemId)} کرد، انتظار ۲۰`);
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
    if (!gap.isZero()) problems.push(`${label}: اختلاف ارزش انبار و دفتر کل ${gap}`);
  };

  const first = await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId: raw.itemId, quantity: 4, location: wh }, { itemId: product.id, quantity: 1, location: wh }], username: 'inv' });
  const wip = await projectNet('1402', projectId);
  if (!fin(wip).equals(700000)) problems.push(`کالای در جریان ساخت پروژه ${wip}، انتظار ۷۰۰٬۰۰۰ (۴ × ۱۰۰٬۰۰۰ + ۳۰۰٬۰۰۰)`);
  const linked = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE is_deleted = 0 AND source_bom_allocation_id = ANY($1::int[])', [first.allocations.map(a => a.id)]);
  if (Number(linked.rows[0].n) !== 2) problems.push(`سند پیوندخورده به تخصیص‌ها ${linked.rows[0].n}، انتظار ۲`);
  await gapIsZero('پس از تخصیص');

  // آزادسازی تخصیص مواد با سند پیش‌نویس ← سند حذف نرم
  await ProjectBomAllocationService.releaseAllocation(first.allocations[0].id, { username: 'inv' });
  if (!fin(await projectNet('1402', projectId)).equals(300000)) problems.push(`۱۴۰۲ پروژه پس از آزادسازی مواد ${await projectNet('1402', projectId)}، انتظار ۳۰۰٬۰۰۰`);
  await gapIsZero('پس از آزادسازی سند پیش‌نویس');

  // آزادسازی تخصیص کالا با سند تأییدشده ← سند معکوس
  const [productVoucher] = (await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE is_deleted = 0 AND source_bom_allocation_id = $1', [first.allocations[1].id])).rows;
  if (productVoucher) await VoucherService.approveJournalVouchers([productVoucher.id], undefined, 'inv');
  await ProjectBomAllocationService.releaseAllocation(first.allocations[1].id, { username: 'inv' });
  if (!fin(await projectNet('1402', projectId)).isZero()) problems.push(`۱۴۰۲ پروژه پس از آزادسازی کالا ${await projectNet('1402', projectId)}، انتظار ۰`);
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
  const projectId = await newProject('پروژه آزمون تحویل');
  const scope = { itemIds: [raw.itemId, product.id], documentIdAfter: 0, voucherIdAfter: mark };
  await ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId: raw.itemId, quantity: 4, location: wh }], username: 'inv' });

  const delivered = await ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: product.id, quantity: 2, unitPrice: 200000, location: wh }], currentUser: 'inv' });
  const [doc] = delivered.documentId
    ? await orm.select({ type: documents.type, status: documents.status, projectId: documents.projectId }).from(documents).where(eq(documents.id, delivered.documentId))
    : [];
  if (doc?.type !== 'production_receipt' || doc.status !== 'final' || doc.projectId !== projectId) {
    problems.push(`تحویل سند رسید تولید نهایی با پیوند پروژه نساخت (${doc ? `${doc.type}/${doc.status}/${doc.projectId}` : 'سندی ندارد'})`);
  }
  const linked = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM journal_vouchers WHERE is_deleted = 0 AND source_document_id = $1', [delivered.documentId ?? 0]);
  if (Number(linked.rows[0].n) !== 1) problems.push(`سند حسابداری رسید تولید ${linked.rows[0].n}، انتظار ۱`);
  if (!fin(await stockOf(product.id)).equals(2)) problems.push(`موجودی محصول پس از تحویل ${await stockOf(product.id)}، انتظار ۲`);
  const wip = await projectNet('1402', projectId);
  if (!fin(wip).isZero()) problems.push(`۱۴۰۲ پروژه پس از تحویل ${wip}، انتظار ۰ (۴۰۰٬۰۰۰ تخصیص − ۴۰۰٬۰۰۰ تحویل)`);
  const afterFirst = await inventoryValueGap(scope);
  if (!afterFirst.gap.isZero()) problems.push(`پس از تحویل: اختلاف ارزش انبار و دفتر کل ${afterFirst.gap}`);

  // تحویل بی‌بها: به میانگین موزون فعلی (۲۰۰٬۰۰۰) ثبت می‌شود
  await ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: product.id, quantity: 1, location: wh }], currentUser: 'inv' });
  const wipAfter = await projectNet('1402', projectId);
  if (!fin(wipAfter).equals(-200000)) problems.push(`۱۴۰۲ پروژه پس از تحویل بی‌بها ${wipAfter}، انتظار −۲۰۰٬۰۰۰ (به میانگین موزون)`);
  const afterSecond = await inventoryValueGap(scope);
  if (!afterSecond.gap.isZero()) problems.push(`پس از تحویل بی‌بها: اختلاف ارزش انبار و دفتر کل ${afterSecond.gap}`);
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
  if (row?.receivedQty !== 5 || row.status !== 'received') problems.push(`دو سطر ۲ و ۳: دریافتی ${row?.receivedQty} با وضعیت ${row?.status}، انتظار ۵ و received`);
  await ProcurementService.deliverOrderToWarehouse(order, USER);
  if ((await requisitionRows(req.id))[0]?.receivedQty !== 5) problems.push(`تحویل دوباره همان سفارش دریافتی را ${(await requisitionRows(req.id))[0]?.receivedQty} کرد، انتظار ۵`);

  // دو ردیف از یک کالا در درخواست
  const split = await ProcurementService.createRequisition({ title: 'درخواست آزمون دو ردیف', items: [
    { itemId: item.id, requestedQty: 3, unitPriceEstimate: 1000 }, { itemId: item.id, requestedQty: 2, unitPriceEstimate: 1000 },
  ] as never }, USER);
  await ProcurementService.deliverOrderToWarehouse(await orderOf(split.id, wh, [{ itemId: item.id, quantity: 5 }]), USER);
  const splitRows = (await requisitionRows(split.id)).map(r => r.receivedQty);
  if (splitRows.join(',') !== '3,2') problems.push(`ردیف‌های ۳ و ۲ با تحویل ۵: دریافتی ${splitRows.join(' و ')}، انتظار ۳ و ۲`);

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
  if (outcome instanceof Error) problems.push(`تحویل هم‌زمان خطا داد: ${getErrorMessage(outcome)}`);
  const raced = (await requisitionRows(racing.id))[0]?.receivedQty;
  if (raced !== 9) problems.push(`نوشتن هم‌زمان: دریافتی ${raced}، انتظار ۹ (۴ نوشته‌شده + ۵ تحویل)`);
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
  const projectId = await newProject('پروژه کاوش تحویل');
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
