import { House, LayoutGrid, Search, ShoppingBag, UserRound, Truck, Gift, Heart, Tag, Sparkles, BookOpen, Phone, MessageCircle, Store, Percent, type LucideIcon } from 'lucide-react';
import type { StorefrontPublicMenuItem, StorefrontPublicMenus } from '@erp/storefront/storefrontMenuContracts';

/**
 * v12 phase 9c (start plan V12_SITE_NEXT_START_PLAN.md §6): the menus the ERP's «فهرست‌های سایت» built. A place the ERP
 * sends as null (off, or nothing to show) keeps the site's fixed menu. The site takes nothing on trust: an address that
 * is not a path of the site or an https address, an unknown icon or role, or a label that is not text drops the item.
 */
export type SiteMenuItem = StorefrontPublicMenuItem;
export type SiteMenus = StorefrontPublicMenus;
export const NO_MENUS: SiteMenus = { header: null, drawer: null, footer: null, bottom: null };

export const MENU_ICON_COMPONENTS: Readonly<Record<string, LucideIcon>> = {
  home: House, grid: LayoutGrid, search: Search, bag: ShoppingBag, user: UserRound, truck: Truck, gift: Gift, heart: Heart,
  tag: Tag, sparkles: Sparkles, book: BookOpen, phone: Phone, message: MessageCircle, store: Store, percent: Percent,
};

const isSitePath = (href: string) => /^\/(?!\/)[^\s\\]*$/.test(href);
const isHttps = (href: string) => {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

function safeItem(raw: unknown, depth: number): SiteMenuItem | null {
  const v = raw as Partial<SiteMenuItem> | null;
  if (!v || typeof v !== 'object' || typeof v.label !== 'string' || !v.label.trim() || v.label.length > 60) return null;
  const href = typeof v.href === 'string' ? v.href : '';
  const external = v.external === true;
  if (href !== '' && !(external ? isHttps(href) : isSitePath(href))) return null;
  const children = depth === 0 && Array.isArray(v.children) ? v.children.flatMap(c => safeItem(c, 1) ?? []) : [];
  if (href === '' && children.length === 0) return null;
  return {
    label: v.label.trim(), href, external, icon: typeof v.icon === 'string' && Object.hasOwn(MENU_ICON_COMPONENTS, v.icon) ? v.icon : '',
    role: v.role === 'cart' || v.role === 'account' ? v.role : '', children,
  };
}

/** The ERP's answer as the pages may use it; any other shape is no menu (the fixed ones) */
export function safeMenus(raw: unknown): SiteMenus {
  const v = raw as Partial<Record<keyof SiteMenus, unknown>> | null;
  if (!v || typeof v !== 'object') return NO_MENUS;
  const place = (list: unknown) => {
    if (!Array.isArray(list)) return null;
    const items = list.slice(0, 12).flatMap(i => safeItem(i, 0) ?? []);
    return items.length ? items : null;
  };
  return { header: place(v.header), drawer: place(v.drawer), footer: place(v.footer), bottom: place(v.bottom) };
}

/** An item's link attributes: an address outside the site opens without telling it where the visitor came from */
export const outsideLink = (item: SiteMenuItem) => (item.external ? { rel: 'noopener noreferrer' } : {});
