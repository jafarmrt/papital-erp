import type { Request } from 'express';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, mediaAssets, mediaSections, storefrontCampaigns, storefrontDiscountCodes, storefrontDiscountRedemptions } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { can } from '../../middleware/authorize.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { foldedContains } from '../../lib/search/searchSql.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import {
  CAMPAIGNS_MAX, CAMPAIGN_PRODUCTS_MAX, campaignProblem, campaignStatus, isCampaignSource, normalizedCampaign, tehranDayOf,
  type CampaignValues,
} from '../../lib/storefront/storefrontCampaignRules.js';
import type {
  CampaignHeroOptionPage, CampaignInput, CampaignRow, CampaignsView, StorefrontCampaignPage, StorefrontCampaignSummary,
} from '../../lib/storefront/storefrontCampaignContracts.js';
import type { StorefrontImage } from '../../lib/storefront/storefrontContracts.js';
import { campaignCards, catalogItems } from './storefrontCatalog.service.js';
import { dayAfter, dayStart, tehranDay } from './storefrontDiscounts.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.5b (package 18, start plan 8.5 §5, owner's decision 2026-11-04): «صفحه‌های ویژه», the campaign pages of the
 * site. Reading needs `storefront.view`, writing `storefront.manage`. A save runs under the page's version (a stale form
 * is 409) with an audit row in the same transaction; removing a page is a soft delete. The site sees a page only while it
 * is on and inside its window (Tehran days, as the discount codes), and only what the page shows: its texts, its hero
 * image, the items of it that are on the site now (the catalog's own test), and its discount code only while that code is
 * live, on and open to retail buyers today. The hero is an image of the media library with a light version; the site
 * reaches its file only while a live page uses it.
 */
type CampaignRecord = typeof storefrontCampaigns.$inferSelect;

const invalid = (message: string, field: string, code: string) => new ValidationError(message, { field }, code);
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');

function valuesOf(row: CampaignRecord): CampaignValues {
  return {
    slug: row.slug, title: row.title, summary: row.summary, body: row.body, heroAssetId: row.heroAssetId,
    source: isCampaignSource(row.source) ? row.source : 'collection', collection: row.collection, itemIds: row.itemIds ?? [],
    discountCode: row.discountCode, startsOn: tehranDay(row.startsAt), endsOn: tehranDay(row.endsAt, { ends: true }),
    homeBanner: row.homeBanner === 1, isActive: row.isActive === 1,
  };
}

const columnsOf = (v: CampaignValues) => ({
  slug: v.slug, title: v.title, summary: v.summary, body: v.body, heroAssetId: v.heroAssetId, source: v.source,
  collection: v.collection, itemIds: v.itemIds, discountCode: v.discountCode,
  startsAt: v.startsOn ? dayStart(v.startsOn) : null, endsAt: v.endsOn ? dayStart(dayAfter(v.endsOn)) : null,
  homeBanner: v.homeBanner ? 1 : 0, isActive: v.isActive ? 1 : 0,
});

/** The collections of live finished products, the names a page may take */
async function liveCollections(executor: DbExecutor): Promise<string[]> {
  const rows = await executor.select({ collections: items.collections }).from(items)
    .where(and(eq(items.isDeleted, 0), eq(items.type, 'product')));
  const names = new Set<string>();
  for (const r of rows) for (const c of r.collections ?? []) if (c.trim()) names.add(c.trim());
  return [...names].sort((a, b) => a.localeCompare(b, 'fa'));
}

export async function listCampaigns(executor: DbExecutor): Promise<CampaignsView> {
  const rows = await executor.select().from(storefrontCampaigns).where(eq(storefrontCampaigns.isDeleted, 0))
    .orderBy(desc(storefrontCampaigns.id)).limit(CAMPAIGNS_MAX);
  const heroIds = [...new Set(rows.map(r => r.heroAssetId).filter((id): id is number => id !== null))];
  const heroes = heroIds.length === 0 ? [] : await executor.select({
    id: mediaAssets.id, title: mediaAssets.title, originalName: mediaAssets.originalName, lightBytes: mediaAssets.lightBytes, isDeleted: mediaAssets.isDeleted,
  }).from(mediaAssets).where(inArray(mediaAssets.id, heroIds));
  const heroById = new Map(heroes.map(h => [h.id, h]));
  const itemIds = [...new Set(rows.flatMap(r => r.itemIds ?? []))];
  const itemRows = itemIds.length === 0 ? [] : await executor.select({ id: items.id, code: items.code, name: items.name })
    .from(items).where(inArray(items.id, itemIds));
  const itemById = new Map(itemRows.map(i => [i.id, i]));
  const onSite = new Set((await catalogItems(executor, await storefrontSettingValues(executor))).map(i => i.itemId));
  const today = tehranDayOf(new Date());
  return {
    campaigns: rows.map((row): CampaignRow => {
      const values = valuesOf(row);
      const hero = row.heroAssetId !== null ? heroById.get(row.heroAssetId) : undefined;
      return {
        ...values, id: row.id, version: row.version, status: campaignStatus(values, today),
        hero: row.heroAssetId === null ? null : {
          assetId: row.heroAssetId, title: hero ? (hero.title || hero.originalName) : '',
          onSite: Boolean(hero && hero.isDeleted === 0 && hero.lightBytes !== null),
        },
        products: values.itemIds.map(id => ({
          itemId: id, code: itemById.get(id)?.code ?? '', name: itemById.get(id)?.name ?? '', onSite: onSite.has(id),
        })),
      };
    }),
    collections: await liveCollections(executor),
  };
}

/** The page as it is stored, or the first reason it cannot be (its image, items, collection and code are checked next) */
export function checkedCampaign(input: CampaignInput): CampaignValues {
  const values = normalizedCampaign(input);
  const problem = campaignProblem(values);
  if (problem) throw invalid(problem.message, problem.field, problem.code);
  return values;
}

async function checkReferences(tx: DbExecutor, v: CampaignValues): Promise<void> {
  if (v.heroAssetId !== null) {
    const [hero] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(
      eq(mediaAssets.id, v.heroAssetId), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes),
    )).for('share');
    if (!hero) throw invalid('تصویر سرصفحه در کتابخانهٔ رسانه پیدا نشد یا نسخهٔ سبک ندارد.', 'heroAssetId', 'STOREFRONT_CAMPAIGN_HERO_INVALID');
  }
  if (v.source === 'products') {
    const found = await tx.select({ id: items.id }).from(items)
      .where(and(inArray(items.id, v.itemIds), eq(items.isDeleted, 0), eq(items.type, 'product'))).for('share');
    if (found.length !== v.itemIds.length) throw invalid('یکی از محصولات انتخاب‌شده پیدا نشد.', 'itemIds', 'STOREFRONT_CAMPAIGN_PRODUCTS_REQUIRED');
  } else if (!(await liveCollections(tx)).includes(v.collection)) {
    throw invalid(`کالکشن «${v.collection}» در کالاهای ERP نیست.`, 'collection', 'STOREFRONT_CAMPAIGN_COLLECTION_UNKNOWN');
  }
  if (v.discountCode) {
    const [code] = await tx.select({ id: storefrontDiscountCodes.id }).from(storefrontDiscountCodes)
      .where(and(eq(storefrontDiscountCodes.code, v.discountCode), eq(storefrontDiscountCodes.isDeleted, 0))).limit(1);
    if (!code) throw invalid(`کد تخفیف «${v.discountCode}» ساخته نشده است؛ نخست آن را در «کدهای تخفیف» بسازید.`, 'discountCode', 'STOREFRONT_CAMPAIGN_CODE_UNKNOWN');
  }
}

