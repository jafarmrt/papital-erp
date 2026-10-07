import { isSystemAdminRole } from '../permissions/permissionCatalog';

/** نام «مدیر سیستم» وقتی ردیف نقش مدیر نامی ندارد */
export const SYSTEM_ADMIN_ROLE_NAME = 'مدیر سیستم';

/**
 * v9.0.224 (TD-540، یافته B02-25): نامی که رابط برای نقش نشان می‌دهد نام ذخیره‌شده خود نقش است، نه کد آن؛ فهرست ساده
 * کاربران و رویداد ورود سجل از همین تابع می‌خوانند. نقشی که ردیفش نیست نامی ندارد.
 */
export function roleDisplayName(roleCode: string | null | undefined, storedName: string | null | undefined): string {
  const name = String(storedName ?? '').trim();
  return name || (isSystemAdminRole(roleCode ?? '') ? SYSTEM_ADMIN_ROLE_NAME : '');
}
