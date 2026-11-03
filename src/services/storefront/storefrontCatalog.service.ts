import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, mediaAssets, storefrontProducts } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { maxOrderQuantity, stockStatusOf } from '../../lib/storefront/storefrontRules.js';
import type {
  StorefrontCatalogPage, StorefrontFacet, StorefrontImage, StorefrontProductCard, StorefrontProductDetail, StorefrontPublicSettings,
  StorefrontStock,
} from '../../lib/storefront/storefrontContracts.js';
import { storefrontSellable } from './storefrontStock.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import type { StorefrontSettingsInput } from '../../lib/storefront/storefrontContracts.js';
import { listShippingMethods } from './storefrontShipping.service.js';
import { imagesOf, pricesOf } from './storefrontItemData.js';

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

interface OnSale {
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
  retailPrice: string;
  wholesalePrice: string | null;
}

/** Every item the site offers now, in the shop's own order */
async function itemsOnSale(settings: StorefrontSettingsInput, slug?: string): Promise<OnSale[]> {
  const conditions = [eq(storefrontProducts.isPublished, 1), eq(items.isDeleted, 0), eq(items.type, 'product')];
  if (slug !== undefined) conditions.push(eq(storefrontProducts.slug, slug));
  const rows = await orm.select({
    itemId: items.id, slug: storefrontProducts.slug, sku: items.code, name: items.name, category: items.category,
    collections: items.collections, sortOrder: storefrontProducts.sortOrder, description: items.productDescription,
    material: items.material, size: items.size, color: items.color, weight: items.weight, designYear: items.designYear,
    seoTitle: storefrontProducts.seoTitle, seoDescription: storefrontProducts.seoDescription,
  }).from(storefrontProducts).innerJoin(items, eq(items.id, storefrontProducts.itemId)).where(and(...conditions));
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.itemId);
  const retail = await pricesOf(orm, ids, settings.retailPriceList);
  const wholesale = await pricesOf(orm, ids, settings.wholesalePriceList);
  const out: OnSale[] = [];
  for (const r of rows) {
    const retailPrice = retail.get(r.itemId);
    if (!retailPrice) continue;
    out.push({
      ...r, category: r.category ?? '', collections: r.collections ?? [], description: r.description ?? '', material: r.material ?? '',
      size: r.size ?? '', color: r.color ?? '', weight: r.weight ?? null, retailPrice, wholesalePrice: wholesale.get(r.itemId) ?? null,
    });
  }
  return out.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.itemId - b.itemId));
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

/** Lower-case with Arabic ي and ك read as Persian, for the search box */
const folded = (text: string) => text.toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').trim();

function stockOf(sellable: Map<number, number>, itemId: number, settings: StorefrontSettingsInput): StorefrontStock {
  const quantity = sellable.get(itemId) ?? 0;
  const maxQuantity = maxOrderQuantity(quantity);
  return { status: stockStatusOf(quantity, settings.lowStockThreshold), maxQuantity, quantity: settings.stockDisplay === 'count' ? maxQuantity : null };
}

function cardOf(item: OnSale, stock: StorefrontStock, cover: StorefrontImage | null): StorefrontProductCard {
  return {
    slug: item.slug, sku: item.sku, name: item.name, category: item.category, collections: item.collections,
    retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice, stock, cover,
  };
}

const altOf = (image: StorefrontImage, name: string): StorefrontImage => ({ ...image, alt: image.alt || name });

export async function catalogPage(query: CatalogQuery): Promise<StorefrontCatalogPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(CATALOG_PAGE_MAX, Math.max(1, query.limit));
  const q = folded(query.q);
  const settings = await storefrontSettingValues(orm);
  const matching = (await itemsOnSale(settings)).filter(item =>
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

export async function productBySlug(slug: string): Promise<StorefrontProductDetail> {
  const settings = await storefrontSettingValues(orm);
  const [item] = await itemsOnSale(settings, slug);
  if (!item) throw new NotFoundError('محصول پیدا نشد.', undefined, 'STOREFRONT_PRODUCT_NOT_FOUND');
  const sellable = await storefrontSellable(orm, [item.itemId], settings.warehouseCode);
  const images = (await imagesOf(orm, [item.itemId])).get(item.itemId)?.map(image => altOf(image, item.name)) ?? [];
  return {
    ...cardOf(item, stockOf(sellable, item.itemId, settings), images.find(i => i.isCover) ?? images[0] ?? null),
    description: item.description, material: item.material, size: item.size, color: item.color,
    weightGrams: item.weight !== null && item.weight > 0 ? Math.round(item.weight) : null, designYear: item.designYear,
    seoTitle: item.seoTitle, seoDescription: item.seoDescription, images,
  };
}

function facet(values: string[]): StorefrontFacet[] {
  const counts = new Map<string, number>();
  for (const value of values) if (value.trim()) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

/** The collections and categories that have an item on the site, with their counts */
export async function catalogFacets(): Promise<{ collections: StorefrontFacet[]; categories: StorefrontFacet[] }> {
  const onSale = await itemsOnSale(await storefrontSettingValues(orm));
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
    shippingMethods: methods.map(({ id: _id, version: _version, isActive: _active, sortOrder: _sort, ...method }) => method),
  };
}

const MEDIA_FILE = /^([0-9a-f]{64})(-thumb)?\.webp$/;

/** The light (or thumbnail) WEBP of an image of an item on the site; any other file is the same 404 */
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
  const usable = rows.find(r => (thumb ? r.thumbBytes : r.lightBytes) !== null);
  if (!usable) throw notFound;
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
