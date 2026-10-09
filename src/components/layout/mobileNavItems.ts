import { canOpenPage, type ViewerAccess } from '../../lib/permissions/pageAccess';

/**
 * v10.0.17 (D-11): نوار پایین گوشی (پهنای کمتر از ۷۶۸ پیکسل) به جای فهرست کناری. هر دکمه با همان جدول دسترسی صفحه‌ها
 * (`PAGE_ACCESS`) دیده می‌شود که فهرست کناری و مسیرها می‌خوانند؛ دکمه «فهرست» همیشه هست و فهرست کناری را باز می‌کند.
 */
export interface MobileNavItem {
  path: string;
  label: string;
}

export const MOBILE_NAV_ITEMS: readonly MobileNavItem[] = [
  { path: '/', label: 'پیشخوان' },
  { path: '/approval-inbox', label: 'تأییدها' },
  { path: '/audit', label: 'شمارش انبار' },
  { path: '/piecework', label: 'کارکرد' },
];

export const MOBILE_MENU_LABEL = 'فهرست';

export function visibleMobileNavItems(viewer: ViewerAccess | null | undefined): MobileNavItem[] {
  return MOBILE_NAV_ITEMS.filter(item => canOpenPage(item.path, viewer));
}

/** مسیر فعال: پیشخوان فقط روی «/»، بقیه روی خود مسیر و زیرمسیرهایش */
export function isMobileNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === '/') return pathname === '/';
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
