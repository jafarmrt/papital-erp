import type { Request } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontNews, type PublishedNews } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate, getDisplayTimezone, systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { NEWS_MAX, NEWS_PAGE_SIZE, checkedNews, newsAssetIds, type NewsValues } from '../../lib/storefront/storefrontNewsRules.js';
import type { NewsCreateInput, NewsDetail, NewsList, NewsListRow, NewsSaveInput } from '../../lib/storefront/storefrontNewsContracts.js';
import type { PageStatus } from '../../lib/storefront/storefrontPageContracts.js';
import { assetInfos, auditSections, canonical, checkContentReferences, refuseNewContentImages, writeContentAssetRows } from './storefrontContentShared.js';
import { newsOnSite } from './storefrontNewsPublic.js';
import { newsMenuPlacesOf } from './storefrontNewsLinks.js';
import { homeLinksTo } from './storefrontPageLinks.js';

/**
 * v12 phase 10d (package 18, V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» on the ERP side, made like «صفحه‌های
 * سایت»: reading needs `site_content.view`, every change `site_content.manage`; the draft is what the editor saves,
 * «انتشار» copies it onto the site, «برگرداندن» throws the draft's changes away, and taking an item off the site empties
 * its published copy. Each of these locks the row, refuses a stale version (409) and writes its audit row in the same
 * transaction. An item is dated by a day in Tehran; published without one it takes the day it is published, and
 * published with a day to come it is on the site from that day (what the site reads is `storefrontNewsPublic.ts`).
 * An item's address changes only while it is off the site. Removing an item is a soft delete.
 */
type NewsRecord = typeof storefrontNews.$inferSelect;

const AUDIT_ENTITY = 'خبر سایت';
const CONTENT_KIND = 'news';
const NOUN = 'خبر';
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');
const invalid = (message: string, field: string, code: string, extra: Record<string, unknown> = {}) => new ValidationError(message, { field, ...extra }, code);

const draftOf = (row: NewsRecord): NewsValues => ({
  title: row.title, slug: row.slug, summary: row.summary, coverAssetId: row.coverAssetId, newsDate: row.newsDate ?? '',
  seoTitle: row.seoTitle, seoDescription: row.seoDescription, sections: Array.isArray(row.sections) ? row.sections : [],
});
const copyOf = ({ slug: _slug, ...news }: NewsValues): PublishedNews => news;
const sameCopy = (a: PublishedNews, b: PublishedNews | null): boolean => b !== null && canonical(a) === canonical(b);

/** A draft without a day is dated as its copy on the site is («انتشار» keeps that day), so emptying the day alone changes nothing */
const draftCopyOf = (row: NewsRecord): PublishedNews => {
  const copy = copyOf(draftOf(row));
  return { ...copy, newsDate: copy.newsDate || row.published?.newsDate || '' };
};

function statusOf(row: NewsRecord): PageStatus {
  if (row.published === null) return 'draft';
  return sameCopy(draftCopyOf(row), row.published) ? 'published' : 'changed';
}

const listRowOf = (row: NewsRecord, today: string): NewsListRow => ({
  id: row.id, slug: row.slug, title: row.title, status: statusOf(row), newsDate: row.newsDate ?? '', publishedDate: row.publishedDate ?? '',
  scheduled: row.publishedDate !== null && row.publishedDate > today, updatedAt: row.updatedAt, updatedBy: row.updatedBy, version: row.version,
});

async function detailOf(executor: DbExecutor, row: NewsRecord): Promise<NewsDetail> {
  const draft = draftOf(row);
  return {
    ...listRowOf(row, await businessTodayIsoDate()), draft, assets: await assetInfos(executor, newsAssetIds(draft)), menuPlaces: await newsMenuPlacesOf(executor, row.id), linkedFromHome: await homeLinksTo(executor, { newsId: row.id }),
  };
}

/** `GET /api/storefront/news`: the news items, the newest day first, a page at a time */
export async function listNews(executor: DbExecutor, page: number): Promise<NewsList> {
  const live = eq(storefrontNews.isDeleted, 0);
  const [{ total }] = await executor.select({ total: sql<number>`count(*)::int` }).from(storefrontNews).where(live);
  // an item without a day is placed by the day it has on the site, else by the day it was made (in the business time zone)
  const timeZone = await getDisplayTimezone();
  const rows = await executor.select().from(storefrontNews).where(live)
    .orderBy(sql`coalesce(${storefrontNews.newsDate}, ${storefrontNews.publishedDate}, to_char(${storefrontNews.createdAt} AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD')) DESC`, desc(storefrontNews.id))
    .limit(NEWS_PAGE_SIZE).offset((page - 1) * NEWS_PAGE_SIZE);
  const today = await businessTodayIsoDate();
  return { data: rows.map(row => listRowOf(row, today)), total, page, pageSize: NEWS_PAGE_SIZE, siteEnabled: await newsOnSite(executor) };
}

