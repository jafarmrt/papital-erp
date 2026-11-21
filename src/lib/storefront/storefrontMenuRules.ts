import { isSafeSitePath } from './storefrontSeoRules';

/**
 * v12 phase 9b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, owner's decisions 3 and 15): the rules of the site's menu
 * builder, shared by the server and the screen «منوهای سایت». Four places on the site take a menu; each is saved whole,
 * under its own version, and shows on the site only after its switch is on (until then the site keeps its fixed menu).
 */
export const MENU_LOCATIONS = ['header', 'drawer', 'footer', 'bottom'] as const;
export type MenuLocation = typeof MENU_LOCATIONS[number];
export const isMenuLocation = (value: unknown): value is MenuLocation => (MENU_LOCATIONS as readonly unknown[]).includes(value);

export const MENU_LOCATION_TITLES: Readonly<Record<MenuLocation, string>> = {
  header: 'منوی بالا',
  drawer: 'منوی همبرگری',
  footer: 'پاورقی',
  bottom: 'نوار پایین گوشی',
};

export const MENU_LOCATION_HINTS: Readonly<Record<MenuLocation, string>> = {
  header: 'سرصفحهٔ سایت در پهنای کامپیوتر؛ گزینهٔ دارای زیرگزینه با کلیک باز می‌شود.',
  drawer: 'فهرست کشویی گوشی؛ «حساب من» و «پیگیری سفارش» همیشه در پایانش می‌مانند.',
  footer: 'ستون‌های پیوند پایین صفحه؛ هر گزینهٔ سطح اول عنوان یک ستون است. ستون نشان و ستون «ارسال و پرداخت» ثابت‌اند.',
  bottom: 'نوار پایین صفحه در گوشی، ۳ تا ۵ دکمه با آیکون، فقط به صفحه‌های همین سایت. سبد فقط وقتی سایت سفارش می‌گیرد دیده می‌شود و عنوان دکمهٔ حساب خودکار است.',
};

/** Where an item leads. `none` is a heading that only opens its children */
export const MENU_LINK_KINDS = ['none', 'page', 'content', 'category', 'collection', 'campaign', 'product', 'path', 'url'] as const;
export type MenuLinkKind = typeof MENU_LINK_KINDS[number];
export const isMenuLinkKind = (value: unknown): value is MenuLinkKind => (MENU_LINK_KINDS as readonly unknown[]).includes(value);

export const MENU_LINK_KIND_TITLES: Readonly<Record<MenuLinkKind, string>> = {
  none: 'بی پیوند (فقط عنوان)',
  page: 'صفحه‌ای از سایت',
  category: 'دسته',
  collection: 'کالکشن',
  // v12 phase 10c: a page written in «صفحه‌های سایت», named by its row so the link follows a change of its address
  content: 'صفحهٔ متنی',
  campaign: 'صفحهٔ ویژه',
  product: 'محصول',
  path: 'نشانی درون سایت',
  url: 'نشانی بیرونی',
};

/** The fixed pages of the site a menu may name, with their addresses on the site (`storefront/app/routes.ts`) */
export const MENU_SITE_PAGES = {
  home: { title: 'خانه', path: '/' },
  products: { title: 'همهٔ محصولات', path: '/products' },
  categories: { title: 'دسته‌ها', path: '/categories' },
  search: { title: 'جست‌وجو', path: '/search' },
  cart: { title: 'سبد خرید', path: '/cart' },
  account: { title: 'حساب من', path: '/account' },
  track: { title: 'پیگیری سفارش', path: '/orders/track' },
  wholesale: { title: 'درخواست خرید عمده', path: '/wholesale' },
  corporate_gift: { title: 'هدیهٔ سازمانی', path: '/corporate-gift' },
  about: { title: 'دربارهٔ پاپیتال', path: '/about' },
  contact: { title: 'تماس با ما', path: '/contact' },
  shipping: { title: 'ارسال و پرداخت', path: '/shipping' },
  terms: { title: 'قوانین خرید', path: '/terms' },
  privacy: { title: 'حریم خصوصی', path: '/privacy' },
} as const satisfies Record<string, { title: string; path: string }>;
export type MenuSitePage = keyof typeof MENU_SITE_PAGES;
export const MENU_SITE_PAGE_KEYS = Object.keys(MENU_SITE_PAGES) as MenuSitePage[];
export const isMenuSitePage = (value: unknown): value is MenuSitePage => typeof value === 'string' && Object.hasOwn(MENU_SITE_PAGES, value);

