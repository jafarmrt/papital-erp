import { and, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, mediaAssets, storefrontProducts } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { normalizeSearchText } from '../../lib/search/searchText.js';
import { maxOrderQuantity, stockStatusOf, storefrontDesignKey } from '../../lib/storefront/storefrontRules.js';
import type {
  StorefrontCatalogPage, StorefrontFacet, StorefrontImage, StorefrontProductCard, StorefrontProductDetail, StorefrontPublicSettings,
  StorefrontStock,
} from '../../lib/storefront/storefrontContracts.js';
import { storefrontSellable } from './storefrontStock.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import type { StorefrontSettingsInput } from '../../lib/storefront/storefrontContracts.js';
import { listShippingMethods } from './storefrontShipping.service.js';
import { imagesOf, pricesOf } from './storefrontItemData.js';
import { smsLoginOn } from './storefrontSmsSettings.service.js';

/**
 * v11 phase 8.1 (package 18): what the Storefront API answers the site app, read only. An item is on the site while its
 * storefront row is published, it is a live finished product and it has a rial price in the retail list of the settings;
 * one that loses its price leaves the site at once (start plan decision 3). The set of such items is small (the shop has
 * tens to a few hundred products), so it is read whole, filtered and sorted here, and only the page's stock and covers
 * are read. Stock is the sellable quantity of the site's warehouse (a setting, decision 5), shown as موجود / تعداد کم /
 * ناموجود with the settings' threshold, and the number of units only when the settings say so (decision 4).
 */
export const CATALOG_PAGE_MAX = 60;
export const CATALOG_SORTS = ['default', 'newest', 'price_asc', 'price_desc'] as const;
export type CatalogSort = typeof CATALOG_SORTS[number];

export interface CatalogQuery {
  page: number;
  limit: number;
  q: string;
  collection: string;
  category: string;
  sort: CatalogSort;
}

export interface OnSale {
  itemId: number;
  slug: string;
  sku: string;
  name: string;
  category: string;
  collections: string[];
  sortOrder: number;
  description: string;
  material: string;
  size: string;
  color: string;
  weight: number | null;
  designYear: number | null;
  seoTitle: string;
  seoDescription: string;
  /** storefrontDesignKey: items with the same key share a design («از همین طرح»); the key itself is never sent */
  designKey: string;
  retailPrice: string;
}

/** Every item the site offers now, in the shop's own order */
async function itemsOnSale(executor: DbExecutor, settings: StorefrontSettingsInput, slug?: string, slugs?: string[]): Promise<OnSale[]> {
  const conditions = [eq(storefrontProducts.isPublished, 1), eq(items.isDeleted, 0), eq(items.type, 'product')];
  if (slug !== undefined) conditions.push(eq(storefrontProducts.slug, slug));
  if (slugs !== undefined) {
    if (slugs.length === 0) return [];
    conditions.push(inArray(storefrontProducts.slug, slugs));
  }
  const rows = await executor.select({
    itemId: items.id, slug: storefrontProducts.slug, sku: items.code, name: items.name, category: items.category,
    collections: items.collections, sortOrder: storefrontProducts.sortOrder, description: items.productDescription,
    material: items.material, size: items.size, color: items.color, weight: items.weight, designYear: items.designYear,
    seoTitle: storefrontProducts.seoTitle, seoDescription: storefrontProducts.seoDescription, transferCode: items.transferCode,
  }).from(storefrontProducts).innerJoin(items, eq(items.id, storefrontProducts.itemId)).where(and(...conditions));
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.itemId);
  const retail = await pricesOf(executor, ids, settings.retailPriceList);
  const out: OnSale[] = [];
  for (const { transferCode, ...r } of rows) {
    const retailPrice = retail.get(r.itemId);
    if (!retailPrice) continue;
    out.push({
      ...r, category: r.category ?? '', collections: r.collections ?? [], description: r.description ?? '', material: r.material ?? '',
      size: r.size ?? '', color: r.color ?? '', weight: r.weight ?? null, designKey: storefrontDesignKey(transferCode, r.sku), retailPrice,
    });
  }
  return out.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.itemId - b.itemId));
}

/**
 * v11 phase 8.2a: the items of a cart as the site offers them now (published, a live finished product, priced in the
 * retail list), read in the order's transaction; an item missing from the answer is not on sale
 */
export async function orderableItems(executor: DbExecutor, settings: StorefrontSettingsInput, slugs: string[]): Promise<Map<string, OnSale>> {
  return new Map((await itemsOnSale(executor, settings, undefined, slugs)).map(item => [item.slug, item]));
}

