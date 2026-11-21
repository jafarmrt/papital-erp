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
  products: Array<{ itemId: number; name: string; sku: string }>;
}
