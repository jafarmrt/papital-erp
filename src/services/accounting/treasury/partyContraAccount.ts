import { and, asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { accounts } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { AccountMappingService } from '../accountMapping.service.js';
import {
  PERSONNEL_PURPOSES, needsChosenContraAccount, type PersonnelPurpose,
} from '../../../lib/treasury/partyPurpose.js';
import type { Account } from '../../../types.js';
import { CONTROL_ACCOUNT_PATHS, controlAccountName, type ControlAccountEntry } from '../../../lib/accounting/controlAccounts.js';
import { toPersianDigits } from '../../../utils/persianNumber.js';

export { PERSONNEL_PURPOSES, needsChosenContraAccount };
export type { PersonnelPurpose };

/**
 * v9.0.82 (TD-507، B04-11، تصمیم مالک محصول ت۴ الف): دریافت و پرداخت «متفرقه» و پرداخت پرسنل با هدف «سایر» سرفصل طرف
 * مقابل را از کاربر می‌گیرند. پیش‌تر «متفرقه» در «حساب‌های دریافتنی تجاری» (۱۲۰۱) و «سایر» پرسنل در «حقوق پرداختنی» (۳۲۰۱)
 * می‌نشست: اجاره کارگاه دارایی دریافتنی می‌ساخت و وام بانک دریافتنی‌های تجاری را کم می‌کرد.
 *
 * سرفصل انتخابی یک حساب معین فعال است، به‌جز حساب‌هایی که دفتر خودشان را دارند و حساب‌های بستن سال (خلاصه سود و زیان،
 * تراز اختتامیه). v11 phase 6.1b (M6, decision ت۵۲-۲): the accounts with their own book are the control accounts of the
 * manual voucher rule (`AccountMappingService.controlAccountsById`): besides the treasury, party, wages, cheque and inventory accounts excluded
 * before, now the insurance and payroll tax payables (paid from the monthly list, with its month cap), the other payroll
 * deductions and eidi payables, the employee advances and every posting account of the inventory group 14. Before, a
 * «متفرقه» payment settled the tax office or the eidi without their own pages, and a 1404 debit left the Kardex behind.
 */
async function excludedContraAccounts(tx: DbExecutor): Promise<Map<number, ControlAccountEntry | null>> {
  const excluded = new Map<number, ControlAccountEntry | null>(await AccountMappingService.controlAccountsById(tx));
  // v10.0.262 (OWN-01): روی اتصال تراکنش یک پرس‌وجو در هر لحظه
  for (const resolve of [AccountMappingService.getSummaryProfitLossAccount, AccountMappingService.getClosingBalanceAccount]) {
    const account = await resolve.call(AccountMappingService, tx);
    if (account && !excluded.has(account.id)) excluded.set(account.id, null);
  }
  return excluded;
}

export interface ContraAccountOption {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

/** سرفصل‌هایی که فرم خزانه و دفتر چک برای «متفرقه» و «سایر» پیشنهاد می‌دهند؛ همان قاعده‌ای که سرور هنگام ثبت می‌سنجد */
export async function choosableContraAccounts(tx?: DbExecutor): Promise<ContraAccountOption[]> {
  const executor = tx || orm;
  const excluded = await excludedContraAccounts(executor);
  const rows = await executor.select({ id: accounts.id, code: accounts.code, name: accounts.name, accountType: accounts.accountType })
    .from(accounts)
    .where(and(
      eq(accounts.isDeleted, 0),
      eq(accounts.level, 'subsidiary'),
      sql`COALESCE(${accounts.isActive}, 1) = 1`,
    ))
    .orderBy(asc(accounts.code));
  return rows.filter(r => !excluded.has(r.id));
}

/** سرفصل طرف مقابلی که کاربر انتخاب کرده است؛ اگر در فهرست مجاز نباشد ۴۲۲ */
export async function requireChoosableContraAccount(tx: DbExecutor | undefined, accountId: number): Promise<Account> {
  const executor = tx || orm;
  const [acc] = await executor.select().from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.isDeleted, 0)));
  const excluded = await excludedContraAccounts(executor);
  const control = acc ? excluded.get(acc.id) : undefined;
  if (control) {
    throw new ValidationError(
      `سرفصل ${controlAccountName(control, toPersianDigits)} حساب کنترلی است و ثبت آن از ${CONTROL_ACCOUNT_PATHS[control.kind]} است؛ برای «متفرقه» و «سایر» یک حساب معین دیگر انتخاب کنید.`,
      { account: control },
      'TREASURY_CONTRA_ACCOUNT_INVALID',
    );
  }
  if (!acc || acc.level !== 'subsidiary' || (acc.isActive ?? 1) !== 1 || excluded.has(acc.id)) {
    throw new ValidationError(
      'سرفصل طرف مقابل انتخاب‌شده مجاز نیست؛ یک حساب معین فعال انتخاب کنید (حساب‌های کنترلی و حساب‌های بستن سال پذیرفته نمی‌شوند).',
      undefined,
      'TREASURY_CONTRA_ACCOUNT_INVALID',
    );
  }
  return acc as unknown as Account;
}

/**
 * ورودی طرف حساب پیش از ثبت: پرداخت یا دریافت پرسنل هدف می‌خواهد و «متفرقه» و «سایر» سرفصل طرف مقابل. خروجی همان چیزی
 * است که روی ردیف ذخیره می‌شود (هدف فقط برای پرسنل، سرفصل فقط وقتی انتخاب کاربر است).
 */
export function normalizePartyPurpose(
  partyType: string,
  purpose: string | null | undefined,
  contraAccountId: number | null | undefined,
): { purpose: PersonnelPurpose | null; contraAccountId: number | null } {
  let resolvedPurpose: PersonnelPurpose | null = null;
  if (partyType === 'personnel') {
    if (!purpose) {
      throw new ValidationError('برای پرسنل، نوع پرداخت (تسویه حقوق، مساعده یا سایر) را انتخاب کنید.', undefined, 'TREASURY_PURPOSE_REQUIRED');
    }
    if (!(PERSONNEL_PURPOSES as readonly string[]).includes(purpose)) {
      throw new ValidationError('نوع پرداخت پرسنل نامعتبر است.', undefined, 'TREASURY_PURPOSE_REQUIRED');
    }
    resolvedPurpose = purpose as PersonnelPurpose;
  }
  if (!needsChosenContraAccount(partyType, resolvedPurpose)) {
    return { purpose: resolvedPurpose, contraAccountId: null };
  }
  if (!contraAccountId) {
    throw new ValidationError(
      partyType === 'personnel'
        ? 'برای پرداخت «سایر» به پرسنل، سرفصل طرف مقابل را انتخاب کنید.'
        : 'برای طرف حساب «متفرقه»، سرفصل طرف مقابل را انتخاب کنید.',
      undefined,
      'TREASURY_CONTRA_ACCOUNT_REQUIRED',
    );
  }
  return { purpose: resolvedPurpose, contraAccountId };
}
