import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, productionProjects } from '../../db/schema.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { AppError, ValidationError } from '../../errors/customErrors.js';
import type { PurchaseRequisitionItemRow } from '../../types.js';

/** یک ردیف درخواست خرید در بدنه ثبت یا ویرایش (قرارداد `requisitionRowSchema`) */
export interface RequisitionRowFields {
  id?: string;
  itemId?: number | null;
  itemCode?: string;
  itemName?: string;
  category?: string;
  unit?: string;
  requestedQty: DecimalValue | undefined;
  unitPriceEstimate?: DecimalValue;
  targetSupplierId?: number | null;
  targetSupplierName?: string;
  notes?: string;
}

const toPersianDigits = (n: number): string => String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * v9.0.266 (TD-688، B10-01): ردیف‌های درخواست خرید از بدنه ثبت و ویرایش، با یک قاعده: مقدار درخواستی بیشتر از صفر،
 * کالای فهرست (حذف‌نشده؛ ناشناخته ۴۲۲) یا نام کالایی بیرون از فهرست، و نام، کد، واحد و دسته کالای فهرست از خود فهرست.
 * شناسه ردیف ذخیره‌شده نگه داشته می‌شود و ردیف تازه شناسه تازه می‌گیرد. پیش‌تر مقدار از `requestedQty || 0` خوانده
 * می‌شد و ردیف بی‌مقدار با صفر و نام «کالای سفارشی» ذخیره می‌شد.
 */
export async function buildRequisitionRows(
  tx: DbExecutor,
  input: RequisitionRowFields[],
  keepIds: ReadonlySet<string> = new Set(),
): Promise<{ rows: PurchaseRequisitionItemRow[]; total: FinancialDecimal }> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError('دست‌کم یک قلم کالا برای درخواست خرید لازم است.');
  }
  const catalogIds = [...new Set(input.map(row => Number(row.itemId)).filter(id => Number.isInteger(id) && id > 0))];
  const catalog = catalogIds.length === 0 ? [] : await tx
    .select({ id: items.id, code: items.code, name: items.name, unit: items.unit, category: items.category })
    .from(items)
    .where(and(inArray(items.id, catalogIds), eq(items.isDeleted, 0)));
  const byId = new Map(catalog.map(item => [item.id, item]));
  const missing = catalogIds.filter(id => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError(
      `کالای ردیف درخواست خرید در فهرست کالا نیست یا حذف شده است (شناسه ${missing.map(toPersianDigits).join('، ')}).`,
      422, 'REQUISITION_ITEM_NOT_FOUND', { itemIds: missing },
    );
  }

  const stamp = Date.now();
  const usedIds = new Set<string>();
  let total = fin(0);
  const rows = input.map((row, index): PurchaseRequisitionItemRow => {
    const rowNumber = toPersianDigits(index + 1);
    const qty = fin(row.requestedQty ?? 0);
    if (row.requestedQty === undefined || row.requestedQty === null || !qty.isPositive()) {
      throw new ValidationError(`مقدار درخواستی ردیف ${rowNumber} باید بیشتر از صفر باشد.`);
    }
    const price = fin(row.unitPriceEstimate ?? 0);
    if (price.isNegative()) throw new ValidationError(`برآورد قیمت واحد ردیف ${rowNumber} نمی‌تواند منفی باشد.`);
    const catalogItem = Number(row.itemId) > 0 ? byId.get(Number(row.itemId)) : undefined;
    const itemName = catalogItem?.name ?? row.itemName?.trim() ?? '';
    if (!itemName) {
      throw new ValidationError(`برای ردیف ${rowNumber} کالایی از فهرست کالا انتخاب کنید یا نام کالا را بنویسید.`);
    }
    total = total.add(qty.multiply(price));
    const storedId = row.id && keepIds.has(row.id) && !usedIds.has(row.id) ? row.id : `item-${stamp}-${index}`;
    usedIds.add(storedId);
    return {
      id: storedId,
      itemId: catalogItem?.id ?? null,
      itemCode: catalogItem?.code ?? row.itemCode?.trim() ?? '',
      itemName,
      category: catalogItem?.category ?? row.category ?? '',
      unit: catalogItem?.unit || row.unit?.trim() || 'عدد',
      requestedQty: qty.toNumber(),
      orderedQty: 0,
      remainingQty: qty.toNumber(),
      unitPriceEstimate: price.toNumber(),
      targetSupplierId: row.targetSupplierId ?? null,
      targetSupplierName: row.targetSupplierName ?? '',
      status: 'pending',
      linkedDocumentIds: [],
      notes: row.notes ?? '',
    };
  });
  return { rows, total };
}

/** v9.0.266 (TD-688): پروژه درخواست باید باشد و حذف نشده باشد؛ کد و نام از خود پروژه */
export async function resolveRequisitionProject(
  tx: DbExecutor,
  projectId: number | null | undefined,
): Promise<{ projectId: number | null; projectCode: string; projectName: string }> {
  if (!projectId) return { projectId: null, projectCode: '', projectName: '' };
  const [project] = await tx.select({ id: productionProjects.id, code: productionProjects.projectCode, title: productionProjects.title })
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) {
    throw new AppError(`پروژه درخواست خرید (شناسه ${toPersianDigits(projectId)}) یافت نشد یا حذف شده است.`, 422, 'REQUISITION_PROJECT_NOT_FOUND');
  }
  return { projectId: project.id, projectCode: project.code ?? '', projectName: project.title ?? '' };
}
