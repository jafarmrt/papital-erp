/**
 * v9.0.392 (TD-622، B01-42، تصمیم ت۸): قاعده‌ها و پیام‌های راه‌اندازی اولیه، مشترک سرور (`POST /setup`) و جادوگر
 * (`SetupPage`). نام شرکت پیش‌فرض ندارد و اجباری است، چون روی سربرگ فاکتورها چاپ می‌شود؛ پیش‌تر اگر کاربر آن را عوض
 * نمی‌کرد «سامانه جامع ERP پاپیتال» چاپ می‌شد. پیام‌ها واژه انگلیسی و نام متغیر محیطی ندارند؛ نام متغیر فقط در متن
 * راهنمای فیلد رمز راه‌اندازی و به‌صورت کد می‌آید.
 */

export const SETUP_USERNAME_MIN_LENGTH = 3;

export const SETUP_USERNAME_TOO_SHORT_MESSAGE = 'نام کاربری باید دست‌کم ۳ نویسه داشته باشد.';

export const SETUP_COMPANY_NAME_REQUIRED_MESSAGE = 'نام فروشگاه یا شرکت را وارد کنید؛ این نام روی سربرگ فاکتورها چاپ می‌شود.';

export const SETUP_IN_PROGRESS_MESSAGE = 'راه‌اندازی اولیه هم‌اکنون از جای دیگری در جریان است. چند لحظه بعد دوباره تلاش کنید.';

export const SETUP_TOKEN_NOT_CONFIGURED_MESSAGE =
  'رمز راه‌اندازی در کارساز تعیین نشده یا کوتاه‌تر از ۱۶ نویسه است. مدیر کارساز باید آن را تعیین کند؛ راهنمای زیر فیلد «رمز راه‌اندازی» را ببینید.';

/** v9.0.393 (TD-621، B01-41): گام ۱ جادوگر بی رمز راه‌اندازی پیش نمی‌رود */
export const SETUP_TOKEN_REQUIRED_MESSAGE = 'رمز راه‌اندازی را وارد کنید.';

export const SETUP_ALREADY_DONE_MESSAGE = 'سامانه پیش‌تر راه‌اندازی شده است.';

export const SETUP_DEFAULT_PASSWORD_MESSAGE = 'رمز عبور مدیر نمی‌تواند رمز پیش‌فرض باشد.';

/** Why the setup form may not send this company name, or null */
export function setupCompanyNameError(companyName: string): string | null {
  return companyName.trim() ? null : SETUP_COMPANY_NAME_REQUIRED_MESSAGE;
}
