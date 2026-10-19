import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, type wcProductLinks } from '../../db/schema.js';
import { WC_LIST_LIMIT } from '../../lib/woocommerce/wcCatalog.js';
import { sameSitePrice, type WcDriftRow } from '../../lib/woocommerce/wcShopSync.js';

/**
 * 10.2 package 6 (D-04 part C): the differences the nightly re-read finds between the shop and the program. A stock
 * difference is a tracked product whose stock in the shop is not the number the program last sent or read (changed by hand
 * in the shop, or an order the program did not follow); a price difference is a product whose regular price is not the one
 * the program sends from «فهرست قیمت فروشگاه». They are only listed: the automatic stock push compares the link again on its
 * next run (its shop stock changed) and the price push sends the price again, each only while its own setting is on.
 */
interface ReadProduct {
  stock: number | null;
  manageStock: boolean;
  type: string;
  regularPrice: string | null;
}

export interface KeptLink {
  /** the link as it was before this reading; null for a link this reading made */
  link: typeof wcProductLinks.$inferSelect | null;
  itemId: number;
  site: ReadProduct;
}

export async function catalogDifferences(
  executor: DbExecutor, pairs: KeptLink[], wantedPrices?: ReadonlyMap<number, string>,
): Promise<{ differences: WcDriftRow[]; differencesTotal: number }> {
  const found: Array<Omit<WcDriftRow, 'code' | 'name'>> = [];
  for (const { link, itemId, site } of pairs) {
    if (link && link.siteManageStock === 1 && site.manageStock && link.siteStock !== null && site.stock !== link.siteStock) {
      found.push({ itemId, kind: 'stock', site: site.stock === null ? null : String(site.stock), program: String(link.siteStock) });
    }
    const wanted = wantedPrices?.get(itemId);
    if (wanted !== undefined && site.type !== 'variable' && !sameSitePrice(site.regularPrice, wanted)) {
      found.push({ itemId, kind: 'price', site: site.regularPrice || null, program: wanted });
    }
  }
  if (found.length === 0) return { differences: [], differencesTotal: 0 };
  const shown = found.slice(0, WC_LIST_LIMIT);
  const named = await executor.select({ id: items.id, code: items.code, name: items.name }).from(items)
    .where(inArray(items.id, [...new Set(shown.map(f => f.itemId))]));
  const byId = new Map(named.map(r => [r.id, r]));
  const differences = shown
    .map(f => ({ ...f, code: byId.get(f.itemId)?.code ?? '', name: byId.get(f.itemId)?.name ?? '' }))
    .sort((a, b) => a.code.localeCompare(b.code) || a.kind.localeCompare(b.kind));
  return { differences, differencesTotal: found.length };
}
