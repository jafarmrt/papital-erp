import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { documents, items, transactions } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import type { DbClient } from './types.js';

/**
 * v7.0.81 (TD-230, product-owner decision): a sales return (`return`, stock in) enters stock at the cost the
 * goods left with on the original sales invoice — the invoice's own Kardex `out` rows (WAC at the time of sale,
 * in IRR) — never at the sale price. Without an original invoice the item's current WAC is used.
 * The accounting voucher of the return reads the same cost back from the return's own Kardex rows, so the
 * Kardex value and the cost-of-sales reversal are always equal.
 */
export function parseReturnOfDocumentId(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`شناسه فاکتور مرجع برگشت از فروش نامعتبر است: ${String(raw)}`);
  }
  return id;
}

/** Validates the original invoice of a sales return: an active, final sales invoice. */
export async function assertReturnableInvoice(tx: DbClient, invoiceId: number): Promise<void> {
  const [inv] = await tx
    .select({ id: documents.id, type: documents.type, status: documents.status, refNumber: documents.refNumber })
    .from(documents)
    .where(and(eq(documents.id, invoiceId), eq(documents.isDeleted, 0)));
  if (!inv) {
    throw new ValidationError(`فاکتور مرجع برگشت از فروش (شناسه ${invoiceId}) یافت نشد یا ابطال شده است.`);
  }
  if (inv.type !== 'invoice' || inv.status !== 'final') {
    throw new ValidationError(`سند مرجع برگشت از فروش (شماره ${inv.refNumber}) فاکتور فروش نهایی نیست.`);
  }
}

const RETURN_QTY_TOLERANCE = 1e-9;

/**
 * v8.0.8 (TD-253): مقدار برگشت هر کالا با فاکتور مرجع از «فروخته‌شده در آن فاکتور منهای برگشت‌های نهایی قبلی همان
 * فاکتور» بیشتر نمی‌شود. فروخته‌شده = ردیف‌های فعال خروج کاردکس فاکتور؛ برگشت قبلی = ردیف‌های فعال ورود کاردکس
 * برگشت‌های همان فاکتور (برگشت ابطال‌شده یا پیش‌نویس حساب نمی‌شود، چون ردیف فعال ندارد). کالاها و سپس فاکتور مرجع
 * به ترتیب قفل می‌شوند (همان ترتیب نهایی‌سازی: کالا، سپس سند) تا دو برگشت همزمان هر دو از سقف نگذرند.
 * پیش‌تر برگشت بیش از مقدار فروخته‌شده و برگشت چندباره یک فاکتور پذیرفته می‌شد (موجودی و بستانکاری مشتری بی‌پشتوانه).
 */
