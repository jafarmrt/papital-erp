import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v9.0.203 (TD-576، B03-34): متن تأیید حذف حساب. سرور حسابی را که در سندی به کار رفته یا زیرحساب دارد حذف نمی‌کند
 * (TD-546)؛ تأیید پیش از درخواست همین را می‌گوید و راه کنار گذاشتن حساب را، که غیرفعال کردن است، نشان می‌دهد.
 */
export function accountDeleteConfirmText(account: { name: string; code: string }): string {
  return `حساب «${account.name}» (کد ${toPersianDigits(account.code)}) حذف شود؟ حسابی که در سندی به کار رفته یا زیرحساب دارد حذف نمی‌شود؛ برای کنار گذاشتن چنین حسابی، آن را غیرفعال کنید.`;
}

/**
 * v10.0.124 (TD-1123): غیرفعال کردن و فعال کردن دوباره حساب. سرور (`PUT /accounting/accounts/:id` با `isActive`) از
 * v9.0.200 آن را می‌پذیرد و پیام حذف کاربر را به غیرفعال کردن می‌فرستاد، ولی صفحه چنین دکمه‌ای نداشت. حساب سیستمی
 * غیرفعال نمی‌شود (۴۰۹ `ACCOUNT_IS_SYSTEM`)، پس دکمه‌ای هم ندارد.
 */
export function accountActiveAction(account: { isSystem?: number | null; isActive?: number | boolean | null }): { next: boolean; label: string } | null {
  if (account.isSystem === 1) return null;
  const active = account.isActive === undefined || account.isActive === null ? true : Boolean(account.isActive);
  return active ? { next: false, label: 'غیرفعال کردن' } : { next: true, label: 'فعال کردن دوباره' };
}

export function accountActiveConfirmText(account: { name: string; code: string }, next: boolean): string {
  const name = `«${account.name}» (کد ${toPersianDigits(account.code)})`;
  return next
    ? `حساب ${name} دوباره فعال شود؟ در فرم‌های سند دوباره پیشنهاد می‌شود.`
    : `حساب ${name} غیرفعال شود؟ ردیف‌های سندهای پیشین آن می‌ماند، ولی در سند تازه به کار نمی‌رود.`;
}
