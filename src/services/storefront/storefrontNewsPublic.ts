import type { Request } from 'express';
import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings, mediaAssets, storefrontContentAssets, storefrontNews } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { NEWS_MAX, NEWS_SECTION_KINDS, newsExcerpt } from '../../lib/storefront/storefrontNewsRules.js';
import type { PageSection } from '../../lib/storefront/storefrontPageRules.js';
import {
  NEWS_EXCERPT_MAX, NEWS_SITE_PAGE_SIZE, STOREFRONT_NEWS_SETTING_KEYS as KEYS,
  type StorefrontNewsCard, type StorefrontNewsIndexRow, type StorefrontNewsList, type StorefrontPublicNews,
} from '../../lib/storefront/storefrontNewsPublicContracts.js';
import { MEDIA_FILE_NAME, imageOf, imagesOf, isoOf, pageForSite, type Images } from './storefrontPagePublic.js';

/**
 * v12 phase 10d (start plan §7.2; `AGENTS.md` §1.9): «خبرهای سایت» as the site reads them, and the switch «خبرها روی
 * سایت بیایند» (`sf_news_enabled`, off by default: until the shop turns it on the site has no news at all). An item is on
 * the site when the switch is on, it is not removed, it has a published copy and its day has come (Tehran). What goes
 * out is that copy alone: never the draft, an item waiting for its day, an editor's name, a row id or a library id.
 */
type NewsRecord = typeof storefrontNews.$inferSelect;
const notFound = () => new NotFoundError('خبر پیدا نشد.', undefined, 'STOREFRONT_NEWS_NOT_FOUND');

/** Whether «خبرها روی سایت بیایند» is on */
export async function newsOnSite(executor: DbExecutor): Promise<boolean> {
  const [row] = await executor.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.enabled));
  return row?.value === '1';
}

/** `PUT /api/storefront/news/site`: the switch takes the state it is sent; a repeat changes nothing and writes no second audit row */
export async function setNewsOnSite(req: Request, enabled: boolean): Promise<{ enabled: boolean }> {
  await orm.transaction(async (tx) => {
    await tx.insert(appSettings).values({ key: KEYS.enabled, value: '0' }).onConflictDoNothing({ target: appSettings.key });
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.enabled)).for('update');
    const before = row?.value === '1';
    if (before === enabled) return;
    await tx.update(appSettings).set({ value: enabled ? '1' : '0' }).where(eq(appSettings.key, KEYS.enabled));
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'news',
      description: enabled ? 'خبرها روی سایت روشن شد' : 'خبرها روی سایت خاموش شد', details: { before: { enabled: before }, after: { enabled } },
    });
  });
  // the staff's own reading of the settings is kept a while; the site's readers here always ask the table
  invalidateSettingsCache();
  return { enabled: await newsOnSite(orm) };
}

const onSite = (today: string) => and(
  eq(storefrontNews.isDeleted, 0), isNotNull(storefrontNews.published), isNotNull(storefrontNews.publishedAt), lte(storefrontNews.publishedDate, today),
);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The parts of a copy a news item may have, each in the shape its kind is drawn from: a row changed by hand cannot send
 * a part of another kind (a row of products, a button), and a part that is no part does not take the item down
 */
function partsOf(copy: { sections?: unknown }): PageSection[] {
  return (Array.isArray(copy.sections) ? copy.sections : []).filter((section): section is PageSection => (
    isRecord(section) && NEWS_SECTION_KINDS.includes(section.kind as PageSection['kind'])
    && (section.kind === 'text' ? isRecord(section.doc) : Array.isArray(section.images) && section.images.every(isRecord))
  ));
}
const summaryOf = (copy: { summary?: unknown }, parts: readonly PageSection[]): string => (
  typeof copy.summary === 'string' && copy.summary ? copy.summary : newsExcerpt(parts, NEWS_EXCERPT_MAX)
);

/** One item of the list; null for a row whose copy cannot be read (it is left out, the list is not taken down by it) */
function cardOf(row: NewsRecord, images: Images): StorefrontNewsCard | null {
  const copy = row.published;
  if (!isRecord(copy) || typeof copy.title !== 'string' || !row.publishedDate) return null;
  return {
    slug: row.slug, title: copy.title, summary: summaryOf(copy, partsOf(copy)), date: row.publishedDate,
    cover: imageOf(images, typeof copy.coverAssetId === 'number' ? copy.coverAssetId : null, copy.title),
  };
}

