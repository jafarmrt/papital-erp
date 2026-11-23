import type { Request } from 'express';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { mediaAssets, storefrontCollections } from '../../db/schema.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import {
  COLLECTION_TEXTS_MAX, checkedCollectionText, collectionTextShows, type CollectionTextValues,
} from '../../lib/storefront/storefrontCollectionRules.js';
import type {
  CollectionTextList, CollectionTextRow, CollectionTextSaveInput, StorefrontCollectionText,
} from '../../lib/storefront/storefrontCollectionContracts.js';
import { catalogItems, publicItemsOnSale } from './storefrontCatalog.service.js';
import { assetInfos, checkContentReferences, refuseNewContentImages } from './storefrontContentShared.js';
import { MEDIA_FILE_NAME, imageOf, imagesOf } from './storefrontPagePublic.js';
import { pageLinkTargets } from './storefrontPageLinks.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 10e (package 18, V12_SITE_NEXT_START_PLAN.md §7.2): «متن و تصویر کالکشن‌ها». A collection is a name on the
 * items; its own words (an introduction, an image, a link «آشنایی بیشتر») are one row found by that name. Reading needs
 * `site_content.view`, saving `site_content.manage` (a new image also `media.view`); a save locks the row, refuses a
 * stale version (409) and writes its audit row in the same transaction. The site reads the words of a collection only
 * while the collection has an item on the site, and only what a visitor sees.
 */
type CollectionRecord = typeof storefrontCollections.$inferSelect;

const AUDIT_ENTITY = 'کالکشن سایت';
const NOUN = 'کالکشن';
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');
const valuesOf = (row: CollectionRecord): CollectionTextValues => ({
  name: row.name, intro: row.intro, imageAssetId: row.imageAssetId, imageAlt: row.imageAlt, morePageId: row.morePageId,
});
/** the names asked for in one read of the site; a shop has tens of collections, never thousands */
const COLLECTION_NAMES_ON_SITE_MAX = 5000;
const stale = (name: string, expectedVersion: number, currentVersion: number) => new OptimisticLockError({ entityType: 'StorefrontCollection', entityId: name, expectedVersion, currentVersion });

/** How many items of each collection are on the site now */
function countsOf(onSale: ReadonlyArray<{ collections: readonly string[] }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of onSale) for (const name of new Set(item.collections)) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

/** The rows of the screen for some names, each with its saved words (if any) and what the image and the page are now */
async function rowsFor(executor: DbExecutor, names: readonly string[], counts: ReadonlyMap<string, number>): Promise<CollectionTextRow[]> {
  if (names.length === 0) return [];
  const rows = await executor.select().from(storefrontCollections).where(inArray(storefrontCollections.name, [...names]));
  const saved = new Map(rows.map(row => [row.name, row]));
  const images = new Map((await assetInfos(executor, rows.flatMap(row => row.imageAssetId ?? []))).map(asset => [asset.assetId, asset]));
  const pages = await pageLinkTargets(executor, rows.flatMap(row => row.morePageId ?? []));
  return names.map((name): CollectionTextRow => {
    const row = saved.get(name);
    const image = row?.imageAssetId ? images.get(row.imageAssetId) : undefined;
    const page = row?.morePageId ? pages.get(row.morePageId) : undefined;
    return {
      name, intro: row?.intro ?? '', imageAssetId: row?.imageAssetId ?? null, imageAlt: row?.imageAlt ?? '', morePageId: row?.morePageId ?? null,
      count: counts.get(name) ?? 0, imageTitle: image?.title ?? '', imageUsable: image?.usable ?? false, morePageTitle: page?.title ?? '', morePageLive: page?.live ?? false,
      version: row?.version ?? 0,
    };
  });
}

/** `GET /api/storefront/collections`: every collection with an item on the site, and every collection that has words, with those words */
export async function listCollectionTexts(executor: DbExecutor): Promise<CollectionTextList> {
  const counts = countsOf(await catalogItems(executor, await storefrontSettingValues(executor)));
  const byName = (a: string, b: string) => a.localeCompare(b, 'fa');
  // the collections with a page on the site first, then those whose items have left it (their words are kept); the
  // ceiling cuts the second kind first (10e review: it was applied before the two were told apart)
  const written = (await executor.select({ name: storefrontCollections.name }).from(storefrontCollections)).map(row => row.name).filter(name => !counts.has(name));
  const names = [...[...counts.keys()].sort(byName), ...written.sort(byName)].slice(0, COLLECTION_TEXTS_MAX);
  const pages = await pageLinkTargets(executor);
  return { data: await rowsFor(executor, names, counts), pages: [...pages].map(([id, page]) => ({ id, title: page.title, live: page.live })) };
}

/** An image problem of the shared content checks, said for this form: its own field and its own code */
async function imageChecks(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ForbiddenError && error.code === 'STOREFRONT_PAGE_IMAGE_FORBIDDEN') throw new ForbiddenError(error.message, { field: 'imageAssetId' }, 'STOREFRONT_COLLECTION_IMAGE_FORBIDDEN');
    if (error instanceof ValidationError && error.code === 'STOREFRONT_PAGE_IMAGE_UNKNOWN') throw new ValidationError(error.message, { field: 'imageAssetId' }, 'STOREFRONT_COLLECTION_IMAGE_UNKNOWN');
    throw error;
  }
}

