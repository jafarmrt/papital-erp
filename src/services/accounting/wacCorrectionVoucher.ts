import type { DbExecutor } from '../../db/drizzle.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';
import { AccountMappingService } from './accountMapping.service.js';
import { VoucherService } from './voucher.service.js';
import type { JournalVoucher } from '../../types.js';

/**
 * v9.0.84 (TD-487، تصمیم مالک محصول ت۳): سند حسابداری اصلاح WAC کالا از بازپخش کاردکس.
 *
 * اختلاف ارزش = موجودی × (WAC بازپخش − WAC پیشین)، همان روش انبارگردانی (stockAdjustmentVoucher):
 *   افزایش: بدهکار موجودی مواد اولیه یا کالای ساخته‌شده / بستانکار «کسری و اضافات انبار» (۷۰۱۲)
 *   کاهش:  بدهکار «کسری و اضافات انبار» / بستانکار موجودی مواد اولیه یا کالای ساخته‌شده
 * سند مانند دیگر اسناد خودکار پیش‌نویس صادر می‌شود. اختلاف صفر سند ندارد.
 */
export interface WacCorrectionVoucherSource {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemType: string;
  /** اختلاف ارزش با علامت (مثبت = افزایش ارزش موجودی) */
  valueDifference: FinancialDecimal;
  date: string;
  description: string;
  userId?: number;
  username?: string;
}

export const WAC_CORRECTION_REFERENCE_MODULE = 'inventory_wac_correction';

export async function issueWacCorrectionVoucher(source: WacCorrectionVoucherSource, tx: DbExecutor): Promise<JournalVoucher | null> {
  const amount = source.valueDifference.abs().round(4);
  if (!amount.isPositive()) return null;

  const differenceAcc = await AccountMappingService.getInventoryCountDifferenceAccount(tx);
  const inventoryAcc = source.itemType === 'product'
    ? await AccountMappingService.getInventoryFinishedGoodsAccount(tx)
    : await AccountMappingService.getInventoryRawMaterialsAccount(tx);
  if (!differenceAcc || !inventoryAcc) {
    throw new ValidationError('سرفصل «کسری و اضافات انبار» (۷۰۱۲) یا حساب موجودی کالا در تنظیمات حسابداری یافت نشد.');
  }

  const increase = source.valueDifference.isPositive();
  const inventoryWhat = source.itemType === 'product' ? 'موجودی کالای ساخته‌شده' : 'موجودی مواد اولیه';
  type VoucherLine = Parameters<typeof VoucherService.createJournalVoucher>[0]['items'][number];
  const line = (accountId: number, debit: FinancialDecimal, credit: FinancialDecimal, what: string): VoucherLine => ({
    accountId, detailedType: 'other', detailedName: what, debit, credit, currency: 'IRR', description: `${what} — ${source.description}`,
  });
  const lines = increase
    ? [line(inventoryAcc.id, amount, fin(0), `افزایش ${inventoryWhat}`), line(differenceAcc.id, fin(0), amount, 'اضافی ارزش انبار')]
    : [line(differenceAcc.id, amount, fin(0), 'کسری ارزش انبار'), line(inventoryAcc.id, fin(0), amount, `کاهش ${inventoryWhat}`)];

  return VoucherService.createJournalVoucher({
    date: source.date,
    voucherType: 'general',
    status: 'draft',
    description: source.description,
    referenceModule: WAC_CORRECTION_REFERENCE_MODULE,
    referenceId: source.itemId,
    referenceNumber: source.itemCode,
    currency: 'IRR',
    userId: source.userId,
    username: source.username,
    items: lines,
  }, tx);
}