/** `GET /api/storefront/v1/news?page=N`: the items on the site now, the newest day first */
export async function publicNewsList(page: number): Promise<StorefrontNewsList> {
  if (!await newsOnSite(orm)) return { enabled: false, data: [], total: 0, page: 1, pageSize: NEWS_SITE_PAGE_SIZE };
  const where = onSite(await businessTodayIsoDate());
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontNews).where(where);
  const rows = await orm.select().from(storefrontNews).where(where).orderBy(desc(storefrontNews.publishedDate), desc(storefrontNews.id))
    .limit(NEWS_SITE_PAGE_SIZE).offset((page - 1) * NEWS_SITE_PAGE_SIZE);
  const images = await imagesOf(rows.flatMap(row => (typeof row.published?.coverAssetId === 'number' ? [row.published.coverAssetId] : [])));
  return { enabled: true, data: rows.flatMap(row => cardOf(row, images) ?? []), total, page, pageSize: NEWS_SITE_PAGE_SIZE };
}

/** `GET /api/storefront/v1/news-index`: the address, day and time of publishing of every item on the site now (none while the switch is off) */
export async function publicNewsIndex(): Promise<StorefrontNewsIndexRow[]> {
  if (!await newsOnSite(orm)) return [];
  const rows = await orm.select({ slug: storefrontNews.slug, date: storefrontNews.publishedDate, publishedAt: storefrontNews.publishedAt }).from(storefrontNews)
    .where(onSite(await businessTodayIsoDate())).orderBy(desc(storefrontNews.publishedDate), desc(storefrontNews.id)).limit(NEWS_MAX);
  return rows.map(row => ({ slug: row.slug, date: row.date ?? '', updatedAt: isoOf(row.publishedAt ?? '') }));
}

/** `GET /api/storefront/v1/news/:slug`: one item on the site now, or the same 404 for any other address */
export async function publicNewsItem(slug: string): Promise<StorefrontPublicNews> {
  if (!await newsOnSite(orm)) throw notFound();
  const [row] = await orm.select().from(storefrontNews).where(and(onSite(await businessTodayIsoDate()), eq(storefrontNews.slug, slug))).limit(1);
  const copy = row?.published;
  if (!row || !isRecord(copy) || typeof copy.title !== 'string' || !row.publishedDate) throw notFound();
  const sections = partsOf(copy);
  const updatedAt = isoOf(row.publishedAt ?? '');
  const drawn = await pageForSite(
    {
      title: copy.title, seoTitle: typeof copy.seoTitle === 'string' ? copy.seoTitle : '', seoDescription: typeof copy.seoDescription === 'string' ? copy.seoDescription : '',
      noindex: false, shareImageAssetId: typeof copy.coverAssetId === 'number' ? copy.coverAssetId : null, sections,
    },
    { slug: row.slug, kind: 'custom', title: copy.title, noindex: false, updatedAt },
  );
  return {
    slug: row.slug, title: copy.title, summary: summaryOf(copy, sections), date: row.publishedDate, cover: drawn.shareImage,
    updatedAt, seoTitle: drawn.seoTitle, seoDescription: drawn.seoDescription, sections: drawn.sections,
  };
}

/**
 * The light (or small) WEBP of an image that an item on the site now names (`storefront_content_assets` of kind 'news',
 * written by «انتشار»); the image of a draft, of an item waiting for its day or of any item while the switch is off is
 * the same 404 as a file that does not exist
 */
export async function newsImageFile(file: string): Promise<string> {
  const match = MEDIA_FILE_NAME.exec(file);
  if (!match || !await newsOnSite(orm)) throw new NotFoundError('پیدا نشد');
  const [sha256, thumb] = [match[1], Boolean(match[2])];
  const rows = await orm.select({ lightBytes: mediaAssets.lightBytes, thumbBytes: mediaAssets.thumbBytes }).from(mediaAssets)
    .innerJoin(storefrontContentAssets, eq(storefrontContentAssets.assetId, mediaAssets.id))
    .innerJoin(storefrontNews, eq(storefrontNews.id, storefrontContentAssets.contentId))
    .where(and(
      eq(mediaAssets.sha256, sha256), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes),
      eq(storefrontContentAssets.contentKind, 'news'), eq(storefrontContentAssets.isDeleted, 0), onSite(await businessTodayIsoDate()),
    ));
  if (!rows.some(r => (thumb ? r.thumbBytes : r.lightBytes) !== null)) throw new NotFoundError('پیدا نشد');
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
