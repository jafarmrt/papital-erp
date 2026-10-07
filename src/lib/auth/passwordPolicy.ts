/**
 * سیاست رمز عبور (v9.0.217، TD-532، یافته B02-17، تصمیم ت۵ الف): کمینه طول رمز یک ثابت مشترک سرور و مرورگر است و در
 * همه‌جا یکی است: ساختن، ویرایش و بازگرداندن کاربر به‌دست مدیر، تغییر رمز از نمایه، راه‌اندازی اولیه و فرم‌های همین‌ها.
 * پیش‌تر فرم نمایه ۴، مدیر ۶ و API نمایه و راه‌اندازی ۸ نویسه می‌خواستند.
 */
export const MIN_PASSWORD_LENGTH = 8;

const persianDigits = (n: number): string => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export const PASSWORD_TOO_SHORT_MESSAGE = `رمز عبور باید دست‌کم ${persianDigits(MIN_PASSWORD_LENGTH)} نویسه داشته باشد.`;

export const PASSWORD_LENGTH_HINT = `دست‌کم ${persianDigits(MIN_PASSWORD_LENGTH)} نویسه`;

/** پیام خطای طول رمز، یا null وقتی رمز کوتاه نیست */
export function passwordLengthError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH ? PASSWORD_TOO_SHORT_MESSAGE : null;
}
