import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { storefrontMenuItems, storefrontNews } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { MENU_LOCATIONS } from '../../lib/storefront/storefrontMenuRules.js';
import { newsOnSite } from './storefrontNewsPublic.js';

/** v12 phase 10d: what links a menu and the news of «خبرهای سایت»: the items a menu may name, and the menus that name an item */
export interface NewsLinkTarget {
  /** the item's title as «خبرهای سایت» lists it */
  title: string;
  /** the item's address on the site */
  href: string;
  /** whether the address answers now: the switch of the news is on, the item is published and its day has come */
  live: boolean;
}
/** the newest items the menu builder offers to choose from (one already chosen stays with its link whatever its place) */
export const NEWS_LINK_OPTIONS_MAX = 200;

/**
 * v12 phase 10d (migration 0034): the news items a menu link («خبر») may name, by row id; `ids` narrows the read to the
 * items a menu names, otherwise the newest are read. A removed item is not here. The item's copy itself is not read,
 * only whether it is on the site now.
 */
export async function newsLinkTargets(executor: DbExecutor, ids?: readonly number[]): Promise<Map<number, NewsLinkTarget>> {
  const out = new Map<number, NewsLinkTarget>();
  if (ids && ids.length === 0) return out;
  const [enabled, today] = [await newsOnSite(executor), await businessTodayIsoDate()];
  const rows = await executor.select({
    id: storefrontNews.id, slug: storefrontNews.slug, title: storefrontNews.title,
    onSite: sql<boolean>`${storefrontNews.published} IS NOT NULL AND ${storefrontNews.publishedDate} <= ${today}`,
  }).from(storefrontNews)
    .where(and(eq(storefrontNews.isDeleted, 0), ids ? inArray(storefrontNews.id, [...new Set(ids)]) : undefined))
    .orderBy(desc(sql`coalesce(${storefrontNews.newsDate}, ${storefrontNews.publishedDate})`), desc(storefrontNews.id))
    .limit(ids ? Math.max(1, ids.length) : NEWS_LINK_OPTIONS_MAX);
  for (const row of rows) out.set(row.id, { title: row.title, href: `/news/${row.slug}`, live: enabled && row.onSite === true });
  return out;
}

/** Whether the site has its list of news now: the switch is on and an item is on the site (otherwise `/news` is a 404) */
export async function newsListLive(executor: DbExecutor): Promise<boolean> {
  if (!await newsOnSite(executor)) return false;
  const [row] = await executor.select({ id: storefrontNews.id }).from(storefrontNews)
    .where(and(eq(storefrontNews.isDeleted, 0), isNotNull(storefrontNews.published), lte(storefrontNews.publishedDate, await businessTodayIsoDate()))).limit(1);
  return Boolean(row);
}

/**
 * The menu places («فهرست‌های سایت») with a live item that links to a news item, so removing the item or taking it off
 * the site can say what it touches. An item switched off, or in a place that is off, counts too: it is still a link to mend.
 */
export async function newsMenuPlacesOf(executor: DbExecutor, newsId: number): Promise<string[]> {
  const rows = await executor.select({ location: storefrontMenuItems.location }).from(storefrontMenuItems)
    .where(and(eq(storefrontMenuItems.targetNewsId, newsId), eq(storefrontMenuItems.isDeleted, 0)));
  const found = new Set(rows.map(r => r.location));
  return MENU_LOCATIONS.filter(location => found.has(location));
}
