import { orm } from '../../db/drizzle.js';
import type { StorefrontFeedItem } from '../../lib/storefront/storefrontContracts.js';
import { stockStatusOf } from '../../lib/storefront/storefrontRules.js';
import { catalogItems } from './storefrontCatalog.service.js';
import { imagesOf } from './storefrontItemData.js';
import { storefrontSellable } from './storefrontStock.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.5b (start plan 8.5 §4): the product feed. Every item the site offers now, in the shop's order, with what its
 * own page already shows: name, code, category, collections, the retail price, whether it is in stock, its description,
 * material, colour and photos. Nothing a page does not show (no cost, no other price list, no stock count, no design key).
 * The site writes it as Google's feed format and caches it; a shop of a few hundred items is one read.
 */
export const FEED_IMAGES_MAX = 10;
export const FEED_DESCRIPTION_MAX = 5000;

export async function catalogFeed(): Promise<StorefrontFeedItem[]> {
  const settings = await storefrontSettingValues(orm);
  const onSale = await catalogItems(orm, settings);
  const ids = onSale.map(item => item.itemId);
  const sellable = await storefrontSellable(orm, ids, settings.warehouseCode);
  const images = await imagesOf(orm, ids);
  return onSale.map(item => ({
    slug: item.slug, sku: item.sku, name: item.name, category: item.category, collections: item.collections, retailPrice: item.retailPrice,
    description: (item.seoDescription.trim() || item.description.trim()).slice(0, FEED_DESCRIPTION_MAX),
    material: item.material, color: item.color, inStock: stockStatusOf(sellable.get(item.itemId) ?? 0) !== 'out',
    images: (images.get(item.itemId) ?? []).slice(0, FEED_IMAGES_MAX).map(image => ({ ...image, alt: image.alt || item.name })),
  }));
}
