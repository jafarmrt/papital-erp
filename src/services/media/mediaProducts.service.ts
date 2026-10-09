import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { orm } from '../../db/drizzle.js';
import { items, mediaAssets } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { computeAuditDiff, logActivity } from '../../lib/auditLogger.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { nextVersion } from '../../lib/occHelper.js';
import { assetView, MediaAssetService, type MediaAssetView } from './mediaAsset.service.js';
import { productCardValues, type ProductCardInput } from './productCardWrite.js';

/**
 * v10.0.17 (N-05 PR 2): the product side of the media library. The grid lists live products (`items.type = 'product'`)
 * with the counts of their files in the «محصولات» section, filtered and paged in SQL; the product page reads one product
 * with its card and files; the card is edited with the item's own version (OCC, TD-654) and audited under «کالا».
 */

export const ITEM_AUDIT_ENTITY = 'کالا';

export interface MediaProductFilters {
  search?: string;
  collection?: string;
  designYear?: number;
  transferCode?: string;
  category?: string;
  withoutImages?: boolean;
  withoutWhiteBackground?: boolean;
  lowQuality?: boolean;
  page: number;
  limit: number;
}

export interface MediaProductRow {
  itemId: number;
  code: string;
  name: string;
  category: string | null;
  collections: string[];
  designYear: number | null;
  transferCode: string | null;
  assetCount: number;
  imageCount: number;
  videoCount: number;
  lowQualityCount: number;
  coverAssetId: number | null;
  coverHasThumb: boolean;
}

const liveProduct = and(eq(items.isDeleted, 0), eq(items.type, 'product'))!;

/** Live files of the item `items.id` in the products section (correlated subquery body) */
const liveAssetsOfItem = sql`${mediaAssets.itemId} = ${items.id} AND ${mediaAssets.isDeleted} = 0`;