export async function assertReturnWithinSold(
  tx: DbClient,
  invoiceId: number,
  lines: Array<{ itemId: unknown; quantity: unknown }>,
): Promise<void> {
  const requested = new Map<number, FinancialDecimal>();
  for (const line of lines) {
    const itemId = Number(line.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    requested.set(itemId, (requested.get(itemId) ?? fin(0)).add(fin(Number(line.quantity) || 0)));
  }
  const itemIds = [...requested.keys()].sort((a, b) => a - b);
  if (itemIds.length === 0) return;

  const lockedItems = await tx.select({ id: items.id, name: items.name, code: items.code })
    .from(items).where(inArray(items.id, itemIds)).orderBy(asc(items.id)).for('no key update'); // v8.0.47 (TD-320)
  const [invoice] = await tx.select({ id: documents.id, refNumber: documents.refNumber })
    .from(documents).where(eq(documents.id, invoiceId)).for('update');

  const sold = await tx.select({ itemId: transactions.itemId, quantity: transactions.quantity })
    .from(transactions)
    .where(and(eq(transactions.documentId, invoiceId), eq(transactions.type, 'out'), eq(transactions.isDeleted, 0),
      isNull(transactions.reversalOfId), inArray(transactions.itemId, itemIds)));
  const earlierReturns = await tx.select({ itemId: transactions.itemId, quantity: transactions.quantity })
    .from(transactions)
    .innerJoin(documents, eq(documents.id, transactions.documentId))
    .where(and(eq(documents.returnOfDocumentId, invoiceId), eq(documents.isDeleted, 0), eq(documents.type, 'return'),
      eq(transactions.type, 'in'), eq(transactions.isDeleted, 0), isNull(transactions.reversalOfId), inArray(transactions.itemId, itemIds)));

  const sumBy = (rows: Array<{ itemId: number; quantity: unknown }>) => {
    const out = new Map<number, FinancialDecimal>();
    for (const r of rows) out.set(r.itemId, (out.get(r.itemId) ?? fin(0)).add(fin(Number(r.quantity) || 0)));
    return out;
  };
  const soldBy = sumBy(sold);
  const returnedBy = sumBy(earlierReturns);
  for (const itemId of itemIds) {
    const soldQty = soldBy.get(itemId) ?? fin(0);
    const returnedQty = returnedBy.get(itemId) ?? fin(0);
    const want = requested.get(itemId) ?? fin(0);
    const returnable = soldQty.subtract(returnedQty);
    if (want.subtract(returnable).greaterThan(RETURN_QTY_TOLERANCE)) {
      const it = lockedItems.find(r => r.id === itemId);
      throw new ValidationError(
        `برگشت ${want.toString()} از کالای «${it?.name ?? itemId}» (${it?.code ?? '-'}) بیش از مانده قابل برگشت فاکتور «${invoice?.refNumber ?? invoiceId}» است: ` +
        `فروخته‌شده ${soldQty.toString()}، برگشت‌شده قبلی ${returnedQty.toString()}، قابل برگشت ${returnable.toString()}.`
      );
    }
  }
}

/**
 * Unit cost (IRR) at which each returned item enters stock.
 * - With an original invoice: the weighted cost of that invoice's active `out` Kardex rows of the item; an item
 *   that did not leave stock on that invoice is rejected. A row recorded without cost (legacy data) falls back
 *   to the current WAC.
 * - Without an original invoice, or as the fallback: the item's current WAC; an item without WAC is rejected.
 */
export async function resolveSalesReturnUnitCosts(
  tx: DbClient,
  returnOfDocumentId: number | null,
  itemIds: number[],
): Promise<Map<number, FinancialDecimal>> {
  const uniqueIds = [...new Set(itemIds.filter((id) => Number.isInteger(id) && id > 0))];
  const costs = new Map<number, FinancialDecimal>();
  if (uniqueIds.length === 0) return costs;

  if (returnOfDocumentId !== null) {
    await assertReturnableInvoice(tx, returnOfDocumentId);
    const rows = await tx
      .select({ itemId: transactions.itemId, quantity: transactions.quantity, totalPrice: transactions.totalPrice })
      .from(transactions)
      .where(and(
        eq(transactions.documentId, returnOfDocumentId),
        eq(transactions.type, 'out'),
        eq(transactions.isDeleted, 0),
        isNull(transactions.reversalOfId),
        inArray(transactions.itemId, uniqueIds),
      ));
    const sums = new Map<number, { qty: FinancialDecimal; total: FinancialDecimal }>();
    for (const r of rows) {
      const prev = sums.get(r.itemId) ?? { qty: fin(0), total: fin(0) };
      sums.set(r.itemId, { qty: prev.qty.add(r.quantity), total: prev.total.add(r.totalPrice) });
    }
    for (const id of uniqueIds) {
      const s = sums.get(id);
      if (!s || !s.qty.isPositive()) {
        const [it] = await tx.select({ name: items.name, code: items.code }).from(items).where(eq(items.id, id));
        throw new ValidationError(`کالای «${it?.name ?? id}» (${it?.code ?? '-'}) در فاکتور مرجع از انبار خارج نشده و برگشت آن با این فاکتور ثبت نمی‌شود.`);
      }
      const unitCost = s.total.divide(s.qty).round(4);
      if (unitCost.isPositive()) costs.set(id, unitCost);
    }
  }

  const missing = uniqueIds.filter((id) => !costs.has(id));
  if (missing.length > 0) {
    const rows = await tx
      .select({ id: items.id, name: items.name, code: items.code, wac: items.weightedAverageCost })
      .from(items)
      .where(inArray(items.id, missing));
    for (const id of missing) {
      const it = rows.find((r) => r.id === id);
      const wac = fin(it?.wac);
      if (!wac.isPositive()) {
        throw new ValidationError(
          `کالای «${it?.name ?? id}» (${it?.code ?? '-'}) بهای تمام‌شده ندارد؛ برگشت از فروش آن را با انتخاب فاکتور فروش اصلی ثبت کنید.`
        );
      }
      costs.set(id, wac);
    }
  }
  return costs;
}

/** Unit cost (IRR) per item recorded by a final sales return's own active `in` Kardex rows. */
export async function salesReturnKardexUnitCosts(tx: DbClient, returnDocumentId: number): Promise<Map<number, FinancialDecimal>> {
  const rows = await tx
    .select({ itemId: transactions.itemId, quantity: transactions.quantity, totalPrice: transactions.totalPrice })
    .from(transactions)
    .where(and(
      eq(transactions.documentId, returnDocumentId),
      eq(transactions.type, 'in'),
      eq(transactions.isDeleted, 0),
      isNull(transactions.reversalOfId),
    ));
  const sums = new Map<number, { qty: FinancialDecimal; total: FinancialDecimal }>();
  for (const r of rows) {
    const prev = sums.get(r.itemId) ?? { qty: fin(0), total: fin(0) };
    sums.set(r.itemId, { qty: prev.qty.add(r.quantity), total: prev.total.add(r.totalPrice) });
  }
  const costs = new Map<number, FinancialDecimal>();
  for (const [itemId, s] of sums) {
    if (s.qty.isPositive()) costs.set(itemId, s.total.divide(s.qty));
  }
  return costs;
}
