import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { journalVouchers } from '../../../db/schema.js';
import { ConflictError } from '../../../errors/customErrors.js';
import { VoucherService } from '../voucher.service.js';

/**
 * v9.0.58 (TD-503، B04-07، تصمیم مالک محصول ت۹ الف): اسناد افتتاحیه و اصلاح مانده اول دوره یک حساب خزانه که هنوز اثر
 * دارند — `treasury_opening` با شماره عطف همان کد حساب و ردیف تفصیلی همان حساب (سند برگشت `REV-V…` همین ماژول را
 * دارد ولی شناسه مرجعش شناسه سند است، نه حساب). سند برگشت‌خورده شمرده نمی‌شود.
 */
async function standingOpeningVouchers(tx: DbExecutor, bank: { id: number; code: string | null }) {
  const vouchers = await tx.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber, status: journalVouchers.status })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.isDeleted, 0),
      eq(journalVouchers.referenceModule, 'treasury_opening'),
      eq(journalVouchers.referenceId, bank.id),
      inArray(journalVouchers.voucherType, ['opening', 'adjustment']),
      sql`${journalVouchers.referenceNumber} = ${String(bank.code ?? '')}::text`,
      sql`EXISTS (SELECT 1 FROM journal_voucher_items i WHERE i.voucher_id = ${journalVouchers.id} AND i.is_deleted = 0
                   AND i.detailed_type = 'bank_account' AND i.detailed_id = ${bank.id})`,
    ))
    .orderBy(journalVouchers.id)
    .for('update');
  const standing: typeof vouchers = [];
  for (const v of vouchers) {
    const [reversal] = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceId, v.id),
        inArray(journalVouchers.referenceNumber, [`REV-V${v.voucherNumber}`, `VOID-REPOST-V${v.voucherNumber}`]),
        eq(journalVouchers.isDeleted, 0),
      ));
    if (!reversal) standing.push(v);
  }
  return standing;
}

/**
 * v9.0.58 (TD-503): حذف حساب خزانه اسناد مانده اول دوره‌اش را در همان تراکنش بی‌اثر می‌کند: پیش‌نویس حذف نرم، تأییدشده
 * سند معکوس (`voidSourceVoucher`). سند قطعی باطل نمی‌شود، پس حذف با ۴۰۹ و شماره سند رد می‌شود. پیش‌تر سند افتتاحیه فعال
 * می‌ماند و سرفصل بانک مانده‌ای داشت که هیچ حسابی آن را توضیح نمی‌داد. فراخواننده ردیف حساب را FOR UPDATE قفل کرده است.
 */
export async function voidBankOpeningVouchers(
  tx: DbExecutor,
  bank: { id: number; code: string | null; title: string },
  user?: { userId?: number; username?: string },
): Promise<void> {
  const standing = await standingOpeningVouchers(tx, bank);
  const permanent = standing.filter(v => v.status === 'permanent').map(v => String(v.voucherNumber));
  if (permanent.length > 0) {
    throw new ConflictError(
      `حساب «${bank.title}» سند قطعی مانده اول دوره ${permanent.join('، ')} دارد و سند قطعی باطل نمی‌شود؛ ` +
      'این حساب حذف نمی‌شود. حساب را غیرفعال کنید یا سند اصلاحی دستی ثبت کنید.'
    );
  }
  for (const v of standing) {
    await VoucherService.voidSourceVoucher({
      voucherId: v.id,
      reason: `حذف حساب خزانه «${bank.title}»`,
      userId: user?.userId,
      username: user?.username,
      externalTx: tx,
    });
  }
}