/** `GET /api/storefront/news/:id`: a news item with its draft, as the editor opens it */
export async function newsDetail(executor: DbExecutor, id: number): Promise<NewsDetail> {
  const [row] = await executor.select().from(storefrontNews).where(and(eq(storefrontNews.id, id), eq(storefrontNews.isDeleted, 0)));
  if (!row) throw new NotFoundError('این خبر پیدا نشد.', undefined, 'STOREFRONT_NEWS_NOT_FOUND');
  return detailOf(executor, row);
}

async function lockedRow(tx: DbExecutor, id: number, expectedVersion: number): Promise<NewsRecord> {
  const [row] = await tx.select().from(storefrontNews).where(and(eq(storefrontNews.id, id), eq(storefrontNews.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('این خبر پیدا نشد.', undefined, 'STOREFRONT_NEWS_NOT_FOUND');
  if (row.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontNews', entityId: String(id), expectedVersion, currentVersion: row.version });
  }
  return row;
}

const auditOf = (news: NewsValues | PublishedNews) => ({
  title: news.title, ...('slug' in news ? { slug: news.slug } : {}), summary: news.summary, coverAssetId: news.coverAssetId, newsDate: news.newsDate,
  seoTitle: news.seoTitle, seoDescription: news.seoDescription, sections: auditSections(news.sections),
});
const refused = (problem: { field: string; section: number; message: string; code: string }) => invalid(problem.message, problem.field, problem.code, { section: problem.section });

const slugTaken = () => new ConflictError('خبر دیگری همین نشانی را دارد.', { field: 'slug' }, 'STOREFRONT_NEWS_SLUG_TAKEN');
async function refuseTakenSlug(tx: DbExecutor, slug: string): Promise<void> {
  const [taken] = await tx.select({ id: storefrontNews.id }).from(storefrontNews).where(and(eq(storefrontNews.slug, slug), eq(storefrontNews.isDeleted, 0)));
  if (taken) throw slugTaken();
}
/** Two requests that took one address at the same moment: the second is stopped by the unique index and gets the same answer */
function slugRace(err: unknown): never {
  // by the constraint's own name, never by the text of the error (which carries what the request sent)
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === 'uq_storefront_news_slug_live') throw slugTaken();
  }
  throw err;
}

/** `POST /api/storefront/news`: a new news item; it starts as an empty draft */
export async function createNews(req: Request, input: NewsCreateInput): Promise<NewsDetail> {
  const checked = checkedNews({ title: input.title, slug: input.slug, sections: [] }, { forPublish: false });
  if (checked.problem) throw refused(checked.problem);
  const news = checked.news;
  const id = await orm.transaction(async (tx) => {
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(storefrontNews).where(eq(storefrontNews.isDeleted, 0));
    if (total >= NEWS_MAX) throw invalid('شمار خبرها به سقف رسیده است؛ خبری را که لازم نیست حذف کنید.', 'title', 'STOREFRONT_NEWS_TOO_MANY');
    await refuseTakenSlug(tx, news.slug);
    const actor = actorOf(req);
    const [row] = await tx.insert(storefrontNews).values({ slug: news.slug, title: news.title, createdBy: actor, updatedBy: actor }).returning({ id: storefrontNews.id });
    await logActivity({ req, tx, action: 'CREATE', entity: AUDIT_ENTITY, entityId: `news-${row.id}`, description: `خبر «${news.title}» ساخته شد`, details: { after: auditOf(news) } });
    return row.id;
  }).catch(slugRace);
  return newsDetail(orm, id);
}

/** `PUT /api/storefront/news/:id`: «ذخیرهٔ پیش‌نویس»; the copy on the site does not change */
export async function saveNewsDraft(req: Request, id: number, input: NewsSaveInput): Promise<NewsDetail> {
  const { version, ...raw } = input;
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    const checked = checkedNews(raw, { forPublish: false });
    if (checked.problem) throw refused(checked.problem);
    const news = checked.news;
    const before = draftOf(row);
    if (news.slug !== row.slug) {
      if (row.published !== null) throw invalid('نشانی خبری که روی سایت است عوض نمی‌شود؛ نخست آن را از روی سایت بردارید.', 'slug', 'STOREFRONT_NEWS_SLUG_ON_SITE');
      await refuseTakenSlug(tx, news.slug);
    }
    // the images the item already has: its draft's, and those of its copy on the site (which «برگرداندن» brings back)
    const had = [...newsAssetIds(before), ...(row.published ? newsAssetIds(row.published) : [])];
    await refuseNewContentImages(req, newsAssetIds(news), had, NOUN);
    await checkContentReferences(tx, { assetIds: newsAssetIds(news), itemIds: [] }, had, NOUN);
    await tx.update(storefrontNews).set({
      slug: news.slug, title: news.title, summary: news.summary, coverAssetId: news.coverAssetId, newsDate: news.newsDate || null,
      seoTitle: news.seoTitle, seoDescription: news.seoDescription, sections: news.sections, version: nextVersion(row.version),
      updatedBy: actorOf(req), updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontNews.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `news-${id}`,
      description: `پیش‌نویس خبر «${news.title}» ذخیره شد`, details: { before: auditOf(before), after: auditOf(news) },
    });
  }).catch(slugRace);
  return newsDetail(orm, id);
}