/** The icons a button of the bottom bar may take; the site draws each with its own fixed icon */
export const MENU_ICONS = ['home', 'grid', 'search', 'bag', 'user', 'truck', 'gift', 'heart', 'tag', 'sparkles', 'book', 'phone', 'message', 'store', 'percent'] as const;
export type MenuIcon = typeof MENU_ICONS[number];
export const isMenuIcon = (value: unknown): value is MenuIcon => (MENU_ICONS as readonly unknown[]).includes(value);

export const MENU_ICON_TITLES: Readonly<Record<MenuIcon, string>> = {
  home: 'خانه', grid: 'دسته‌ها', search: 'جست‌وجو', bag: 'سبد', user: 'حساب', truck: 'کامیون', gift: 'هدیه', heart: 'قلب',
  tag: 'برچسب', sparkles: 'ستاره', book: 'کتاب', phone: 'تلفن', message: 'پیام', store: 'فروشگاه', percent: 'درصد',
};

export const MENU_LABEL_MAX = 40;
export const MENU_BOTTOM_LABEL_MAX = 12;
export const MENU_TARGET_MAX = 300;
export const MENU_URL_MAX = 500;
export const MENU_CHILDREN_MAX = 12;
export const MENU_TOP_MAX: Readonly<Record<MenuLocation, number>> = { header: 10, drawer: 10, footer: 4, bottom: 5 };
export const MENU_BOTTOM_MIN = 3;

export interface MenuItemValues {
  /** the saved row this item edits, or null for a new one */
  id: number | null;
  label: string;
  kind: MenuLinkKind;
  /** the page key, the category or collection name, the path or the address; '' for the other kinds */
  target: string;
  itemId: number | null;
  campaignId: number | null;
  pageId: number | null;
  icon: MenuIcon | '';
  isActive: boolean;
  children: MenuItemValues[];
}

