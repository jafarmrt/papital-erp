import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { itemPrices, mediaAssets, storefrontProducts } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { ItemPricingService } from '../items/itemPricing.service.js';
import type { StorefrontImage } from '../../lib/storefront/storefrontContracts.js';

/**
 * v11 phase 8.1 (package 18): what the admin list and the Storefront API read of an item besides its card: its rial price in
 * one price list and its images. A price counts only in rials, whole and above zero (the site has no other currency); any
 * other price is «no price», so the item is not offered rather than offered at a wrong amount.
 */
const ID_CHUNK = 5000;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
}

/** The whole rial amount of a stored price, or null */
export function sitePrice(price: unknown, currency: string | null | undefined): string | null {
  if (String(currency || 'IRR').trim().toUpperCase() !== 'IRR') return null;
  const raw = String(price ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const value = fin(raw);
  if (!value.isPositive() || !value.equals(value.round(0))) return null;
  return value.round(0).toString();
}

/** Each item's price in a configured list ('' list = no prices) */
export async function pricesOf(executor: DbExecutor, itemIds: number[], priceList: string): Promise<Map<number, string>> {
  const prices = new Map<number, string>();
  if (!priceList || itemIds.length === 0) return prices;
  for (const part of chunks([...new Set(itemIds)])) {
    const rows = await executor.select().from(itemPrices).where(and(inArray(itemPrices.itemId, part), eq(itemPrices.isDeleted, 0)));
    for (const p of ItemPricingService.filterActivePrices(rows, [priceList])) {
      const value = sitePrice(p.price, p.currency);
      if (value !== null) prices.set(Number(p.itemId), value);
    }
  }
  return prices;
}

/**
 * The live images of each item that have a light version: the cover first, then the library order. `coverOnly` (cards)
 * keeps one image per item: the cover, or (v12 phase 7) the first image in the library order when the item has no cover
 * mark, so a product with photos never shows as «without a featured image».
 */
export async function imagesOf(executor: DbExecutor, itemIds: number[], options: { coverOnly?: boolean } = {}): Promise<Map<number, StorefrontImage[]>> {
  const images = new Map<number, StorefrontImage[]>();
  if (itemIds.length === 0) return images;
  for (const part of chunks([...new Set(itemIds)])) {
    const conditions = [
      inArray(mediaAssets.itemId, part), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes),
    ];
    const rows = await executor.select({
      itemId: mediaAssets.itemId, sha256: mediaAssets.sha256, width: mediaAssets.width, height: mediaAssets.height,
      title: mediaAssets.title, isCover: mediaAssets.isCover, sortOrder: mediaAssets.sortOrder, id: mediaAssets.id,
    }).from(mediaAssets).where(and(...conditions));
    rows.sort((a, b) => (b.isCover - a.isCover) || (a.sortOrder - b.sortOrder) || (a.id - b.id));
    for (const row of rows) {
      const itemId = Number(row.itemId);
      const list = images.get(itemId) ?? [];
      // one file may be filed twice for an item; the site shows it once
      if (list.some(image => image.sha256 === row.sha256)) continue;
      if (options.coverOnly && list.length > 0) continue;
      list.push({ sha256: row.sha256, width: row.width, height: row.height, alt: row.title.trim(), isCover: row.isCover === 1 });
      images.set(itemId, list);
    }
  }
  return images;
}

/** The later of a kept instant and a stored time (a row's `timestamptz`, as the driver gives it); a time that cannot be read changes nothing */
const later = (a: string | undefined, b: unknown): string | undefined => {
  const time = typeof b === 'string' && b ? Date.parse(serverTimestampToUtcIso(b) ?? '') : NaN;
  if (Number.isNaN(time)) return a;
  return a === undefined || time > Date.parse(a) ? new Date(time).toISOString() : a;
};

/**
 * v12 phase 10c (the sitemap's `lastmod`): when each item's page on the site last changed, as far as a row records it
 * (an ISO instant in UTC): the item's row of the site (publishing, address, search title and description, order), its
 * images in the library (added, replaced, renamed, removed) and its price in the site's price list. The item card has
 * no time of its own, so a change of its name or description alone does not move this; the date is then older than
 * the truth, never newer, which is the safe side for a search engine.
 */
export async function changedAtOf(executor: DbExecutor, itemIds: number[], priceList: string): Promise<Map<number, string>> {
  const changed = new Map<number, string>();
  const note = (itemId: number | null, at: unknown) => {
    if (itemId === null) return;
    const next = later(changed.get(itemId), at);
    if (next !== undefined) changed.set(itemId, next);
  };
  for (const part of chunks([...new Set(itemIds)])) {
    const rows = await executor.select({ itemId: storefrontProducts.itemId, at: storefrontProducts.updatedAt }).from(storefrontProducts)
      .where(inArray(storefrontProducts.itemId, part));
    for (const row of rows) note(row.itemId, row.at);
    const images = await executor.select({ itemId: mediaAssets.itemId, at: sql<string | null>`max(${mediaAssets.updatedAt})` }).from(mediaAssets)
      .where(and(inArray(mediaAssets.itemId, part), eq(mediaAssets.kind, 'image'))).groupBy(mediaAssets.itemId);
    for (const row of images) note(row.itemId, row.at);
    if (!priceList) continue;
    const prices = await executor.select().from(itemPrices).where(and(inArray(itemPrices.itemId, part), eq(itemPrices.isDeleted, 0)));
    for (const price of ItemPricingService.filterActivePrices(prices, [priceList])) {
      note(Number(price.itemId), price.createdAt);
      note(Number(price.itemId), price.updatedAt);
    }
  }
  return changed;
}
