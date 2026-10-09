import type { DbExecutor } from '../../db/drizzle.js';
import { fin, FinancialDecimal } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';
import { AccountMappingService } from './accountMapping.service.js';
import { VoucherService } from './voucher.service.js';
import type { JournalVoucher } from '../../types.js';

/**
 * v10.0.42 (TD-1147, product-owner decision ت۱۵ الف): the inventory value a void leaves behind.
 *
 * Voiding a receipt whose removal empties the item's stock, or leaves a negative remaining value, keeps the item's WAC
 * (the same formula the Kardex replay uses) while the receipt's voucher is voided at its full value. Before this voucher
 * that difference stayed in the inventory accounts with no stock behind it. The void now posts it in its own transaction,
 * as a draft voucher like a stock count difference:
 *   ledger above stock: Dr «کسری و اضافات انبار» (7012) / Cr raw materials or finished goods
 *   ledger below stock: Dr raw materials or finished goods / Cr «کسری و اضافات انبار» (7012)
 * Amounts are rounded to the rial; less than one rial posts nothing.
 */
export const VOID_RESIDUE_REFERENCE_PREFIX = 'VOID-RESIDUE-';

export interface VoidResidueLine {
  itemType: string | null;
  /** ledger value left minus stock value left, in rials */
  residue: FinancialDecimal;
}

export interface VoidResidueSource {
  documentId: number;
  refNumber: string;
  date: string;
  username?: string;
}

export async function postVoidResidueVoucher(source: VoidResidueSource, lines: VoidResidueLine[], tx: DbExecutor): Promise<JournalVoucher | null> {
  let raw = fin(0);
  let finished = fin(0);
  for (const line of lines) {
    if (line.itemType === 'product') finished = finished.add(line.residue);
    else raw = raw.add(line.residue);
  }
  raw = raw.round(0);
  finished = finished.round(0);
  if (raw.isZero() && finished.isZero()) return null;

  const differenceAcc = await AccountMappingService.getInventoryCountDifferenceAccount(tx);
  const rawAcc = raw.isZero() ? null : await AccountMappingService.getInventoryRawMaterialsAccount(tx);
  const finishedAcc = finished.isZero() ? null : await AccountMappingService.getInventoryFinishedGoodsAccount(tx);
  if (!differenceAcc || (!raw.isZero() && !rawAcc) || (!finished.isZero() && !finishedAcc)) {
    throw new ValidationError('سرفصل «کسری و اضافات انبار» (۷۰۱۲) یا حساب‌های موجودی کالا در تنظیمات حسابداری یافت نشد.');
  }

  const description = `مانده ارزش انبار پس از ابطال سند ${source.refNumber}`;
  type VoucherLine = Parameters<typeof VoucherService.createJournalVoucher>[0]['items'][number];
  const voucherLines: VoucherLine[] = [];
  const line = (accountId: number, amount: FinancialDecimal, debitSide: boolean, what: string): VoucherLine => ({
    accountId, detailedType: 'other', detailedName: what, currency: 'IRR', description: `${what} — ${description}`,
    debit: debitSide ? amount : fin(0), credit: debitSide ? fin(0) : amount,
  });
  for (const [amount, account, label] of [[raw, rawAcc, 'مواد اولیه'], [finished, finishedAcc, 'کالای ساخته‌شده']] as const) {
    if (amount.isZero() || !account) continue;
    const excess = amount.isPositive();
    // ledger above stock: the inventory account is credited and the difference account debited, and the other way round
    voucherLines.push(line(account.id, amount.abs(), !excess, `${excess ? 'کاهش' : 'افزایش'} موجودی ${label}`));
    voucherLines.push(line(differenceAcc.id, amount.abs(), excess, excess ? 'کسری انبار' : 'اضافی انبار'));
  }

  return VoucherService.createJournalVoucher({
    date: source.date,
    voucherType: 'general',
    status: 'draft',
    description,
    referenceModule: 'inventory',
    referenceId: source.documentId,
    referenceNumber: `${VOID_RESIDUE_REFERENCE_PREFIX}${source.refNumber}`,
    currency: 'IRR',
    username: source.username,
    items: voucherLines,
  }, tx);
}
