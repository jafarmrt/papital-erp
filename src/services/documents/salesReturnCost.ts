import { and, eq, inArray, isNull } from 'drizzle-orm';
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
