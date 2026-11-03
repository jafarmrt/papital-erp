import type { Request } from 'express';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { foldedContains } from '../../lib/search/searchSql.js';
import { orm } from '../../db/drizzle.js';
import { items, storefrontProducts } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import {
  PUBLISH_BLOCKER_MESSAGES, STOREFRONT_SEO_DESCRIPTION_MAX, STOREFRONT_SEO_TITLE_MAX, slugError, suggestedSlug, type PublishBlocker,
} from '../../lib/storefront/storefrontRules.js';
import type {
  StorefrontProductAdminPage, StorefrontProductAdminRow, StorefrontProductInput,
} from '../../lib/storefront/storefrontContracts.js';
import { storefrontSellable } from './storefrontStock.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import { imagesOf, pricesOf } from './storefrontItemData.js';

/**
 * v11 phase 8.1 (package 18): which items the site offers, under which address and SEO texts. The list shows every live
 * finished product with its storefront row (none until the first save), its retail price, cover and sellable stock in the
 * site's warehouse (`storefrontSellable`), and why it cannot be published. A save is one row under its version (0 = the item has no row
 * yet); publishing an item without a retail price is refused (start plan decision 3).
 */
export const STOREFRONT_PAGE_MAX = 100;
const SORT_MAX = 100_000;

export type PublishedFilter = 'all' | 'published' | 'unpublished';

export interface StorefrontProductQuery {
  page: number;
  limit: number;
  q: string;
  published: PublishedFilter;
}

function blockerOf(type: string, retailList: string, retailPrice: string | null): PublishBlocker | null {
  if (type !== 'product') return 'not_product';
  if (!retailList) return 'retail_list_unset';
  return retailPrice === null ? 'no_retail_price' : null;
}

async function adminRows(where: SQL | undefined, limit: number, offset: number): Promise<StorefrontProductAdminRow[]> {
  const rows = await orm.select({
    itemId: items.id, code: items.code, name: items.name, category: items.category, collections: items.collections, type: items.type,
    published: storefrontProducts.isPublished, slug: storefrontProducts.slug, seoTitle: storefrontProducts.seoTitle,
    seoDescription: storefrontProducts.seoDescription, sortOrder: storefrontProducts.sortOrder, version: storefrontProducts.version,
  }).from(items).leftJoin(storefrontProducts, eq(storefrontProducts.itemId, items.id)).where(where)
    .orderBy(sql`${storefrontProducts.isPublished} DESC NULLS LAST`, asc(storefrontProducts.sortOrder), asc(items.code), asc(items.id))
    .limit(limit).offset(offset);

  const ids = rows.map(r => r.itemId);
  if (ids.length === 0) return [];
  const settings = await storefrontSettingValues(orm);
  const prices = await pricesOf(orm, ids, settings.retailPriceList);
  const covers = await imagesOf(orm, ids, { coverOnly: true });
  const sellable = await storefrontSellable(orm, ids, settings.warehouseCode);

  return rows.map(r => {
    const retailPrice = prices.get(r.itemId) ?? null;
    return {
      itemId: r.itemId, code: r.code, name: r.name, category: r.category ?? '', collections: r.collections ?? [],
      hasCover: (covers.get(r.itemId)?.length ?? 0) > 0, retailPrice, sellable: sellable.get(r.itemId) ?? 0,
      published: r.published === 1, slug: r.slug ?? suggestedSlug(r.code), seoTitle: r.seoTitle ?? '', seoDescription: r.seoDescription ?? '',
      sortOrder: r.sortOrder ?? 0, version: r.version ?? null, blocker: blockerOf(r.type, settings.retailPriceList, retailPrice),
    };
  });
}

export async function listStorefrontProducts(query: StorefrontProductQuery): Promise<StorefrontProductAdminPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(STOREFRONT_PAGE_MAX, Math.max(1, query.limit));
  const conditions: SQL[] = [eq(items.type, 'product'), eq(items.isDeleted, 0)];
  const searched = foldedContains([items.code, items.name, storefrontProducts.slug], query.q);
  if (searched) conditions.push(searched);
  if (query.published === 'published') conditions.push(eq(storefrontProducts.isPublished, 1));
  if (query.published === 'unpublished') conditions.push(or(isNull(storefrontProducts.id), eq(storefrontProducts.isPublished, 0)) as SQL);
  const where = and(...conditions);

  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(items)
    .leftJoin(storefrontProducts, eq(storefrontProducts.itemId, items.id)).where(where);
  const [{ publishedCount }] = await orm.select({ publishedCount: sql<number>`count(*)::int` }).from(storefrontProducts)
    .innerJoin(items, eq(items.id, storefrontProducts.itemId))
    .where(and(eq(storefrontProducts.isPublished, 1), eq(items.isDeleted, 0), eq(items.type, 'product')));

  const data = await adminRows(where, limit, (page - 1) * limit);
  return { data, total, publishedCount, page, limit };
}