async function refuseTakenSlug(tx: DbExecutor, slug: string, exceptId?: number): Promise<void> {
  const conditions = [eq(storefrontCampaigns.slug, slug), eq(storefrontCampaigns.isDeleted, 0)];
  if (exceptId !== undefined) conditions.push(ne(storefrontCampaigns.id, exceptId));
  const [taken] = await tx.select({ id: storefrontCampaigns.id }).from(storefrontCampaigns).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(`صفحه‌ای با نشانی «${slug}» پیش‌تر ساخته شده است.`, { field: 'slug' }, 'STOREFRONT_CAMPAIGN_SLUG_TAKEN');
}

/** Pages are few; a cap keeps a list read whole */
async function refuseTooMany(tx: DbExecutor): Promise<void> {
  const [{ n }] = await tx.select({ n: count() }).from(storefrontCampaigns).where(eq(storefrontCampaigns.isDeleted, 0));
  if (Number(n) >= CAMPAIGNS_MAX) {
    throw invalid(`حداکثر ${CAMPAIGNS_MAX.toLocaleString('fa-IR')} صفحهٔ ویژه نگه داشته می‌شود؛ صفحه‌های کهنه را حذف کنید.`, 'slug', 'STOREFRONT_CAMPAIGNS_TOO_MANY');
  }
}

