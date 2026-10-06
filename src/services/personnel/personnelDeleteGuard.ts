import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { accounts, journalVoucherItems, journalVouchers, personnel, pieceworkLogs, pieceworkPayrolls } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import { voucherItemCurrencySql } from '../accounting/voucherItemAmount.js';
import { workLogFreeOfLivePayroll } from '../piecework/workLogPayrollLink.js';

/**
 * v9.0.29 (TD-441، تصمیم مالک محصول D4 الف): پرسنلی که فیش تسویه‌نشده، کارکرد بی فیش یا مانده حساب تفصیلی دارد حذف
 * نمی‌شود؛ راه جایگزین «قطع همکاری» است (هم‌راستا با TD-431). پیش‌تر حذف نرم بی هیچ بررسی بود: پرسنلی با فیش
 * تأییدشده پرداخت‌نشده ۸۷٬۰۰۰٬۰۰۰ ریالی حذف شد و از فهرست پرسنل و طرف حساب‌های تفصیلی افتاد.
 * مانده فقط روی حساب‌های دائم سنجیده می‌شود: ردیف هزینه حقوق (حساب موقت) در سند فیش تفصیلی پرسنل دارد و تا بستن سال
 * مانده می‌گیرد، اما بدهی به پرسنل نیست.
 */

/** فیش زنده‌ای که هنوز گام بعدی دارد (پیش‌نویس، تأییدشده، پرداخت بخشی)؛ فیش پرداخت‌شده یا حذف‌شده مانع نیست */
export const OPEN_PAYROLL_STATUSES = ['draft', 'approved', 'partially_paid'] as const;
const TEMPORARY_ACCOUNT_TYPES = ['revenue', 'expense', 'cost_of_sales'];
const LISTED = 5;

type Personnel = typeof personnel.$inferSelect;

export interface PersonnelDeleteBlockers {
  openPayrollNumbers: string[];
  freeWorkLogCount: number;
  /** مانده اسناد تأییدشده و دائم هر ارز روی حساب‌های دائم (بدهکار − بستانکار، ارز خود ردیف) */
  balances: Array<{ currency: string; balance: string }>;
  draftVoucherNumbers: number[];
}

/** ردیف‌های تفصیلی این پرسنل: با شناسه، یا ردیف قدیمی بی شناسه با همان نام */
function personnelDetailedRows(person: Personnel) {
  const name = (person.fullName ?? '').trim();
  const byId = eq(journalVoucherItems.detailedId, person.id);
  return and(
    eq(journalVoucherItems.detailedType, 'personnel'),
    name ? or(byId, and(isNull(journalVoucherItems.detailedId), sql`btrim(${journalVoucherItems.detailedName}) = ${name}::text`)) : byId,
  );
}

export async function findPersonnelDeleteBlockers(person: Personnel, db: DbExecutor): Promise<PersonnelDeleteBlockers> {
  const openPayrolls = await db.select({ payrollNumber: pieceworkPayrolls.payrollNumber })
    .from(pieceworkPayrolls)
    .where(and(
      eq(pieceworkPayrolls.personnelId, person.id), eq(pieceworkPayrolls.isDeleted, 0),
      or(isNull(pieceworkPayrolls.status), inArray(pieceworkPayrolls.status, [...OPEN_PAYROLL_STATUSES])),
    ))
    .orderBy(asc(pieceworkPayrolls.id));

  const [freeLogs] = await db.select({ n: sql<number>`COUNT(*)::int` })
    .from(pieceworkLogs)
    .where(and(eq(pieceworkLogs.personnelId, person.id), eq(pieceworkLogs.isDeleted, 0), workLogFreeOfLivePayroll()));

  const rows = personnelDetailedRows(person);
  const balanceRows = await db.select({
    currency: voucherItemCurrencySql,
    balance: sql<string>`COALESCE(SUM(COALESCE(${journalVoucherItems.debit}, 0) - COALESCE(${journalVoucherItems.credit}, 0)), 0)::text`,
  })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(
      eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0), inArray(journalVouchers.status, ['approved', 'permanent']),
      notInArray(accounts.accountType, TEMPORARY_ACCOUNT_TYPES), rows,
    ))
    .groupBy(voucherItemCurrencySql);
  const balances = balanceRows
    .filter(r => fin(r.balance).abs().greaterThanOrEqual(VOUCHER_BALANCE_TOLERANCE))
    .map(r => ({ currency: String(r.currency), balance: fin(r.balance).toString() }));

  const draftVouchers = await db.selectDistinct({ voucherNumber: journalVouchers.voucherNumber })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0), eq(journalVouchers.status, 'draft'), rows))
    .orderBy(asc(journalVouchers.voucherNumber));

  return {
    openPayrollNumbers: openPayrolls.map(p => p.payrollNumber),
    freeWorkLogCount: Number(freeLogs?.n ?? 0),
    balances,
    draftVoucherNumbers: draftVouchers.map(v => Number(v.voucherNumber)),
  };
}

function listed(values: Array<string | number>): string {
  const shown = values.slice(0, LISTED).map(String).join('، ');
  return values.length > LISTED ? `${shown} و ${toPersianDigits(values.length - LISTED)} مورد دیگر` : shown;
}

/** دلیل‌های فارسی رد حذف؛ آرایه خالی یعنی حذف آزاد است */
export function describePersonnelDeleteBlockers(b: PersonnelDeleteBlockers): string[] {
  const reasons: string[] = [];
  if (b.openPayrollNumbers.length > 0) reasons.push(`فیش حقوق تسویه‌نشده شماره ${listed(b.openPayrollNumbers)}`);
  if (b.freeWorkLogCount > 0) reasons.push(`${toPersianDigits(b.freeWorkLogCount)} کارکرد ثبت‌شده بی فیش`);
  if (b.balances.length > 0) {
    const amounts = b.balances.map(x => `${formatPersianPrice(fin(x.balance).abs().toString(), x.currency, 2)} ${fin(x.balance).isNegative() ? 'بستانکار' : 'بدهکار'}`);
    reasons.push(`مانده حساب ${amounts.join(' و ')}`);
  }
  if (b.draftVoucherNumbers.length > 0) reasons.push(`سند حسابداری پیش‌نویس شماره ${listed(b.draftVoucherNumbers)}`);
  return reasons;
}

/** پیش از حذف نرم، زیر قفل ردیف پرسنل صدا زده می‌شود */
export async function assertPersonnelDeletable(person: Personnel, db: DbExecutor): Promise<void> {
  const blockers = await findPersonnelDeleteBlockers(person, db);
  const reasons = describePersonnelDeleteBlockers(blockers);
  if (reasons.length === 0) return;
  throw new ConflictError(
    `پرسنل «${person.fullName}» حذف نمی‌شود: ${reasons.join('؛ ')}. نخست این موارد را تسویه یا تکلیف کنید، یا وضعیت همکاری را «قطع همکاری» بگذارید.`,
    { code: 'PERSONNEL_HAS_OPEN_ITEMS', ...blockers },
  );
}
