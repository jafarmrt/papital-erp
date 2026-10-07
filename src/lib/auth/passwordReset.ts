/**
 * v9.0.219 (TD-523، یافته B02-08، تصمیم ت۵ الف): رمزی که مدیر برای کاربر دیگری می‌گذارد (ساخت، بازنشانی، بازگرداندن)
 * موقت است. تا خود کاربر آن را عوض نکند، سرور جز این مسیرها هر درخواستی را با ۴۰۳ `PASSWORD_RESET_REQUIRED` رد می‌کند و
 * مرورگر فقط برگه تغییر رمز را با دکمه «خروج» نشان می‌دهد. مشترک سرور (`authenticateToken`) و مرورگر.
 */

export const PASSWORD_RESET_REQUIRED = 'PASSWORD_RESET_REQUIRED';

export const PASSWORD_RESET_REQUIRED_MESSAGE = 'رمز عبور شما موقت است؛ برای ادامه کار، رمز تازه‌ای بگذارید.';

/** نشست، نمایه خود (برای تغییر رمز)، مجوزهای خود، توکن CSRF و خروج */
export const PASSWORD_RESET_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/me',
  '/api/me',
  '/api/users/profile',
  '/api/users/my-permissions',
  '/api/csrf',
  '/api/auth/csrf',
  '/api/logout',
  '/api/auth/logout',
]);

export function isPasswordResetAllowedPath(path: string): boolean {
  return PASSWORD_RESET_ALLOWED_PATHS.has(path.replace(/\/+$/, ''));
}

interface PasswordResetFlags {
  mustResetPassword?: boolean | number | null;
  must_reset_password?: boolean | number | null;
}

/** آیا کاربر باید پیش از هر کار دیگری رمزش را عوض کند (پرچم پایگاه داده یا پاسخ ورود و `/auth/me`) */
export function mustChangePassword(user: PasswordResetFlags | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.mustResetPassword ?? user.must_reset_password);
}
