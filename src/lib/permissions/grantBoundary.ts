import { isSystemAdminRole, permissionDefinition } from './permissionCatalog';

/**
 * v9.0.112 (TD-520، یافته B02-05، تصمیم ت۳ الف): مرز واگذاری دسترسی. دارنده غیرمدیر «مدیریت کاربران» یا «مدیریت
 * نقش‌ها» کاربران و نقش‌های دیگران را مدیریت می‌کند، ولی نقش خودش و مجوزهای نقش خودش را تغییر نمی‌دهد و فقط
 * مجوزهایی را می‌دهد که خودش دارد. این فایل میان سرور و فرم‌های نقش و کاربر مشترک است.
 */

/** مجوزهای کسی که واگذار می‌کند: `'all'` برای مدیر سیستم، وگرنه مجوزهای نقشش */
export type GrantorPermissions = 'all' | readonly string[];

export function grantorPermissionsOf(role: string | null | undefined, rolePermissions: readonly string[] | null | undefined): GrantorPermissions {
  if (isSystemAdminRole(role)) return 'all';
  return Array.isArray(rolePermissions) ? rolePermissions : [];
}

/** کلیدهایی از `keys` که واگذارکننده ندارد (برای مدیر سیستم همیشه خالی) */
export function permissionsBeyond(grantor: GrantorPermissions, keys: readonly string[]): string[] {
  if (grantor === 'all') return [];
  return [...new Set(keys.filter(k => !grantor.includes(k)))];
}

/** عنوان فارسی کلیدها برای پیام خطا؛ کلید ناشناخته با خودش */
export function permissionTitles(keys: readonly string[]): string {
  return keys.map(k => `«${permissionDefinition(k)?.title ?? k}»`).join('، ');
}
