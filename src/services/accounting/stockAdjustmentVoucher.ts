import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, transactions } from '../../db/schema.js';
import { fin, FinancialDecimal } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';
import { AccountMappingService } from './accountMapping.service.js';
import { VoucherService } from './voucher.service.js';
import type { JournalVoucher } from '../../types.js';

/**
 * v8.0.3 (TD-255 / TD-262، تصمیم مالک محصول ۱۲ مهر ۱۴۰۵): سند حسابداری اصلاح موجودی — انبارگردانی و درون‌ریزی اکسل.
 *
 * ارزش هر ردیف همان بهای ثبت‌شده در کاردکس است (مقدار × قیمت ردیف)، پس دفتر کل با ارزش انبار یکی می‌ماند:
 *   کسری:  بدهکار «کسری و اضافات انبار» / بستانکار موجودی مواد اولیه یا کالای ساخته‌شده
 *   اضافی: بدهکار موجودی مواد اولیه یا کالای ساخته‌شده / بستانکار «کسری و اضافات انبار»
 * سند مانند دیگر اسناد خودکار پیش‌نویس صادر می‌شود. ردیف بی‌ارزش (کالای بدون WAC) سطری نمی‌سازد و اصلاح بی‌ارزش
 * سند ندارد. پیش از v8.0.3 انبارگردانی و اصلاح اکسل هیچ سند حسابداری نداشتند و ارزش انبار از دفتر کل جدا می‌شد.
 */
export interface StockAdjustmentVoucherSource {
  /** سند انبارگردانی (documents.type = 'audit')؛ سند حسابداری با source_document_id به آن پیوند می‌خورد */
  documentId?: number;
  /** ردیف‌های کاردکس بدون سند (اصلاح موجودی از درون‌ریزی اکسل) */
  transactionIds?: number[];
  date: string;
  refNumber: string;
  description: string;
  userId?: number;
  username?: string;
}

interface AdjustmentTotals {
  shortageRaw: FinancialDecimal;
  shortageFinished: FinancialDecimal;
  surplusRaw: FinancialDecimal;
  surplusFinished: FinancialDecimal;
}

export async function syncStockAdjustmentVoucher(source: StockAdjustmentVoucherSource, tx: DbExecutor): Promise<JournalVoucher | null> {
  let condition;
  if (source.documentId !== undefined) {
    condition = and(eq(transactions.documentId, source.documentId), eq(transactions.isDeleted, 0), isNull(transactions.reversalOfId));
  } else {
    const ids = (source.transactionIds ?? []).filter(id => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return null;
    condition = and(inArray(transactions.id, ids), eq(transactions.isDeleted, 0));
  }

  const rows = await tx.select({
    type: transactions.type,
    quantity: transactions.quantity,
    unitPrice: transactions.unitPrice,
    itemType: items.type,
  })
    .from(transactions)
    .innerJoin(items, eq(items.id, transactions.itemId))
    .where(condition);

  const totals: AdjustmentTotals = { shortageRaw: fin(0), shortageFinished: fin(0), surplusRaw: fin(0), surplusFinished: fin(0) };
  for (const row of rows) {
    const value = fin(row.quantity).multiply(fin(row.unitPrice));
    const finished = row.itemType === 'product';
    if (row.type === 'out') {
      if (finished) totals.shortageFinished = totals.shortageFinished.add(value);
      else totals.shortageRaw = totals.shortageRaw.add(value);
    } else if (row.type === 'in') {
      if (finished) totals.surplusFinished = totals.surplusFinished.add(value);
      else totals.surplusRaw = totals.surplusRaw.add(value);
    }
  }
  const shortageRaw = totals.shortageRaw.round(4);
  const shortageFinished = totals.shortageFinished.round(4);
  const surplusRaw = totals.surplusRaw.round(4);
  const surplusFinished = totals.surplusFinished.round(4);
  const shortage = shortageRaw.add(shortageFinished);
  const surplus = surplusRaw.add(surplusFinished);
  if (!shortage.isPositive() && !surplus.isPositive()) return null;

  const differenceAcc = await AccountMappingService.getInventoryCountDifferenceAccount(tx);
  const rawAcc = await AccountMappingService.getInventoryRawMaterialsAccount(tx);
  const finishedAcc = await AccountMappingService.getInventoryFinishedGoodsAccount(tx);
  const needsRaw = shortageRaw.isPositive() || surplusRaw.isPositive();
  const needsFinished = shortageFinished.isPositive() || surplusFinished.isPositive();
  if (!differenceAcc || (needsRaw && !rawAcc) || (needsFinished && !finishedAcc)) {
    throw new ValidationError('سرفصل «کسری و اضافات انبار» (۷۰۱۲) یا حساب‌های موجودی کالا در تنظیمات حسابداری یافت نشد.');
  }

  type VoucherLine = Parameters<typeof VoucherService.createJournalVoucher>[0]['items'][number];
  const lines: VoucherLine[] = [];
  const inventoryLine = (accountId: number, debit: FinancialDecimal, credit: FinancialDecimal, what: string): VoucherLine => ({
    accountId, detailedType: 'other', detailedName: what, debit, credit, currency: 'IRR', description: `${what} — ${source.description}`,
  });
  if (shortage.isPositive()) {
    lines.push(inventoryLine(differenceAcc.id, shortage, fin(0), 'کسری انبار'));
    if (shortageRaw.isPositive() && rawAcc) lines.push(inventoryLine(rawAcc.id, fin(0), shortageRaw, 'کاهش موجودی مواد اولیه'));
    if (shortageFinished.isPositive() && finishedAcc) lines.push(inventoryLine(finishedAcc.id, fin(0), shortageFinished, 'کاهش موجودی کالای ساخته‌شده'));
  }
  if (surplus.isPositive()) {
    if (surplusRaw.isPositive() && rawAcc) lines.push(inventoryLine(rawAcc.id, surplusRaw, fin(0), 'افزایش موجودی مواد اولیه'));
    if (surplusFinished.isPositive() && finishedAcc) lines.push(inventoryLine(finishedAcc.id, surplusFinished, fin(0), 'افزایش موجودی کالای ساخته‌شده'));
    lines.push(inventoryLine(differenceAcc.id, fin(0), surplus, 'اضافی انبار'));
  }

  return VoucherService.createJournalVoucher({
    date: source.date,
    voucherType: 'general',
    status: 'draft',
    description: source.description,
    referenceModule: 'inventory',
    referenceId: source.documentId ?? null,
    referenceNumber: source.refNumber,
    sourceDocumentId: source.documentId ?? null,
    currency: 'IRR',
    userId: source.userId,
    username: source.username,
    items: lines,
  }, tx);
}
