import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { journalVouchers, workflowInstances } from '../../../db/schema.js';
import { BusinessLogicError, ConflictError, ValidationError } from '../../../errors/customErrors.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';
import { toPersianDigits } from '../../../utils/persianNumber.js';
import { VoucherService } from '../voucher.service.js';

/**
 * v9.0.70 (TD-503، B04-07، تصمیم مالک محصول ت۹ الف): اسناد افتتاحیه و اصلاح مانده اول دوره یک حساب خزانه که هنوز اثر
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
 * v9.0.70 (TD-503): حذف حساب خزانه اسناد مانده اول دوره‌اش را در همان تراکنش بی‌اثر می‌کند: پیش‌نویس حذف نرم، تأییدشده
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

/**
 * v9.0.71 (TD-504، B04-08، تصمیم مالک محصول ت۸ الف): تا گردش‌کار تأیید حساب خزانه باز است، مانده اول دوره ویرایش نمی‌شود.
 * پیش‌تر ویرایش، چون سند افتتاحیه هنوز نبود، `issueTreasuryOpeningVoucher` را مستقیم صدا می‌زد و سند بی تأیید صادر می‌شد؛
 * تأیید بعدی همان سند را برمی‌گرداند. فراخواننده ردیف حساب را FOR UPDATE قفل کرده است.
 */
export async function assertNoPendingOpeningApproval(tx: DbExecutor, bank: { id: number; title: string }): Promise<void> {
  const [open] = await tx.select({ id: workflowInstances.id }).from(workflowInstances)
    .where(and(
      eq(workflowInstances.entityType, 'bank_account'),
      eq(workflowInstances.entityId, String(bank.id)),
      eq(workflowInstances.status, 'IN_PROGRESS'),
    ))
    .limit(1);
  if (open) {
    throw new ConflictError(
      `مانده اول دوره حساب «${bank.title}» در انتظار تأیید گردش‌کار است و تا پایان آن ویرایش نمی‌شود؛ ` +
      'پس از تأیید یا رد، دوباره ویرایش کنید.'
    );
  }
}

/** 10.3 package 4 (OBS-R1-65): the label of «تاریخ آغاز حساب» in the refusals of `resolveTreasuryWriteDate` */
export const BANK_OPENING_DATE_LABEL = 'تاریخ آغاز حساب';

/**
 * 10.3 package 4 (OBS-R1-65): the account's opening voucher (`voucher_type` opening of `treasury_opening`, any status, a
 * reversed one too), the one `issueTreasuryOpeningVoucher` issues once; an adjustment of the opening balance is not one.
 */
export async function openingVoucherOf(tx: DbExecutor, bankId: number): Promise<{ id: number; voucherNumber: number; status: string | null } | undefined> {
  const [voucher] = await tx.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber, status: journalVouchers.status })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.referenceModule, 'treasury_opening'),
      eq(journalVouchers.referenceId, bankId),
      eq(journalVouchers.voucherType, 'opening'),
      eq(journalVouchers.isDeleted, 0),
    ))
    .orderBy(journalVouchers.id)
    .limit(1);
  return voucher;
}

/**
 * 10.3 package 4 (OBS-R1-65, decision ت۴۷ item 2): the start date of a treasury account dates its opening voucher, so the
 * two never differ. It changes freely while that voucher is not issued (also while the account's approval is open: the
 * approval issues the voucher with the date it then finds). v11 phase 3.1 (M2): the opening voucher is sourced and is no
 * longer edited on the voucher page, so while it is a draft a new start date re-dates it here, in the same transaction
 * (a start date in a closed fiscal year is refused, `assertOpeningYearOpen`); once it is approved or permanent the date is
 * fixed (422 `BANK_OPENING_DATE_LOCKED`). Before, the draft's date was edited in the voucher itself and then differed from
 * the account's start date. The caller has locked the account row FOR UPDATE.
 */
export async function moveOpeningVoucherDate(tx: DbExecutor, bank: { id: number; title: string }, date: string): Promise<void> {
  const voucher = await openingVoucherOf(tx, bank.id);
  if (!voucher) return;
  if (voucher.status === 'draft') {
    await assertOpeningYearOpen(tx, bank, date);
    await VoucherService.updateJournalVoucher(voucher.id, { date }, tx);
    return;
  }
  throw new ValidationError(
    `${BANK_OPENING_DATE_LABEL} «${bank.title}» پس از تأیید سند افتتاحیه (شمارهٔ ${toPersianDigits(voucher.voucherNumber)}) تغییر نمی‌کند.`,
    { voucherId: voucher.id },
    'BANK_OPENING_DATE_LOCKED',
  );
}

/**
 * 10.3 package 4 (OBS-R1-65): the opening voucher is issued with the account's start date, so a start date in a closed
 * fiscal year is refused with a message that names it and how to move it (422 `BANK_OPENING_DATE_YEAR_CLOSED`), instead of
 * the voucher's general refusal: at create, at the approval that issues the voucher, and at the edit that gives a
 * zero-balance account its first balance.
 */
export async function assertOpeningYearOpen(tx: DbExecutor, bank: { title: string }, date: string): Promise<void> {
  try {
    await VoucherService.checkFiscalPeriodOpen(date, tx);
  } catch (err) {
    if (!(err instanceof BusinessLogicError)) throw err;
    throw new ValidationError(
      `${BANK_OPENING_DATE_LABEL} «${bank.title}» (${toPersianDigits(isoToJalaliDate(date) || date)}) در سال مالی بسته است و ` +
      `سند افتتاحیه با آن صادر نمی‌شود؛ ${BANK_OPENING_DATE_LABEL} را در ویرایش حساب به سال مالی باز ببرید.`,
      { date },
      'BANK_OPENING_DATE_YEAR_CLOSED',
    );
  }
}