function checkedProduct(input: StorefrontProductInput): StorefrontProductInput {
  const slug = input.slug.trim().toLowerCase();
  const error = slugError(slug);
  if (error) throw new ValidationError(error, undefined, 'STOREFRONT_SLUG_INVALID');
  const seoTitle = input.seoTitle.trim();
  const seoDescription = input.seoDescription.trim();
  if (seoTitle.length > STOREFRONT_SEO_TITLE_MAX) {
    throw new ValidationError(`عنوان جست‌وجو حداکثر ${STOREFRONT_SEO_TITLE_MAX.toLocaleString('fa-IR')} نویسه است.`, undefined, 'STOREFRONT_SEO_TITLE_TOO_LONG');
  }
  if (seoDescription.length > STOREFRONT_SEO_DESCRIPTION_MAX) {
    throw new ValidationError(`توضیح جست‌وجو حداکثر ${STOREFRONT_SEO_DESCRIPTION_MAX.toLocaleString('fa-IR')} نویسه است.`, undefined, 'STOREFRONT_SEO_DESCRIPTION_TOO_LONG');
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > SORT_MAX) {
    throw new ValidationError('ترتیب نمایش باید عدد درست صفر یا بزرگ‌تر باشد.', undefined, 'STOREFRONT_SORT_INVALID');
  }
  return { ...input, slug, seoTitle, seoDescription };
}

/** Publishes, unpublishes or edits the address and SEO texts of one item; answers the item's row as the list shows it */
export async function saveStorefrontProduct(req: Request, itemId: number, input: StorefrontProductInput): Promise<StorefrontProductAdminRow> {
  const values = checkedProduct(input);
  await orm.transaction(async (tx) => {
    const [item] = await tx.select({ id: items.id, code: items.code, name: items.name, type: items.type }).from(items)
      .where(and(eq(items.id, itemId), eq(items.isDeleted, 0))).for('share');
    if (!item) throw new NotFoundError('کالا پیدا نشد.', undefined, 'STOREFRONT_ITEM_NOT_FOUND');
    const [current] = await tx.select().from(storefrontProducts).where(eq(storefrontProducts.itemId, itemId)).for('update');
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== values.version) {
      throw new OptimisticLockError({ entityType: 'StorefrontProduct', entityId: itemId, expectedVersion: values.version, currentVersion });
    }
    if (values.published) {
      const settings = await storefrontSettingValues(tx);
      const prices = await pricesOf(tx, [itemId], settings.retailPriceList);
      const blocker = blockerOf(item.type, settings.retailPriceList, prices.get(itemId) ?? null);
      if (blocker) throw new ValidationError(PUBLISH_BLOCKER_MESSAGES[blocker], { blocker }, 'STOREFRONT_PUBLISH_BLOCKED');
    }
    const [taken] = await tx.select({ itemId: storefrontProducts.itemId }).from(storefrontProducts)
      .where(and(eq(storefrontProducts.slug, values.slug), current ? sql`${storefrontProducts.id} <> ${current.id}` : sql`true`)).limit(1);
    if (taken) throw new ConflictError(`نشانی «${values.slug}» را کالای دیگری دارد.`, { itemId: taken.itemId }, 'STOREFRONT_SLUG_TAKEN');

    const fields = {
      isPublished: values.published ? 1 : 0, slug: values.slug, seoTitle: values.seoTitle, seoDescription: values.seoDescription,
      sortOrder: values.sortOrder,
    };
    if (current) {
      await tx.update(storefrontProducts).set({ ...fields, updatedAt: systemNowUtcIso(), version: nextVersion(current.version) })
        .where(eq(storefrontProducts.id, current.id));
    } else {
      await tx.insert(storefrontProducts).values({ ...fields, itemId, createdBy: String((req.user as { username?: string } | undefined)?.username ?? '') });
    }
    const before = current
      ? { published: current.isPublished === 1, slug: current.slug, seoTitle: current.seoTitle, seoDescription: current.seoDescription, sortOrder: current.sortOrder }
      : null;
    const after = { published: values.published, slug: values.slug, seoTitle: values.seoTitle, seoDescription: values.seoDescription, sortOrder: values.sortOrder };
    const verb = before?.published === after.published ? 'ویرایش شد' : after.published ? 'روی سایت منتشر شد' : 'از سایت برداشته شد';
    await logActivity({
      req, tx, action: current ? 'UPDATE' : 'CREATE', entity: 'فروشگاه سایت', entityId: `item-${itemId}`,
      description: `کالای ${item.code} «${item.name}» ${verb}`, details: { before, after },
    });
  });
  const [row] = await adminRows(and(eq(items.id, itemId), eq(items.isDeleted, 0)), 1, 0);
  if (!row) throw new NotFoundError('کالا پیدا نشد.', undefined, 'STOREFRONT_ITEM_NOT_FOUND');
  return row;
}
