import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { itemPrices, mediaAssets } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
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

/** The live images of each item that have a light version: the cover first, then the library order */
export async function imagesOf(executor: DbExecutor, itemIds: number[], options: { coverOnly?: boolean } = {}): Promise<Map<number, StorefrontImage[]>> {
  const images = new Map<number, StorefrontImage[]>();
  if (itemIds.length === 0) return images;
  for (const part of chunks([...new Set(itemIds)])) {
    const conditions = [
      inArray(mediaAssets.itemId, part), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes),
    ];
    if (options.coverOnly) conditions.push(eq(mediaAssets.isCover, 1));
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
      list.push({ sha256: row.sha256, width: row.width, height: row.height, alt: row.title.trim(), isCover: row.isCover === 1 });
      images.set(itemId, list);
    }
  }
  return images;
}