function productConditions(f: MediaProductFilters): SQL {
  const conditions: SQL[] = [liveProduct];
  const search = f.search?.trim();
  if (search) {
    const pattern = containsLikePattern(search);
    conditions.push(sql`(${items.code} ILIKE ${pattern} OR ${items.name} ILIKE ${pattern} OR ${items.transferCode} ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM unnest(${items.collections}) AS c(name) WHERE c.name ILIKE ${pattern}))`);
  }
  if (f.collection?.trim()) {
    const key = f.collection.trim().toLowerCase();
    conditions.push(sql`EXISTS (SELECT 1 FROM unnest(${items.collections}) AS c(name) WHERE lower(c.name) = ${key})`);
  }
  if (f.designYear !== undefined) conditions.push(eq(items.designYear, f.designYear));
  if (f.transferCode?.trim()) conditions.push(sql`lower(btrim(${items.transferCode})) = ${f.transferCode.trim().toLowerCase()}`);
  if (f.category?.trim()) conditions.push(eq(items.category, f.category.trim()));
  if (f.withoutImages) {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM ${mediaAssets} WHERE ${liveAssetsOfItem} AND ${mediaAssets.kind} = 'image')`);
  }
  if (f.withoutWhiteBackground) {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM ${mediaAssets} WHERE ${liveAssetsOfItem} AND ${mediaAssets.shotType} = 'white_background')`);
  }
  if (f.lowQuality) {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${mediaAssets} WHERE ${liveAssetsOfItem} AND ${mediaAssets.isLowQuality} = 1)`);
  }
  return and(...conditions)!;
}

const toNumber = (v: unknown) => Number(v ?? 0);

export const MediaProductService = {
  async list(f: MediaProductFilters): Promise<{ data: MediaProductRow[]; total: number; page: number; limit: number }> {
    const where = productConditions(f);
    const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(items).where(where);
    const rows = await orm.select({
      itemId: items.id,
      code: items.code,
      name: items.name,
      category: items.category,
      collections: items.collections,
      designYear: items.designYear,
      transferCode: items.transferCode,
      assetCount: sql<number>`(SELECT count(*)::int FROM ${mediaAssets} WHERE ${liveAssetsOfItem})`,
      imageCount: sql<number>`(SELECT count(*)::int FROM ${mediaAssets} WHERE ${liveAssetsOfItem} AND ${mediaAssets.kind} = 'image')`,
      videoCount: sql<number>`(SELECT count(*)::int FROM ${mediaAssets} WHERE ${liveAssetsOfItem} AND ${mediaAssets.kind} = 'video')`,
      lowQualityCount: sql<number>`(SELECT count(*)::int FROM ${mediaAssets} WHERE ${liveAssetsOfItem} AND ${mediaAssets.isLowQuality} = 1)`,
      // the cover is the file marked as cover, else the first file with a thumbnail in the product's order
      coverAssetId: sql<number | null>`(SELECT ${mediaAssets.id} FROM ${mediaAssets} WHERE ${liveAssetsOfItem}
        AND ${mediaAssets.thumbBytes} IS NOT NULL
        ORDER BY ${mediaAssets.isCover} DESC, ${mediaAssets.sortOrder} ASC, ${mediaAssets.id} ASC LIMIT 1)`,
    }).from(items).where(where)
      .orderBy(asc(items.code), asc(items.id))
      .limit(f.limit).offset((f.page - 1) * f.limit);
    return {
      data: rows.map(r => ({
        ...r,
        collections: r.collections ?? [],
        assetCount: toNumber(r.assetCount),
        imageCount: toNumber(r.imageCount),
        videoCount: toNumber(r.videoCount),
        lowQualityCount: toNumber(r.lowQualityCount),
        coverAssetId: r.coverAssetId === null ? null : Number(r.coverAssetId),
        coverHasThumb: r.coverAssetId !== null,
      })),
      total: Number(total),
      page: f.page,
      limit: f.limit,
    };
  },

  /** The values the grid filters offer, read from live products */
  async filters(): Promise<{ collections: string[]; designYears: number[]; transferCodes: string[]; categories: string[] }> {
    const collections = await orm.execute(sql`
      SELECT min(c.name) AS name FROM ${items}, unnest(${items.collections}) AS c(name)
       WHERE ${liveProduct} GROUP BY lower(c.name) ORDER BY lower(c.name)`);
    const years = await orm.selectDistinct({ v: items.designYear }).from(items)
      .where(and(liveProduct, sql`${items.designYear} IS NOT NULL`)).orderBy(asc(items.designYear));
    const codes = await orm.selectDistinct({ v: items.transferCode }).from(items)
      .where(and(liveProduct, sql`${items.transferCode} IS NOT NULL`)).orderBy(asc(items.transferCode));
    const categories = await orm.selectDistinct({ v: items.category }).from(items)
      .where(and(liveProduct, sql`coalesce(${items.category}, '') <> ''`)).orderBy(asc(items.category));
    return {
      collections: (collections.rows as Array<{ name: string }>).map(r => r.name),
      designYears: years.map(r => Number(r.v)),
      transferCodes: codes.map(r => String(r.v)),
      categories: categories.map(r => String(r.v)),
    };
  },

  async detail(itemId: number): Promise<{ item: ReturnType<typeof productCardOf>; assets: MediaAssetView[]; productsSectionId: number }> {
    const [item] = await orm.select().from(items).where(and(eq(items.id, itemId), liveProduct));
    if (!item) throw new NotFoundError('محصول یافت نشد.', undefined, 'MEDIA_PRODUCT_NOT_FOUND');
    const assets = await orm.select().from(mediaAssets)
      .where(and(eq(mediaAssets.itemId, itemId), eq(mediaAssets.isDeleted, 0)))
      .orderBy(asc(mediaAssets.sortOrder), asc(mediaAssets.id));
    return { item: productCardOf(item), assets: assets.map(assetView), productsSectionId: await MediaAssetService.productsSectionId() };
  },

  /**
   * Edits the product card of a product. The item row is locked and its version must be the one the page was built from
   * (409 `OCC_CONFLICT` otherwise); the edit advances the version and writes one «کالا» audit row with `tx`.
   */
  async updateInfo(itemId: number, input: { version: number } & ProductCardInput, actor: { req?: Request; userId?: number; username: string }) {
    const values = productCardValues(input);
    return orm.transaction(async (tx) => {
      const [before] = await tx.select().from(items).where(and(eq(items.id, itemId), liveProduct)).for('update');
      if (!before) throw new NotFoundError('محصول یافت نشد.', undefined, 'MEDIA_PRODUCT_NOT_FOUND');
      if (before.version !== input.version) {
        throw new ConflictError('این محصول را کاربر دیگری تغییر داده؛ صفحه را دوباره باز کنید.', undefined, 'OCC_CONFLICT');
      }
      const [after] = await tx.update(items).set({ ...values, version: nextVersion(before.version) })
        .where(and(eq(items.id, itemId), eq(items.version, before.version))).returning();
      const beforeCard = productCardOf(before);
      const afterCard = productCardOf(after);
      const { diff, hasChanges } = computeAuditDiff(beforeCard, afterCard, ['version']);
      if (hasChanges) {
        await logActivity({
          tx, req: actor.req, userId: actor.userId, username: actor.username, action: 'UPDATE', entity: ITEM_AUDIT_ENTITY,
          entityId: itemId, description: `ویرایش کارت محصول «${before.name}» (${before.code}) در کتابخانه تصاویر`,
          details: { before: beforeCard, after: afterCard, changes: diff },
        });
      }
      return afterCard;
    });
  },
};

function productCardOf(item: typeof items.$inferSelect) {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category ?? null,
    unit: item.unit ?? null,
    color: item.color ?? null,
    material: item.material ?? null,
    size: item.size ?? null,
    weight: item.weight ?? null,
    collections: item.collections ?? [],
    designYear: item.designYear ?? null,
    transferCode: item.transferCode ?? null,
    productDescription: item.productDescription ?? null,
    technicalNotes: item.technicalNotes ?? null,
    version: item.version,
  };
}
