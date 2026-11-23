import type { MenuItemDraft, MenuItemValues, MenuLocation } from './storefrontMenuRules';

/**
 * v12 phase 9b: the answers of the ERP's menu builder (`/api/storefront/menus`), one contract for the server and the
 * screen «منوهای سایت» (`AGENTS.md` §6.5).
 */
export interface MenuItemRow extends Omit<MenuItemValues, 'children'> {
  id: number;
  /** what the link leads to, for the screen («محصول: …»); '' for a heading or a fixed target */
  targetTitle: string;
  /** whether the site would show this link now: a category or collection with items on the site, a campaign page on and
   * inside its window, a product on the site. A broken link is kept but not shown */
  live: boolean;
  children: MenuItemRow[];
}

export interface MenuView {
  location: MenuLocation;
  enabled: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
  items: MenuItemRow[];
}

export interface MenusView {
  menus: MenuView[];
}

export interface MenuSaveInput {
  enabled: boolean;
  version: number;
  items: MenuItemDraft[];
}

/** What a link may name: the targets on the site now (a campaign also while off, marked) */
export interface MenuLinkOptions {
  categories: string[];
  collections: string[];
  campaigns: Array<{ id: number; title: string; live: boolean }>;
  /** v12 phase 10c: the pages the shop made in «صفحه‌های سایت» (also while one is not published, marked); the five base pages are «صفحه‌ای از سایت» */
  pages: Array<{ id: number; title: string; live: boolean }>;
  /** v12 phase 10d: the newest news items of «خبرهای سایت» (also while one is not on the site, marked) */
  news: Array<{ id: number; title: string; live: boolean }>;
  products: Array<{ itemId: number; name: string; sku: string }>;
}

/**
 * v12 phase 9c (`GET /api/storefront/v1/menus`, its own security review, `AGENTS.md` §1.9c): an item as the site gets it.
 * Only what a visitor sees: the label, the address the ERP built, whether it leaves the site, the bottom bar's icon and
 * which item is the cart or the account (the site hides the cart while it takes no order, and names the account button
 * by the visitor's sign-in). No row id, no editor, no off or broken item.
 */
export interface StorefrontPublicMenuItem {
  label: string;
  /** a path of the site, an https address, or '' for a heading that only opens its children */
  href: string;
  external: boolean;
  icon: string;
  role: 'cart' | 'account' | '';
  children: StorefrontPublicMenuItem[];
}

/** Each place on, with what it shows; null = off or nothing to show, and the site keeps its fixed menu */
export type StorefrontPublicMenus = Record<'header' | 'drawer' | 'footer' | 'bottom', StorefrontPublicMenuItem[] | null>;