/** v11 phase 8.2b: every item the site offers now, to price for a buyer group */
export async function catalogItems(executor: DbExecutor, settings: StorefrontSettingsInput): Promise<OnSale[]> {
  return itemsOnSale(executor, settings);
}

const compareRial = (a: string, b: string) => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

function sorted(list: OnSale[], sort: CatalogSort): OnSale[] {
  if (sort === 'newest') return [...list].sort((a, b) => b.itemId - a.itemId);
  if (sort === 'price_asc') return [...list].sort((a, b) => compareRial(a.retailPrice, b.retailPrice) || (a.itemId - b.itemId));
  if (sort === 'price_desc') return [...list].sort((a, b) => compareRial(b.retailPrice, a.retailPrice) || (a.itemId - b.itemId));
  return list;
}

/** The search box's fold, the same as every list of the ERP (Arabic «ي/ك», digits, case) */
const folded = (text: string) => normalizeSearchText(text);

function stockOf(sellable: Map<number, number>, itemId: number, settings: StorefrontSettingsInput): StorefrontStock {
  const units = sellable.get(itemId) ?? 0;
  return { status: stockStatusOf(units, settings.lowStockThreshold), quantity: settings.stockDisplay === 'count' ? maxOrderQuantity(units) : null };
}

function cardOf(item: OnSale, stock: StorefrontStock, cover: StorefrontImage | null): StorefrontProductCard {
  return {
    slug: item.slug, sku: item.sku, name: item.name, category: item.category, collections: item.collections,
    retailPrice: item.retailPrice, stock, cover,
  };
}

const altOf = (image: StorefrontImage, name: string): StorefrontImage => ({ ...image, alt: image.alt || name });

export async function catalogPage(query: CatalogQuery): Promise<StorefrontCatalogPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(CATALOG_PAGE_MAX, Math.max(1, query.limit));
  const q = folded(query.q);
  const settings = await storefrontSettingValues(orm);
  const matching = (await itemsOnSale(orm, settings)).filter(item =>
    (!query.collection || item.collections.includes(query.collection))
    && (!query.category || item.category === query.category)
    && (!q || folded(`${item.name} ${item.sku} ${item.collections.join(' ')}`).includes(q)));
  const pageItems = sorted(matching, query.sort).slice((page - 1) * limit, page * limit);
  const ids = pageItems.map(i => i.itemId);
  const sellable = await storefrontSellable(orm, ids, settings.warehouseCode);
  const covers = await imagesOf(orm, ids, { coverOnly: true });
  return {
    data: pageItems.map(item => {
      const cover = covers.get(item.itemId)?.[0];
      return cardOf(item, stockOf(sellable, item.itemId, settings), cover ? altOf(cover, item.name) : null);
    }),
    total: matching.length, page, limit,
  };
}

/**
 * v11 phase 8.5b: the cards of a campaign page: the chosen items still on the site in the given order, or a collection's
 * items in the shop's order; at most `limit`
 */
export async function campaignCards(products: { itemIds: number[] } | { collection: string }, limit: number): Promise<StorefrontProductCard[]> {
  const settings = await storefrontSettingValues(orm);
  const onSale = await itemsOnSale(orm, settings);
  let chosen: OnSale[];
  if ('itemIds' in products) {
    const byId = new Map(onSale.map(item => [item.itemId, item]));
    chosen = products.itemIds.map(id => byId.get(id)).filter((item): item is OnSale => item !== undefined);
  } else {
    chosen = onSale.filter(item => item.collections.includes(products.collection));
  }
  chosen = chosen.slice(0, limit);
  const ids = chosen.map(i => i.itemId);
  const sellable = await storefrontSellable(orm, ids, settings.warehouseCode);
  const covers = await imagesOf(orm, ids, { coverOnly: true });
  return chosen.map(item => {
    const cover = covers.get(item.itemId)?.[0];
    return cardOf(item, stockOf(sellable, item.itemId, settings), cover ? altOf(cover, item.name) : null);
  });
}

/** At most this many other items of the same design are shown on a product page */
export const SAME_DESIGN_MAX = 12;

