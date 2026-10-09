/**
 * v9.0.220 (TD-539، یافته B02-24): پیام و شمارش معکوس قفل ورود از یک جا، مشترک سرور و صفحه ورود. سرور در پاسخ ۴۲۹ قفل
 * `locked: true` و `remainingMinutes` می‌فرستد و صفحه ورود قفل را فقط از همین دو فیلد می‌شناسد، نه از متن پیام؛ ۴۲۹
 * محدودکننده عمومی درخواست‌ها قفل نیست و شمارشی نمی‌سازد. قفل برای جفت «نام کاربری و نشانی» (یا پس از تلاش‌های بسیار برای
 * کل حساب) است و محدودکننده ورود برای نشانی؛ پیام‌ها همین را می‌گویند و ارقامشان فارسی است.
 */

const persianDigits = (value: string | number): string => String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** قفل تدریجی نام کاربری و نشانی، یا قفل کل حساب؛ برای نام کاربری موجود و ناموجود یکسان */
export function usernameLockoutMessage(minutes: number): string {
  return `ورود با این نام کاربری از این دستگاه به دلیل تلاش‌های ناموفق پیاپی موقتاً بسته است؛ ${persianDigits(minutes)} دقیقه دیگر دوباره تلاش کنید.`;
}

/** محدودکننده ورود: تلاش‌های ناموفق از یک نشانی با هر نام کاربری */
export function addressLockoutMessage(minutes: number): string {
  return `ورود از این دستگاه به دلیل تلاش‌های ناموفق پیاپی موقتاً بسته است؛ ${persianDigits(minutes)} دقیقه دیگر دوباره تلاش کنید.`;
}

/** v10.0.22 (TD-961): تغییر رمز از نمایه پس از چند رمز فعلی نادرست پیاپی */
export function passwordChangeLockoutMessage(minutes: number): string {
  return `تغییر رمز به دلیل واردکردن پیاپی رمز فعلی نادرست موقتاً بسته است؛ ${persianDigits(minutes)} دقیقه دیگر دوباره تلاش کنید.`;
}

/** دقیقه‌های باقی‌مانده تا پایان پنجره، دست‌کم ۱ */
export function minutesUntil(resetTime: Date | number | undefined, now: number = Date.now()): number {
  const at = resetTime instanceof Date ? resetTime.getTime() : Number(resetTime);
  if (!Number.isFinite(at)) return 1;
  return Math.max(1, Math.ceil((at - now) / 60_000));
}

/** دقیقه‌های قفل از پاسخ ۴۲۹ (`locked` و `remainingMinutes`)؛ پاسخی که قفل نیست null */
export function loginLockoutMinutes(response: unknown): number | null {
  if (!response || typeof response !== 'object') return null;
  const { locked, remainingMinutes } = response as { locked?: unknown; remainingMinutes?: unknown };
  const minutes = Number(remainingMinutes);
  return locked === true && Number.isFinite(minutes) && minutes > 0 ? Math.ceil(minutes) : null;
}

/** شمارش معکوس «دقیقه:ثانیه» با ارقام فارسی، مانند ۰۴:۰۰ */
export function formatLockoutCountdown(secondsLeft: number): string {
  const seconds = Math.max(0, Math.floor(secondsLeft));
  const pad = (n: number) => String(n).padStart(2, '0');
  return persianDigits(`${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`);
}
