import { MENU_LINK_KINDS, MENU_LINK_KIND_TITLES, isMenuPath, isMenuSitePage, isMenuUrl, type MenuLinkKind } from './storefrontMenuRules.js';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): a link chosen the way a menu item's is, for a button
 * outside the menus (a slide of the home page, a banner). The kinds and their rules are the menu's own
 * (`storefrontMenuRules.ts`): a page of the site, a page of «صفحه‌های سایت», a news item, a category, a collection,
 * a «صفحهٔ ویژه», a product, a path of the site or an https address. A page, a news item, a campaign and a product are
 * named by their row, so the link follows a change of address and leaves the site with its target.
 */
export const SITE_LINK_KINDS = MENU_LINK_KINDS.filter((kind): kind is Exclude<MenuLinkKind, 'none'> => kind !== 'none');
export type SiteLinkKind = typeof SITE_LINK_KINDS[number];
export const SITE_LINK_KIND_TITLES: Readonly<Record<SiteLinkKind, string>> = MENU_LINK_KIND_TITLES;

export interface SiteLink {
  kind: SiteLinkKind;
  /** a page's key, a category's or collection's name, a path or an address; '' for a link named by a row */
  target: string;
  itemId: number | null;
  campaignId: number | null;
  pageId: number | null;
  newsId: number | null;
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;
const NAME_MAX = 120;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A link with every field its kind does not use emptied (a form keeps the others while one edits) */
export function normalizedSiteLink(kind: SiteLinkKind, draft: Partial<SiteLink>): SiteLink {
  const takesTarget = kind === 'page' || kind === 'category' || kind === 'collection' || kind === 'path' || kind === 'url';
  return {
    kind,
    target: takesTarget && typeof draft.target === 'string' ? draft.target.trim() : '',
    itemId: kind === 'product' && isId(draft.itemId) ? draft.itemId : null,
    campaignId: kind === 'campaign' && isId(draft.campaignId) ? draft.campaignId : null,
    pageId: kind === 'content' && isId(draft.pageId) ? draft.pageId : null,
    newsId: kind === 'news' && isId(draft.newsId) ? draft.newsId : null,
  };
}

export type CheckedSiteLink = { link: SiteLink | null; problem: null } | { link: null; problem: string };

/**
 * A link as it is kept, from whatever a request carried; `null` (or nothing) is no link. A kind with no target yet is a
 * problem: unlike a title, half a link is nothing a draft can keep.
 */
export function checkedSiteLink(raw: unknown, title: string): CheckedSiteLink {
  if (raw === null || raw === undefined) return { link: null, problem: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { link: null, problem: `«${title}» خوانا نیست.` };
  const value = raw as Record<string, unknown>;
  const extra = Object.keys(value).find(key => !['kind', 'target', 'itemId', 'campaignId', 'pageId', 'newsId'].includes(key));
  if (extra !== undefined) return { link: null, problem: `«${title}» فیلد ناشناختهٔ «${extra.slice(0, 40)}» دارد.` };
  if (typeof value.kind !== 'string' || !(SITE_LINK_KINDS as readonly string[]).includes(value.kind)) return { link: null, problem: `نوع «${title}» شناخته نیست.` };
  if (value.target !== undefined && typeof value.target !== 'string') return { link: null, problem: `مقصد «${title}» خوانا نیست.` };
  const link = normalizedSiteLink(value.kind as SiteLinkKind, value as Partial<SiteLink>);
  // half of a surrogate pair is refused by PostgreSQL as text, and a control or direction-override character is never
  // part of a name or an address (10e review)
  if (LONE_SURROGATE.test(link.target) || UNSAFE.test(link.target)) return { link: null, problem: `مقصد «${title}» خوانا نیست.` };
  // a path of the site needs no quote, angle bracket or backtick as written, as a page's own button holds (`pageLink`);
  // an outside address follows the menu's rule alone (a real one may hold an apostrophe)
  if (link.kind === 'path' && /[<>"'`]/.test(link.target)) return { link: null, problem: `«${title}» نباید نشانه‌های < > " ' یا \` داشته باشد.` };
  const missing = { link: null, problem: `مقصد «${title}» را برگزینید.` };
  switch (link.kind) {
    case 'page': return isMenuSitePage(link.target) ? { link, problem: null } : missing;
    case 'category': case 'collection':
      if (!link.target) return missing;
      return link.target.length > NAME_MAX ? { link: null, problem: `مقصد «${title}» خوانا نیست.` } : { link, problem: null };
    case 'path': return isMenuPath(link.target) ? { link, problem: null } : { link: null, problem: `«${title}» باید مسیری از همین سایت باشد که با «/» آغاز می‌شود.` };
    case 'url': return isMenuUrl(link.target) ? { link, problem: null } : { link: null, problem: `«${title}» باید نشانی‌ای باشد که با https:// آغاز می‌شود.` };
    case 'product': return link.itemId === null ? missing : { link, problem: null };
    case 'campaign': return link.campaignId === null ? missing : { link, problem: null };
    case 'content': return link.pageId === null ? missing : { link, problem: null };
    case 'news': return link.newsId === null ? missing : { link, problem: null };
    default: return missing;
  }
}

/** A link for the audit row: its kind and where it leads */
export function siteLinkWords(link: SiteLink | null): string {
  if (!link) return '';
  const where = link.kind === 'product' ? `کالا ${link.itemId}` : link.kind === 'campaign' ? `صفحهٔ ویژه ${link.campaignId}`
    : link.kind === 'content' ? `صفحهٔ متنی ${link.pageId}` : link.kind === 'news' ? `خبر ${link.newsId}` : link.target;
  return `${link.kind}: ${where}`;
}