export async function productBySlug(slug: string): Promise<StorefrontProductDetail> {
  const settings = await storefrontSettingValues(orm);
  const [item] = await itemsOnSale(orm, settings, slug);
  if (!item) throw new NotFoundError('محصول پیدا نشد.', undefined, 'STOREFRONT_PRODUCT_NOT_FOUND');
  // v11 phase 8.3 (owner, 2026-11-03): the items that share the transfer code are «هم‌طرح»; the site shows them under that
  // name, not as a field (a standard product code still carries the code in its third part, as on every label)
  const twins = item.designKey
    ? (await itemsOnSale(orm, settings)).filter(other => other.designKey === item.designKey && other.itemId !== item.itemId).slice(0, SAME_DESIGN_MAX)
    : [];
  const ids = [item.itemId, ...twins.map(t => t.itemId)];
  const sellable = await storefrontSellable(orm, ids, settings.warehouseCode);
  const images = (await imagesOf(orm, [item.itemId])).get(item.itemId)?.map(image => altOf(image, item.name)) ?? [];
  const twinCovers = twins.length > 0 ? await imagesOf(orm, twins.map(t => t.itemId), { coverOnly: true }) : new Map<number, StorefrontImage[]>();
  const sameDesign = twins.map(twin => {
    const cover = twinCovers.get(twin.itemId)?.[0];
    return cardOf(twin, stockOf(sellable, twin.itemId, settings), cover ? altOf(cover, twin.name) : null);
  });
  return {
    ...cardOf(item, stockOf(sellable, item.itemId, settings), images.find(i => i.isCover) ?? images[0] ?? null),
    description: item.description, material: item.material, size: item.size, color: item.color,
    weightGrams: item.weight !== null && item.weight > 0 ? Math.round(item.weight) : null, designYear: item.designYear,
    seoTitle: item.seoTitle, seoDescription: item.seoDescription, images, sameDesign,
  };
}

function facet(values: string[]): StorefrontFacet[] {
  const counts = new Map<string, number>();
  for (const value of values) if (value.trim()) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

/** The collections and categories that have an item on the site, with their counts */
export async function catalogFacets(): Promise<{ collections: StorefrontFacet[]; categories: StorefrontFacet[] }> {
  const onSale = await itemsOnSale(orm, await storefrontSettingValues(orm));
  return { collections: facet(onSale.flatMap(i => i.collections)), categories: facet(onSale.map(i => i.category)) };
}

/** What the checkout shows: where to pay, the free-shipping threshold, the reservation hours and the active methods */
export async function publicSettings(): Promise<StorefrontPublicSettings> {
  const settings = await storefrontSettingValues(orm);
  const methods = await listShippingMethods(orm, { activeOnly: true });
  return {
    currency: 'IRR',
    payment: { cardNumber: settings.cardNumber, cardHolder: settings.cardHolder, bankName: settings.bankName, iban: settings.iban },
    freeShippingThreshold: settings.freeShippingThreshold,
    reservationHours: settings.reservationHours,
    stockDisplay: settings.stockDisplay,
    whatsapp: settings.whatsappEnabled ? settings.whatsappNumber : '',
    smsLogin: await smsLoginOn(orm),
    ordering: settings.enabled && settings.ordersEnabled,
    shippingMethods: methods.map(({ id: _id, version: _version, isActive: _active, sortOrder: _sort, ...method }) => method),
  };
}

const MEDIA_FILE = /^([0-9a-f]{64})(-thumb)?\.webp$/;

/** The light (or thumbnail) WEBP of an image of an item on the site (published and priced); any other file is the same 404 */
export async function storefrontMediaFile(file: string): Promise<string> {
  const match = MEDIA_FILE.exec(file);
  const notFound = new NotFoundError('پیدا نشد');
  if (!match) throw notFound;
  const [sha256, thumb] = [match[1], Boolean(match[2])];
  const rows = await orm.select({ itemId: mediaAssets.itemId, lightBytes: mediaAssets.lightBytes, thumbBytes: mediaAssets.thumbBytes })
    .from(mediaAssets)
    .innerJoin(storefrontProducts, eq(storefrontProducts.itemId, mediaAssets.itemId))
    .innerJoin(items, eq(items.id, mediaAssets.itemId))
    .where(and(eq(mediaAssets.sha256, sha256), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'),
      eq(storefrontProducts.isPublished, 1), eq(items.isDeleted, 0), eq(items.type, 'product')));
  const withFile = rows.filter(r => (thumb ? r.thumbBytes : r.lightBytes) !== null).map(r => Number(r.itemId));
  if (withFile.length === 0) throw notFound;
  const priced = await pricesOf(orm, withFile, (await storefrontSettingValues(orm)).retailPriceList);
  if (!withFile.some(itemId => priced.has(itemId))) throw notFound;
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