/** `PUT /api/storefront/collections`: the words of one collection, under its version (0 = nothing saved for it yet) */
export async function saveCollectionText(req: Request, input: CollectionTextSaveInput): Promise<CollectionTextRow> {
  const { version, ...raw } = input;
  const checked = checkedCollectionText(raw);
  if (checked.problem) throw new ValidationError(checked.problem.message, { field: checked.problem.field }, checked.problem.code);
  const values = checked.values;
  return orm.transaction(async (tx) => {
    const [row] = await tx.select().from(storefrontCollections).where(eq(storefrontCollections.name, values.name)).for('update');
    if ((row?.version ?? 0) !== version) throw stale(values.name, version, row?.version ?? 0);
    const had = row?.imageAssetId ? [row.imageAssetId] : [];
    const named = values.imageAssetId ? [values.imageAssetId] : [];
    await imageChecks(() => refuseNewContentImages(req, named, had, NOUN));
    await imageChecks(() => checkContentReferences(tx, { assetIds: named, itemIds: [] }, had, NOUN));
    if (values.morePageId !== null && values.morePageId !== row?.morePageId && !(await pageLinkTargets(tx, [values.morePageId])).has(values.morePageId)) {
      throw new ValidationError('صفحه‌ای که برای «آشنایی بیشتر» برگزیده‌اید در «صفحه‌های سایت» نیست (حذف شده یا از صفحه‌های پایه است)؛ صفحهٔ دیگری برگزینید.', { field: 'morePageId' }, 'STOREFRONT_COLLECTION_PAGE_UNKNOWN');
    }
    const counts = countsOf(await catalogItems(tx, await storefrontSettingValues(tx)));
    const answer = async () => (await rowsFor(tx, [values.name], counts))[0];
    const actor = actorOf(req);
    if (!row) {
      // a collection is one of the names the items of the site carry now, or one that already has words: no row is made for any other name
      if (!counts.has(values.name)) throw new NotFoundError('این کالکشن روی سایت کالایی ندارد.', undefined, 'STOREFRONT_COLLECTION_NOT_FOUND');
      // nothing written: nothing to keep yet (10e review: an empty save made an empty row)
      if (!collectionTextShows(values) && values.morePageId === null) return answer();
      const [made] = await tx.insert(storefrontCollections).values({ ...values, createdBy: actor, updatedBy: actor }).onConflictDoNothing().returning({ id: storefrontCollections.id });
      // another request made the row first: this one read no row, so its version is stale
      if (!made) throw stale(values.name, version, 1);
      await logActivity({ req, tx, action: 'CREATE', entity: AUDIT_ENTITY, entityId: `collection-${made.id}`, description: `متن و تصویر کالکشن «${values.name}» نوشته شد`, details: { after: values } });
      return answer();
    }
    const before = valuesOf(row);
    if (JSON.stringify(before) === JSON.stringify(values)) return answer();
    await tx.update(storefrontCollections).set({
      intro: values.intro, imageAssetId: values.imageAssetId, imageAlt: values.imageAlt, morePageId: values.morePageId,
      version: nextVersion(row.version), updatedBy: actor, updatedAt: systemNowUtcIso(),
    }).where(eq(storefrontCollections.id, row.id));
    await logActivity({ req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: `collection-${row.id}`, description: `متن و تصویر کالکشن «${values.name}» ذخیره شد`, details: { before, after: values } });
    return answer();
  });
}

/** `GET /api/storefront/v1/collections`: the words of each collection that has an item on the site now and something to show */
export async function publicCollectionTexts(): Promise<StorefrontCollectionText[]> {
  const onSite = new Set((await publicItemsOnSale()).flatMap(item => item.collections));
  if (onSite.size === 0) return [];
  // by the names on the site (10e review: a ceiling on the whole table would drop the newest rows first, on the site or not)
  const rows = (await orm.select().from(storefrontCollections).where(inArray(storefrontCollections.name, [...onSite].slice(0, COLLECTION_NAMES_ON_SITE_MAX)))
    .orderBy(asc(storefrontCollections.id)).limit(COLLECTION_TEXTS_MAX)).filter(row => collectionTextShows(row));
  const images = await imagesOf(rows.flatMap(row => row.imageAssetId ?? []));
  const pages = await pageLinkTargets(orm, rows.flatMap(row => row.morePageId ?? []));
  return rows.flatMap((row): StorefrontCollectionText[] => {
    const image = imageOf(images, row.imageAssetId, row.imageAlt || `کالکشن ${row.name}`);
    // the image has left the library and there is no text: nothing is left to show
    if (!image && row.intro === '') return [];
    const page = row.morePageId !== null ? pages.get(row.morePageId) : undefined;
    return [{ name: row.name, intro: row.intro, image, moreHref: page?.live ? page.href : '' }];
  });
}

/**
 * The light (or small) WEBP of the image of a collection that has an item on the site now; any other file (the image
 * of a collection whose items have left the site among them) is the same 404
 */
export async function collectionImageFile(file: string): Promise<string> {
  const match = MEDIA_FILE_NAME.exec(file);
  const notFound = new NotFoundError('پیدا نشد');
  if (!match) throw notFound;
  const [sha256, thumb] = [match[1], Boolean(match[2])];
  const rows = await orm.select({ name: storefrontCollections.name, lightBytes: mediaAssets.lightBytes, thumbBytes: mediaAssets.thumbBytes }).from(mediaAssets)
    .innerJoin(storefrontCollections, eq(storefrontCollections.imageAssetId, mediaAssets.id))
    .where(and(eq(mediaAssets.sha256, sha256), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
  const held = rows.filter(row => (thumb ? row.thumbBytes : row.lightBytes) !== null);
  if (held.length === 0) throw notFound;
  const onSite = new Set((await publicItemsOnSale()).flatMap(item => item.collections));
  if (!held.some(row => onSite.has(row.name))) throw notFound;
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
