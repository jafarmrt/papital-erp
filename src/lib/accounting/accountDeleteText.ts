import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v9.0.203 (TD-576، B03-34): متن تأیید حذف حساب. سرور حسابی را که در سندی به کار رفته یا زیرحساب دارد حذف نمی‌کند
 * (TD-546)؛ تأیید پیش از درخواست همین را می‌گوید و راه کنار گذاشتن حساب را، که غیرفعال کردن است، نشان می‌دهد.
 */
export function accountDeleteConfirmText(account: { name: string; code: string }): string {
  return `حساب «${account.name}» (کد ${toPersianDigits(account.code)}) حذف شود؟ حسابی که در سندی به کار رفته یا زیرحساب دارد حذف نمی‌شود؛ برای کنار گذاشتن چنین حسابی، آن را غیرفعال کنید.`;
}
