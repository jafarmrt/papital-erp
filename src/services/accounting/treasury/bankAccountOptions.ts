import { asc, eq } from 'drizzle-orm';
import { orm } from '../../../db/drizzle.js';
import { bankAccounts } from '../../../db/schema.js';
import type { BankAccountOption } from '../../../types.js';

/**
 * v9.0.86 (TD-505، B04-09، تصمیم مالک محصول ت۷ الف): فهرست انتخاب حساب‌های خزانه برای فرم‌هایی که فقط حساب را
 * برمی‌گزینند (تسویه فاکتور، پرداخت حقوق، تغییر وضعیت چک): شناسه، کد، عنوان، نوع، نام بانک، ارز و «سرفصل دارد؟». شماره
 * حساب، کارت، شبا و مانده‌ها فقط در فهرست کامل (`GET /accounting/bank-accounts`) و فقط برای خوانندگان خزانه است. پیش‌تر
 * فهرست کامل با مانده خزانه، مانده دفتر و مغایرت به کاربران انبار و اسناد داده می‌شد. مانده‌ای حساب نمی‌شود.
 */
export async function getBankAccountOptions(): Promise<BankAccountOption[]> {
  const rows = await orm.select({
    id: bankAccounts.id,
    code: bankAccounts.code,
    title: bankAccounts.title,
    type: bankAccounts.type,
    bankName: bankAccounts.bankName,
    currency: bankAccounts.currency,
    accountId: bankAccounts.accountId,
  }).from(bankAccounts)
    .where(eq(bankAccounts.isDeleted, 0))
    .orderBy(asc(bankAccounts.code));
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    title: r.title,
    type: r.type as BankAccountOption['type'],
    bankName: r.bankName ?? null,
    currency: r.currency || 'IRR',
    hasLedgerAccount: r.accountId != null,
  }));
}
