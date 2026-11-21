import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { storefrontMenuItems, storefrontPages } from '../../db/schema.js';
import { MENU_LOCATIONS } from '../../lib/storefront/storefrontMenuRules.js';
import { PAGES_MAX } from '../../lib/storefront/storefrontPageRules.js';

/** v12 phase 10c: what links a menu and a page of «صفحه‌های سایت»: the pages a menu may name, and the menus that name a page */
export interface PageLinkTarget {
  /** the page's title as «صفحه‌های سایت» lists it */
  title: string;
  /** the page's address on the site */
  href: string;
  /** whether the address answers now: only while the page is published */
  live: boolean;
}

/**
 * v12 phase 10c (migration 0030): the pages a menu link («صفحهٔ متنی») may name, by row id; `ids` narrows the read to
 * the pages a menu names. Only a live page the shop made is here: a removed page is not, and the five base pages are
 * not either (their addresses never change, and the menu builder already offers them as «صفحه‌ای از سایت»). The page's
 * copy itself is not read, only whether there is one (10c review: reading each `published` cost half a second with 200 pages).
 */
export async function pageLinkTargets(executor: DbExecutor, ids?: readonly number[]): Promise<Map<number, PageLinkTarget>> {
  const out = new Map<number, PageLinkTarget>();
  if (ids && ids.length === 0) return out;
  const rows = await executor.select({
    id: storefrontPages.id, slug: storefrontPages.slug, title: storefrontPages.title, onSite: sql<boolean>`${storefrontPages.published} IS NOT NULL`,
  }).from(storefrontPages)
    .where(and(eq(storefrontPages.isDeleted, 0), eq(storefrontPages.kind, 'custom'), ids ? inArray(storefrontPages.id, [...new Set(ids)]) : undefined))
    .orderBy(asc(storefrontPages.id)).limit(PAGES_MAX);
  for (const row of rows) out.set(row.id, { title: row.title, href: `/pages/${row.slug}`, live: row.onSite === true });
  return out;
}

/**
 * The menu places («فهرست‌های سایت») with a live item that links to a page, so removing the page or taking it off the
 * site can say what it touches. An item switched off, or in a place that is off, counts too: it is still a link to mend.
 */
export async function menuPlacesOf(executor: DbExecutor, pageId: number): Promise<string[]> {
  const rows = await executor.select({ location: storefrontMenuItems.location }).from(storefrontMenuItems)
    .where(and(eq(storefrontMenuItems.targetPageId, pageId), eq(storefrontMenuItems.isDeleted, 0)));
  // in the order the menu builder shows its places
  const found = new Set(rows.map(r => r.location));
  return MENU_LOCATIONS.filter(location => found.has(location));
}