/**
 * A new hero image is a file of the media library going onto the site, so whoever picks it must be allowed to see the
 * library (the security review of 8.5b); keeping the image a page already has needs nothing more
 */
async function refuseHeroWithoutMedia(req: Request, heroAssetId: number | null, before: number | null): Promise<void> {
  if (heroAssetId === null || heroAssetId === before) return;
  if (!(await can(req.user as { role?: string } | undefined, 'media.view'))) {
    throw new ForbiddenError('برای انتخاب تصویر سرصفحه، دسترسی «مشاهده کتابخانه تصاویر» لازم است.', { field: 'heroAssetId' }, 'STOREFRONT_CAMPAIGN_HERO_FORBIDDEN');
  }
}

/** Two saves of pages never interleave (the slug check and the cap read the whole table) */
const lockCampaigns = (tx: DbExecutor) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'storefront_campaigns'}))`);

export async function createCampaign(req: Request, input: CampaignInput): Promise<CampaignRow> {
  const values = checkedCampaign(input);
  await refuseHeroWithoutMedia(req, values.heroAssetId, null);
  const id = await orm.transaction(async (tx) => {
    await lockCampaigns(tx);
    await refuseTooMany(tx);
    await refuseTakenSlug(tx, values.slug);
    await checkReferences(tx, values);
    const [created] = await tx.insert(storefrontCampaigns).values({ ...columnsOf(values), createdBy: actorOf(req), updatedBy: actorOf(req) })
      .returning({ id: storefrontCampaigns.id });
    await logActivity({
      req, tx, action: 'CREATE', entity: 'فروشگاه سایت', entityId: `campaign-${created.id}`,
      description: `صفحهٔ ویژهٔ «${values.title}» ساخته شد`, details: { after: values },
    });
    return created.id;
  });
  return campaignById(id);
}

async function lockedCampaign(tx: DbExecutor, id: number, expectedVersion: number): Promise<CampaignRecord> {
  const [row] = await tx.select().from(storefrontCampaigns)
    .where(and(eq(storefrontCampaigns.id, id), eq(storefrontCampaigns.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('صفحهٔ ویژه پیدا نشد.', undefined, 'STOREFRONT_CAMPAIGN_NOT_FOUND');
  if (row.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontCampaign', entityId: id, expectedVersion, currentVersion: row.version });
  }
  return row;
}

export async function updateCampaign(req: Request, id: number, input: CampaignInput & { version: number }): Promise<CampaignRow> {
  const values = checkedCampaign(input);
  await orm.transaction(async (tx) => {
    await lockCampaigns(tx);
    const row = await lockedCampaign(tx, id, input.version);
    await refuseHeroWithoutMedia(req, values.heroAssetId, row.heroAssetId);
    await refuseTakenSlug(tx, values.slug, id);
    await checkReferences(tx, values);
    await tx.update(storefrontCampaigns)
      .set({ ...columnsOf(values), updatedBy: actorOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(row.version) })
      .where(eq(storefrontCampaigns.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'فروشگاه سایت', entityId: `campaign-${id}`,
      description: `صفحهٔ ویژهٔ «${values.title}» ویرایش شد`, details: { before: valuesOf(row), after: values },
    });
  });
  return campaignById(id);
}

export async function deleteCampaign(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const row = await lockedCampaign(tx, id, version);
    await tx.update(storefrontCampaigns)
      .set({ isDeleted: 1, isActive: 0, homeBanner: 0, updatedBy: actorOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(row.version) })
      .where(eq(storefrontCampaigns.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: 'فروشگاه سایت', entityId: `campaign-${id}`,
      description: `صفحهٔ ویژهٔ «${row.title}» حذف شد`, details: { before: { slug: row.slug, title: row.title } },
    });
  });
}

async function campaignById(id: number): Promise<CampaignRow> {
  const found = (await listCampaigns(orm)).campaigns.find(c => c.id === id);
  if (!found) throw new NotFoundError('صفحهٔ ویژه پیدا نشد.', undefined, 'STOREFRONT_CAMPAIGN_NOT_FOUND');
  return found;
}

export const HERO_OPTIONS_PAGE_MAX = 48;

/** The images of the media library a page may take as its hero: live images with a light version, newest first */
export async function campaignHeroOptions(query: { q: string; page: number; limit: number }): Promise<CampaignHeroOptionPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(HERO_OPTIONS_PAGE_MAX, Math.max(1, query.limit));
  const conditions: SQL[] = [eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)];
  // the same folded search as every list (Arabic and Persian letters, digits and spaces alike)
  const searched = foldedContains([mediaAssets.title, mediaAssets.originalName, items.code, items.name], query.q);
  if (searched) conditions.push(searched);
  const where = and(...conditions);
  const [{ n }] = await orm.select({ n: count() }).from(mediaAssets).leftJoin(items, eq(items.id, mediaAssets.itemId)).where(where);
  const rows = await orm.select({
    id: mediaAssets.id, title: mediaAssets.title, originalName: mediaAssets.originalName, section: mediaSections.title,
    itemCode: items.code, width: mediaAssets.width, height: mediaAssets.height,
  }).from(mediaAssets)
    .innerJoin(mediaSections, eq(mediaSections.id, mediaAssets.sectionId))
    .leftJoin(items, eq(items.id, mediaAssets.itemId))
    .where(where).orderBy(desc(mediaAssets.id)).limit(limit).offset((page - 1) * limit);
  return {
    data: rows.map(r => ({ id: r.id, title: r.title || r.originalName, section: r.section, itemCode: r.itemCode ?? '', width: r.width, height: r.height })),
    total: Number(n), page, limit,
  };
}

/** A page the site shows now: on, not removed, inside its window (the database's clock, as an order's discount check) */
const openNow = () => and(
  eq(storefrontCampaigns.isDeleted, 0), eq(storefrontCampaigns.isActive, 1),
  or(isNull(storefrontCampaigns.startsAt), lte(storefrontCampaigns.startsAt, sql`now()`)),
  or(isNull(storefrontCampaigns.endsAt), gt(storefrontCampaigns.endsAt, sql`now()`)),
);

/** The hero images of pages, as the site writes them; an image that lost its light version or was removed is none */
async function heroImages(rows: CampaignRecord[]): Promise<Map<number, StorefrontImage>> {
  const ids = [...new Set(rows.map(r => r.heroAssetId).filter((id): id is number => id !== null))];
  const out = new Map<number, StorefrontImage>();
  if (ids.length === 0) return out;
  const assets = await orm.select({ id: mediaAssets.id, sha256: mediaAssets.sha256, width: mediaAssets.width, height: mediaAssets.height })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
  // the alt text is the page's title (summaryOf), never the library's own title, which no one wrote for the site
  for (const a of assets) out.set(a.id, { sha256: a.sha256, width: a.width, height: a.height, alt: '', isCover: false });
  return out;
}

function summaryOf(row: CampaignRecord, heroes: Map<number, StorefrontImage>): StorefrontCampaignSummary {
  const hero = row.heroAssetId !== null ? heroes.get(row.heroAssetId) : undefined;
  return {
    slug: row.slug, title: row.title, summary: row.summary, hero: hero ? { ...hero, alt: row.title } : null,
    homeBanner: row.homeBanner === 1, endsOn: tehranDay(row.endsAt, { ends: true }),
  };
}

/** `GET /api/storefront/v1/campaigns`: the pages on the site now, newest first */
export async function publicCampaigns(): Promise<StorefrontCampaignSummary[]> {
  const rows = await orm.select().from(storefrontCampaigns).where(openNow()).orderBy(desc(storefrontCampaigns.id)).limit(CAMPAIGNS_MAX);
  const heroes = await heroImages(rows);
  return rows.map(row => summaryOf(row, heroes));
}

/**
 * A code is shown on a page only while a guest could use it: live, on, open to retail buyers and not only to accounts,
 * inside its window, and with uses left
 */
async function shownCode(code: string): Promise<string> {
  if (!code) return '';
  const [open] = await orm.select({ id: storefrontDiscountCodes.id, usageLimit: storefrontDiscountCodes.usageLimit }).from(storefrontDiscountCodes).where(and(
    eq(storefrontDiscountCodes.code, code), eq(storefrontDiscountCodes.isDeleted, 0), eq(storefrontDiscountCodes.isActive, 1),
    eq(storefrontDiscountCodes.forRetail, 1), eq(storefrontDiscountCodes.accountsOnly, 0),
    or(isNull(storefrontDiscountCodes.startsAt), lte(storefrontDiscountCodes.startsAt, sql`now()`)),
    or(isNull(storefrontDiscountCodes.endsAt), gt(storefrontDiscountCodes.endsAt, sql`now()`)),
  )).limit(1);
  if (!open) return '';
  if (open.usageLimit > 0) {
    const [{ n }] = await orm.select({ n: count() }).from(storefrontDiscountRedemptions)
      .where(and(eq(storefrontDiscountRedemptions.codeId, open.id), isNull(storefrontDiscountRedemptions.releasedAt)));
    if (Number(n) >= open.usageLimit) return '';
  }
  return code;
}

/** `GET /api/storefront/v1/campaigns/:slug`: a page on the site now, or the same 404 for any other */
export async function publicCampaign(slug: string): Promise<StorefrontCampaignPage> {
  const [row] = await orm.select().from(storefrontCampaigns).where(and(openNow(), eq(storefrontCampaigns.slug, slug))).limit(1);
  if (!row) throw new NotFoundError('صفحه پیدا نشد.', undefined, 'STOREFRONT_CAMPAIGN_NOT_FOUND');
  const products = await campaignCards(row.source === 'products' ? { itemIds: row.itemIds ?? [] } : { collection: row.collection }, CAMPAIGN_PRODUCTS_MAX);
  return { ...summaryOf(row, await heroImages([row])), body: row.body, discountCode: await shownCode(row.discountCode), products };
}

const MEDIA_FILE = /^([0-9a-f]{64})(-thumb)?\.webp$/;

/** The light (or thumbnail) WEBP of the hero image of a page on the site now; any other file is the same 404 */
export async function campaignHeroFile(file: string): Promise<string> {
  const match = MEDIA_FILE.exec(file);
  const notFound = new NotFoundError('پیدا نشد');
  if (!match) throw notFound;
  const [sha256, thumb] = [match[1], Boolean(match[2])];
  const rows = await orm.select({ lightBytes: mediaAssets.lightBytes, thumbBytes: mediaAssets.thumbBytes }).from(mediaAssets)
    .innerJoin(storefrontCampaigns, eq(storefrontCampaigns.heroAssetId, mediaAssets.id))
    .where(and(eq(mediaAssets.sha256, sha256), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), openNow()));
  if (!rows.some(r => (thumb ? r.thumbBytes : r.lightBytes) !== null)) throw notFound;
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