/** An item as a form or a request carries it, before it is checked */
export interface MenuItemDraft {
  id?: number | null;
  label?: unknown;
  kind?: unknown;
  target?: unknown;
  itemId?: number | null;
  campaignId?: number | null;
  pageId?: number | null;
  icon?: unknown;
  isActive?: unknown;
  children?: MenuItemDraft[];
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * 9b review: a control character (C0 or C1: a NUL the database refuses, a bell, NEL), a direction override or an invisible mark has no
 * place in a menu. The zero-width non-joiner (U+200C) and joiner stay: Persian words need them.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
export const hasUnsafeChars = (value: string): boolean => UNSAFE_CHARS.test(value);
/** whether a label has a letter to see (not only spaces and joiners) */
const visible = (value: string) => value.replace(new RegExp(UNSAFE_CHARS.source, 'g'), '').replace(/[\s\u200c\u200d]/g, '') !== '';

/** An item and its children with every field the kind does not use emptied (a form keeps the others while one edits) */
export function normalizedMenuItem(location: MenuLocation, draft: MenuItemDraft): MenuItemValues {
  const kind = isMenuLinkKind(draft.kind) ? draft.kind : 'none';
  const takesTarget = kind === 'page' || kind === 'category' || kind === 'collection' || kind === 'path' || kind === 'url';
  return {
    id: typeof draft.id === 'number' && Number.isInteger(draft.id) && draft.id > 0 ? draft.id : null,
    label: text(draft.label).replace(/\s+/g, ' '),
    kind,
    target: takesTarget ? text(draft.target) : '',
    itemId: kind === 'product' && typeof draft.itemId === 'number' ? draft.itemId : null,
    campaignId: kind === 'campaign' && typeof draft.campaignId === 'number' ? draft.campaignId : null,
    pageId: kind === 'content' && typeof draft.pageId === 'number' ? draft.pageId : null,
    icon: location === 'bottom' && isMenuIcon(draft.icon) ? draft.icon : '',
    isActive: draft.isActive !== false,
    children: location === 'bottom' ? [] : (draft.children ?? []).map(child => normalizedMenuItem(location, { ...child, children: [] })),
  };
}

/**
 * A path inside the site: the same rule as a redirect's target (`isSafeSitePath`: one leading «/», never «//» or a
 * backslash, no dot segment, no space or control character)
 */
export const isMenuPath = (value: string): boolean => value.length <= MENU_TARGET_MAX && isSafeSitePath(value);

/**
 * An address outside the site: written as `https://` in lower case (the database checks the same text; 9b review: the
 * URL parser also took «HTTPS:», «https:x» and «https:\\x»), with a host and without a user name or password
 */
export function isMenuUrl(value: string): boolean {
  if (value.length > MENU_URL_MAX || /\s/.test(value) || hasUnsafeChars(value)) return false;
  if (!/^https:\/\/[^/?#\\@]+([/?#][^\\]*)?$/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export interface MenuProblem { message: string; field: string; code: string }

const problem = (message: string, field: string, code: string): MenuProblem => ({ message, field, code });

function itemProblem(location: MenuLocation, item: MenuItemValues, where: string, child: boolean): MenuProblem | null {
  const field = `${where}.label`;
  const labelMax = location === 'bottom' ? MENU_BOTTOM_LABEL_MAX : MENU_LABEL_MAX;
  if (!visible(item.label)) return problem(`عنوان ${where} را بنویسید.`, field, 'STOREFRONT_MENU_LABEL_REQUIRED');
  if (hasUnsafeChars(item.label) || hasUnsafeChars(item.target)) return problem(`«${item.label.replace(new RegExp(UNSAFE_CHARS.source, 'g'), '')}» نویسه‌ای نادیدنی یا کنترلی دارد؛ آن را دوباره بنویسید.`, field, 'STOREFRONT_MENU_TEXT_INVALID');
  if (item.label.length > labelMax) return problem(`عنوان «${item.label}» بیش از ${labelMax} نویسه است.`, field, 'STOREFRONT_MENU_LABEL_TOO_LONG');
  const target = `${where}.target`;
  switch (item.kind) {
    case 'none':
      if (child || location === 'bottom') return problem(`«${item.label}» پیوند ندارد؛ فقط گزینهٔ سطح اول با زیرگزینه می‌تواند بی پیوند باشد.`, target, 'STOREFRONT_MENU_LINK_REQUIRED');
      if (item.children.length === 0) return problem(`«${item.label}» بی پیوند است؛ دست‌کم یک زیرگزینه بیفزایید یا پیوندی برگزینید.`, target, 'STOREFRONT_MENU_HEADING_EMPTY');
      break;
    case 'page':
      if (!isMenuSitePage(item.target)) return problem(`صفحهٔ «${item.label}» را برگزینید.`, target, 'STOREFRONT_MENU_PAGE_INVALID');
      break;
    case 'category':
    case 'collection':
      if (!item.target || item.target.length > MENU_TARGET_MAX) return problem(`${item.kind === 'category' ? 'دسته' : 'کالکشن'}ِ «${item.label}» را برگزینید.`, target, 'STOREFRONT_MENU_TARGET_REQUIRED');
      break;
    case 'campaign':
      if (!item.campaignId) return problem(`صفحهٔ ویژهٔ «${item.label}» را برگزینید.`, target, 'STOREFRONT_MENU_TARGET_REQUIRED');
      break;
    case 'content':
      if (!item.pageId) return problem(`صفحهٔ متنی «${item.label}» را برگزینید.`, target, 'STOREFRONT_MENU_TARGET_REQUIRED');
      break;
    case 'product':
      if (!item.itemId) return problem(`محصول «${item.label}» را برگزینید.`, target, 'STOREFRONT_MENU_TARGET_REQUIRED');
      break;
    case 'path':
      if (!isMenuPath(item.target)) return problem(`نشانی «${item.label}» باید با یک «/» آغاز شود، بی فاصله و بی نام سایت.`, target, 'STOREFRONT_MENU_PATH_INVALID');
      break;
    case 'url':
      if (!isMenuUrl(item.target)) return problem(`نشانی بیرونی «${item.label}» باید با https:// آغاز شود.`, target, 'STOREFRONT_MENU_URL_INVALID');
      break;
  }
  if (item.kind !== 'none' && location === 'footer' && !child) {
    return problem(`گزینهٔ سطح اول پاورقی عنوان ستون است؛ «${item.label}» را «بی پیوند» کنید و پیوندها را زیرش بگذارید.`, target, 'STOREFRONT_MENU_FOOTER_HEADING');
  }
  // 9c review: the site makes no button of an outside address, so the bar would fall back to its fixed buttons
  if (location === 'bottom' && item.kind === 'url') return problem(`دکمهٔ «${item.label}» نوار پایین به بیرون از سایت می‌رود؛ نوار پایین فقط صفحه‌های همین سایت را می‌گیرد.`, target, 'STOREFRONT_MENU_BOTTOM_OUTSIDE');
  if (location === 'bottom' && !item.icon) return problem(`آیکون دکمهٔ «${item.label}» را برگزینید.`, `${where}.icon`, 'STOREFRONT_MENU_ICON_REQUIRED');
  if (child && item.children.length) return problem('منو فقط یک سطح زیرگزینه دارد.', where, 'STOREFRONT_MENU_TOO_DEEP');
  if (item.children.length > MENU_CHILDREN_MAX) return problem(`«${item.label}» بیش از ${MENU_CHILDREN_MAX} زیرگزینه دارد.`, where, 'STOREFRONT_MENU_TOO_MANY_CHILDREN');
  return null;
}

/** The first problem of a whole menu as it would be saved, or null; the same check on the screen and on the server */
export function menuProblem(location: MenuLocation, items: readonly MenuItemValues[], enabled: boolean): MenuProblem | null {
  const max = MENU_TOP_MAX[location];
  if (items.length > max) return problem(`${MENU_LOCATION_TITLES[location]} حداکثر ${max} گزینهٔ سطح اول دارد.`, 'items', 'STOREFRONT_MENU_TOO_MANY');
  for (const [i, item] of items.entries()) {
    const found = itemProblem(location, item, `گزینهٔ ${i + 1}`, false);
    if (found) return found;
    for (const [j, child] of item.children.entries()) {
      const deeper = itemProblem(location, child, `زیرگزینهٔ ${j + 1} از گزینهٔ ${i + 1}`, true);
      if (deeper) return deeper;
    }
  }
  if (location === 'bottom') {
    const pages = items.filter(i => i.kind === 'page').map(i => i.target);
    for (const once of ['cart', 'account'] as const) {
      if (pages.filter(p => p === once).length > 1) return problem(`«${MENU_SITE_PAGES[once].title}» در نوار پایین فقط یک بار می‌آید.`, 'items', 'STOREFRONT_MENU_BOTTOM_TWICE');
    }
    const shown = items.filter(i => i.isActive).length;
    if (enabled && shown < MENU_BOTTOM_MIN) return problem(`نوار پایین روشن دست‌کم ${MENU_BOTTOM_MIN} دکمهٔ روشن می‌خواهد.`, 'items', 'STOREFRONT_MENU_BOTTOM_FEW');
  }
  if (enabled && !items.some(i => i.isActive)) return problem(`${MENU_LOCATION_TITLES[location]} روشن بی هیچ گزینهٔ روشنی روی سایت خالی می‌ماند.`, 'items', 'STOREFRONT_MENU_EMPTY');
  return null;
}

/** The address of an item whose target the rules alone know (a page, a category, a collection, a path or an address) */
export function menuRuleHref(kind: MenuLinkKind, target: string): string | null {
  if (kind === 'page') return isMenuSitePage(target) ? MENU_SITE_PAGES[target].path : null;
  if (kind === 'category') return `/products?category=${encodeURIComponent(target)}`;
  if (kind === 'collection') return `/collections/${encodeURIComponent(target)}`;
  if (kind === 'path') return isMenuPath(target) ? target : null;
  if (kind === 'url') return isMenuUrl(target) ? target : null;
  return null;
}

/**
 * The menu the site shows today without the builder (`storefront/app/components/SiteHeader.tsx`, `SiteFooter.tsx` and
 * `BottomNav.tsx`), for «شروع از منوی کنونی سایت»: the owner starts from it instead of an empty place
 */
export function currentSiteMenu(location: MenuLocation, site: { categories: readonly string[]; collections: readonly string[] }): MenuItemValues[] {
  const link = (label: string, kind: MenuLinkKind, target: string, icon: MenuIcon | '' = '', children: MenuItemValues[] = []): MenuItemValues => ({
    id: null, label: label.slice(0, location === 'bottom' ? MENU_BOTTOM_LABEL_MAX : MENU_LABEL_MAX), kind, target,
    itemId: null, campaignId: null, pageId: null, icon, isActive: true, children,
  });
  const shop = [link('همهٔ محصولات', 'page', 'products'), ...site.categories.map(c => link(c, 'category', c))];
  if (location === 'bottom') {
    return [
      link('خانه', 'page', 'home', 'home'), link('دسته‌ها', 'page', 'categories', 'grid'), link('جست‌وجو', 'page', 'search', 'search'),
      link('سبد', 'page', 'cart', 'bag'), link('حساب من', 'page', 'account', 'user'),
    ];
  }
  if (location === 'footer') {
    const info = (['about', 'contact', 'shipping', 'terms', 'privacy'] as const).map(key => link(MENU_SITE_PAGES[key].title, 'page', key));
    return [
      link('خرید', 'none', '', '', shop.slice(0, MENU_CHILDREN_MAX)),
      ...(site.collections.length ? [link('کالکشن‌ها', 'none', '', '', site.collections.slice(0, MENU_CHILDREN_MAX).map(c => link(c, 'collection', c)))] : []),
      link('پاپیتال', 'none', '', '', info),
    ];
  }
  return shop.slice(0, MENU_TOP_MAX[location]);
}