/** `POST /api/storefront/news/:id/publish`: «انتشار»: the saved draft becomes the copy on the site; with no day it keeps the day it has there, or takes today */
export async function publishNews(req: Request, id: number, version: number): Promise<NewsDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    const checked = checkedNews(draftOf(row), { forPublish: true });
    if (checked.problem) throw refused(checked.problem);
    // an item without a day keeps the day it already has on the site; one that was never there takes today
    const today = await businessTodayIsoDate();
    const news = { ...checked.news, newsDate: checked.news.newsDate || row.published?.newsDate || today };
    await checkContentReferences(tx, { assetIds: newsAssetIds(news), itemIds: [] }, [], NOUN);
    const copy = copyOf(news);
    if (sameCopy(copy, row.published)) return;
    const actor = actorOf(req);
    const at = systemNowUtcIso();
    await tx.update(storefrontNews).set({
      newsDate: news.newsDate, published: copy, publishedAt: at, publishedDate: news.newsDate, publishedBy: actor, version: nextVersion(row.version),
      updatedBy: actor, updatedAt: at,
    }).where(eq(storefrontNews.id, id));
    await writeContentAssetRows(tx, CONTENT_KIND, id, newsAssetIds(news));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `news-${id}`,
      description: news.newsDate > today ? `خبر «${news.title}» منتشر شد و تا روز خودش در نوبت انتشار است` : `خبر «${news.title}» روی سایت منتشر شد`,
      details: { before: row.published ? auditOf(row.published) : null, after: auditOf(news) },
    });
  });
  return newsDetail(orm, id);
}

/** `POST /api/storefront/news/:id/revert`: «برگرداندن به نسخهٔ روی سایت»: the draft's changes are thrown away */
export async function revertNewsDraft(req: Request, id: number, version: number): Promise<NewsDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if (row.published === null) throw invalid('این خبر هنوز نسخه‌ای روی سایت ندارد.', 'version', 'STOREFRONT_NEWS_NOT_PUBLISHED');
    const published = row.published;
    if (sameCopy(draftCopyOf(row), published)) return;
    await tx.update(storefrontNews).set({
      title: published.title, summary: published.summary, coverAssetId: published.coverAssetId, newsDate: published.newsDate || null,
      seoTitle: published.seoTitle, seoDescription: published.seoDescription, sections: published.sections, version: nextVersion(row.version),
      updatedBy: actorOf(req), updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontNews.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `news-${id}`,
      description: `پیش‌نویس خبر «${published.title}» به نسخهٔ روی سایت برگشت`, details: { before: auditOf(draftOf(row)), after: auditOf(published) },
    });
  });
  return newsDetail(orm, id);
}

/** `POST /api/storefront/news/:id/unpublish`: the item leaves the site; its draft stays as it is */
export async function unpublishNews(req: Request, id: number, version: number): Promise<NewsDetail> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    if (row.published === null) return;
    await tx.update(storefrontNews).set({
      published: null, publishedAt: null, publishedDate: null, publishedBy: '', version: nextVersion(row.version), updatedBy: actorOf(req), updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontNews.id, id));
    await writeContentAssetRows(tx, CONTENT_KIND, id, []);
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `news-${id}`,
      description: `خبر «${row.title}» از روی سایت برداشته شد`, details: { before: auditOf(row.published), after: null, linkedFromMenus: await newsMenuPlacesOf(tx, id), linkedFromHome: await homeLinksTo(tx, { newsId: id }) },
    });
  });
  return newsDetail(orm, id);
}

/** `DELETE /api/storefront/news/:id`: the item is removed softly, and leaves the site if it was on it */
export async function deleteNews(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const row = await lockedRow(tx, id, version);
    await tx.update(storefrontNews).set({
      isDeleted: 1, published: null, publishedAt: null, publishedDate: null, publishedBy: '', version: nextVersion(row.version), updatedBy: actorOf(req),
      updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontNews.id, id));
    await writeContentAssetRows(tx, CONTENT_KIND, id, []);
    await logActivity({
      req, tx, action: 'DELETE', entity: AUDIT_ENTITY, entityId: `news-${id}`,
      description: `خبر «${row.title}» حذف شد`, details: { before: auditOf(draftOf(row)), wasOnSite: row.published !== null, linkedFromMenus: await newsMenuPlacesOf(tx, id), linkedFromHome: await homeLinksTo(tx, { newsId: id }) },
    });
  });
}
