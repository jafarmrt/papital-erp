import { userHasRoleOrPermission } from '../../middleware/authorize.js';

/**
 * v9.0.21 (TD-433، تصمیم مالک محصول ت۶ الف): اطلاعات بانکی طرف حساب (شبا، کارت، حساب، بانک) فقط برای دارندگان
 * `customers.view`، `customers.manage` و هر مجوز `accounting.*` (و مدیر سامانه) فرستاده می‌شود؛ بقیه دارندگان مجوز خواندن
 * فهرست طرف حساب‌ها (انبار، اسناد، ارتباط با مشتری، پروژه، خرید) طرف حساب را بی `bankInfo` می‌گیرند. پیش‌تر `GET /customers`
 * و «تبدیل به مشتری» اطلاعات بانکی را به همه آن‌ها می‌دادند.
 */
export const PARTY_BANK_INFO_PERMISSIONS = [
  'customers.view',
  'customers.manage',
  'accounting.view',
  'accounting.reports',
  'accounting.vouchers',
  'accounting.treasury',
  'accounting.treasury_no_voucher',
  'accounting.cheques',
  'accounting.coa',
  'accounting.fiscal_close',
  'accounting.fiscal_reopen',
] as const;

export async function canSeePartyBankInfo(user: { role?: string } | undefined): Promise<boolean> {
  return userHasRoleOrPermission(user, ...PARTY_BANK_INFO_PERMISSIONS);
}

/** ردیف طرف حساب بی `bankInfo` (و نام قدیمی `bank_info`) */
export function withoutBankInfo<T extends object>(row: T): Omit<T, 'bankInfo' | 'bank_info'> {
  const { bankInfo: _bankInfo, bank_info: _legacy, ...rest } = row as T & { bankInfo?: unknown; bank_info?: unknown };
  return rest;
}

/** ردیف‌های طرف حساب برای این کاربر: با اطلاعات بانکی فقط اگر مجاز باشد */
export async function partyRowsForUser<T extends object>(user: { role?: string } | undefined, rows: T[]): Promise<Array<T | Omit<T, 'bankInfo' | 'bank_info'>>> {
  return (await canSeePartyBankInfo(user)) ? rows : rows.map(withoutBankInfo);
}
