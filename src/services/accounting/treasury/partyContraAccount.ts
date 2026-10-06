import { and, asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { accounts, bankAccounts } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { AccountMappingService } from '../accountMapping.service.js';
import {
  PERSONNEL_PURPOSES, needsChosenContraAccount, type PersonnelPurpose,
} from '../../../lib/treasury/partyPurpose.js';
import type { Account } from '../../../types.js';

export { PERSONNEL_PURPOSES, needsChosenContraAccount };
export type { PersonnelPurpose };

/**
 * v9.0.82 (TD-507، B04-11، تصمیم مالک محصول ت۴ الف): دریافت و پرداخت «متفرقه» و پرداخت پرسنل با هدف «سایر» سرفصل طرف
 * مقابل را از کاربر می‌گیرند. پیش‌تر «متفرقه» در «حساب‌های دریافتنی تجاری» (۱۲۰۱) و «سایر» پرسنل در «حقوق پرداختنی» (۳۲۰۱)
 * می‌نشست: اجاره کارگاه دارایی دریافتنی می‌ساخت و وام بانک دریافتنی‌های تجاری را کم می‌کرد.
 *
 * سرفصل انتخابی یک حساب معین فعال است، به‌جز حساب‌هایی که دفتر خودشان را دارند: دریافتنی و پرداختنی تجاری و حقوق پرداختنی
 * (کارت طرف حساب و فیش حقوق)، حساب‌های اسناد دریافتنی و پرداختنی چک (دفتر چک، TD-280)، حساب‌های موجودی کالا (کاردکس)،
 * حساب‌های بستن سال (خلاصه سود و زیان، تراز اختتامیه) و سرفصل هر حساب خزانه (مانده بانک، I15/I16). ثبت متفرقه در این حساب‌ها دفترشان را با دفتر کل ناهم‌خوان می‌کند.
 */
async function excludedContraAccountIds(tx?: DbExecutor): Promise<Set<number>> {
  const executor = tx || orm;
  const mapped = await Promise.all([
    AccountMappingService.getTradeReceivablesAccount(tx),
    AccountMappingService.getTradePayablesAccount(tx),
    AccountMappingService.getWagesPayableAccount(tx),
    AccountMappingService.getChequeReceivableAccount(tx),
    AccountMappingService.getChequeInCollectionAccount(tx),
    AccountMappingService.getChequeProtestAccount(tx),
    AccountMappingService.getChequePayableAccount(tx),
    AccountMappingService.getInventoryRawMaterialsAccount(tx),
    AccountMappingService.getWorkInProgressAccount(tx),
    AccountMappingService.getInventoryFinishedGoodsAccount(tx),
    AccountMappingService.getSummaryProfitLossAccount(tx),
    AccountMappingService.getClosingBalanceAccount(tx),
  ]);
  const ids = new Set<number>(mapped.filter((a): a is Account => a !== null).map(a => a.id));
  const banks = await executor.select({ accountId: bankAccounts.accountId }).from(bankAccounts)
    .where(and(eq(bankAccounts.isDeleted, 0), sql`${bankAccounts.accountId} IS NOT NULL`));
  for (const b of banks) if (b.accountId) ids.add(b.accountId);
  return ids;
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
  const excluded = await excludedContraAccountIds(tx);
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
  const excluded = await excludedContraAccountIds(tx);
  if (!acc || acc.level !== 'subsidiary' || (acc.isActive ?? 1) !== 1 || excluded.has(acc.id)) {
    throw new ValidationError(
      'سرفصل طرف مقابل انتخاب‌شده مجاز نیست؛ یک حساب معین فعال انتخاب کنید (دریافتنی و پرداختنی تجاری، حقوق، چک‌ها، موجودی کالا و سرفصل حساب‌های خزانه پذیرفته نمی‌شوند).',
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
