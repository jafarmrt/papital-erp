import { canOpenPage, type ViewerAccess } from '../../lib/permissions/pageAccess';

/**
 * v10.0.17 (D-11): نوار پایین گوشی (پهنای کمتر از ۷۶۸ پیکسل) به جای فهرست کناری. هر دکمه با همان جدول دسترسی صفحه‌ها
 * (`PAGE_ACCESS`) دیده می‌شود که فهرست کناری و مسیرها می‌خوانند؛ دکمه «فهرست» همیشه هست و فهرست کناری را باز می‌کند.
 */
export interface MobileNavItem {
  path: string;
  label: string;
  /** v10.1.40 (N-01): the page the button opens instead when the viewer cannot open `path` (a project manager's review page) */
  fallbackPath?: string;
}

export const MOBILE_NAV_ITEMS: readonly MobileNavItem[] = [
  { path: '/', label: 'پیشخوان' },
  { path: '/workshop', label: 'کارگاه', fallbackPath: '/workshop/review' },
  { path: '/approval-inbox', label: 'تأییدها' },
  { path: '/projects', label: 'پروژه‌ها' },
  { path: '/audit', label: 'شمارش انبار' },
  { path: '/piecework', label: 'کارکرد' },
];

export const MOBILE_MENU_LABEL = 'فهرست';

/**
 * v10.2.7 (10.2 package 10): at most five page buttons beside «فهرست», so the bar keeps its six cells on a narrow phone;
 * a viewer who may open more pages keeps the first five in `MOBILE_NAV_ITEMS` order and reaches the rest from «فهرست»
 */
export const MOBILE_NAV_MAX_ITEMS = 5;

export function visibleMobileNavItems(viewer: ViewerAccess | null | undefined): MobileNavItem[] {
  return MOBILE_NAV_ITEMS.flatMap(item => {
    if (canOpenPage(item.path, viewer)) return [{ path: item.path, label: item.label }];
    if (item.fallbackPath && canOpenPage(item.fallbackPath, viewer)) return [{ path: item.fallbackPath, label: item.label }];
    return [];
  }).slice(0, MOBILE_NAV_MAX_ITEMS);
}

/** مسیر فعال: پیشخوان فقط روی «/»، بقیه روی خود مسیر و زیرمسیرهایش */
export function isMobileNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === '/') return pathname === '/';
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
