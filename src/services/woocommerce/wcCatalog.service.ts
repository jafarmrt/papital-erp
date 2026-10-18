import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { orm } from '../../db/drizzle.js';
import { items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import {
  WC_BATCH_SIZE, WC_LIST_LIMIT, WC_MAX_CATALOG_PAGES,
  type WcCatalogItem, type WcCatalogReport, type WcRunView, type WcUnmatchedProduct,
} from '../../lib/woocommerce/wcCatalog.js';
import { resolveItemsByCode } from '../items/itemCodeChange.js';
import { requireWcConnection, wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';

/**
 * 10.2 package 6 (D-04 part A): «بازخوانی محصولات سایت». The shop's catalog is read page by page (products, then the
 * variations of each variable product), each SKU finds its item the way an order line does (`resolveItemsByCode`), and
 * `wc_product_links` is brought to that picture in one transaction: a link that still matches keeps its row, one that no
 * longer does is closed, a new match gets a new row. A SKU two shop products share, or an item two products reach, gets no
 * link, so stock never goes to the wrong product. Shop requests run outside any transaction, under the session advisory
 * lock `WOOCOMMERCE_SYNC` (one exchange with the shop at a time).
 */
export const WC_SYNC_BUSY = 'WC_SYNC_BUSY';
export const WC_CATALOG_AUDIT_ENTITY = 'فروشگاه اینترنتی';

export interface WcActor {
  req?: Request;
  userId?: number;
}

interface SiteProduct {
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  stock: number | null;
  manageStock: boolean;
}

interface RawProduct {
  id?: unknown;
  name?: unknown;
  sku?: unknown;
  type?: unknown;
  stock_quantity?: unknown;
  manage_stock?: unknown;
}

function asRows(answer: unknown): RawProduct[] {
  if (!Array.isArray(answer)) {
    throw new ValidationError('پاسخ سایت فهرست محصولات نبود؛ نشانی سایت و افزونه ووکامرس را بررسی کنید.', undefined, WC_SHOP_REQUEST_FAILED);
  }
  return answer as RawProduct[];
}

function stockOf(raw: RawProduct): number | null {
  const n = Number(raw.stock_quantity);
  return raw.stock_quantity === null || raw.stock_quantity === undefined || !Number.isFinite(n) ? null : Math.trunc(n);
}

async function readPages(conn: WcConnection, path: string, fields: string): Promise<RawProduct[]> {
  const rows: RawProduct[] = [];
  for (let page = 1; page <= WC_MAX_CATALOG_PAGES; page++) {
    const batch = asRows(await wcRequest(conn, 'GET', path, null, { per_page: WC_BATCH_SIZE, page, status: 'any', _fields: fields }));
    rows.push(...batch);
    if (batch.length < WC_BATCH_SIZE) break;
  }
  return rows;
}

/** Every product of the shop, and every variation with its own SKU (one that inherits its parent's SKU is the parent) */
export async function readSiteCatalog(conn: WcConnection): Promise<SiteProduct[]> {
  const products = await readPages(conn, 'products', 'id,name,sku,type,stock_quantity,manage_stock');
  const site: SiteProduct[] = [];
  for (const p of products) {
    const productId = Number(p.id);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    const name = String(p.name ?? '');
    const sku = String(p.sku ?? '').trim();
    site.push({ productId, variationId: 0, name, sku, stock: stockOf(p), manageStock: p.manage_stock === true });
    if (p.type !== 'variable') continue;
    const variations = await readPages(conn, `products/${productId}/variations`, 'id,sku,stock_quantity,manage_stock');
    for (const v of variations) {
      const variationId = Number(v.id);
      const vSku = String(v.sku ?? '').trim();
      if (!Number.isInteger(variationId) || variationId <= 0 || (vSku !== '' && vSku === sku)) continue;
      // «parent» means the variation's stock is held by the parent product
      site.push({ productId, variationId, name, sku: vSku, stock: stockOf(v), manageStock: v.manage_stock === true });
    }
  }
  return site;
}

interface Match { site: SiteProduct; itemId: number }

/** Which shop product each item gets, and why the others get none */
export async function matchSiteCatalog(site: SiteProduct[]): Promise<{ matches: Match[]; unmatched: WcUnmatchedProduct[] }> {
  const unmatched: WcUnmatchedProduct[] = [];
  const note = (p: SiteProduct, reason: WcUnmatchedProduct['reason']) =>
    unmatched.push({ productId: p.productId, variationId: p.variationId, name: p.name, sku: p.sku, reason });
  const bySku = new Map<string, SiteProduct[]>();
  for (const p of site) {
    if (!p.sku) { note(p, 'no_sku'); continue; }
    bySku.set(p.sku, [...(bySku.get(p.sku) ?? []), p]);
  }
  const resolved = await resolveItemsByCode(orm, [...bySku.keys()]);
  const byItem = new Map<number, Array<{ site: SiteProduct; current: boolean }>>();
  for (const [sku, products] of bySku) {
    if (products.length > 1) { products.forEach(p => note(p, 'duplicate_sku')); continue; }
    const hit = resolved.get(sku);
    if (!hit) { note(products[0], 'unknown_sku'); continue; }
    byItem.set(hit.itemId, [...(byItem.get(hit.itemId) ?? []), { site: products[0], current: !hit.oldCode }]);
  }
  const matches: Match[] = [];
  for (const [itemId, candidates] of byItem) {
    // the product with the item's current code wins over one still holding an earlier code
    const current = candidates.filter(c => c.current);
    const winner = candidates.length === 1 ? candidates[0] : current.length === 1 ? current[0] : null;
    for (const c of candidates) {
      if (c === winner) matches.push({ site: c.site, itemId });
      else note(c.site, 'item_taken');
    }
  }
  return { matches, unmatched };
}

const keyOf = (productId: number, variationId: number) => `${productId}:${variationId}`;

export interface WcRefreshSummary {
  siteProductCount: number;
  linkedCount: number;
  newCount: number;
  closedCount: number;
  unmatchedTotal: number;
  unmatched: WcUnmatchedProduct[];
}

/** Writes the links of one catalog reading (one transaction) and the run row and audit row with it */
export async function applyCatalogLinks(site: SiteProduct[], actor: WcActor): Promise<WcRefreshSummary> {
  const { matches, unmatched } = await matchSiteCatalog(site);
  const wanted = new Map(matches.map(m => [keyOf(m.site.productId, m.site.variationId), m]));
  return orm.transaction(async (tx) => {
    const live = await tx.select().from(wcProductLinks).where(eq(wcProductLinks.isDeleted, 0))
      .orderBy(asc(wcProductLinks.id)).for('update');
    const now = systemNowUtcIso();
    const kept = new Set<string>();
    let closedCount = 0;
    for (const link of live) {
      const key = keyOf(link.wcProductId, link.wcVariationId);
      const match = wanted.get(key);
      if (match && match.itemId === link.itemId && !kept.has(key)) {
        kept.add(key);
        await tx.update(wcProductLinks).set({
          siteSku: match.site.sku, siteStock: match.site.stock, siteManageStock: match.site.manageStock ? 1 : 0,
          lastReadAt: now, updatedAt: now,
        }).where(eq(wcProductLinks.id, link.id));
      } else {
        closedCount++;
        await tx.update(wcProductLinks).set({ isDeleted: 1, updatedAt: now }).where(eq(wcProductLinks.id, link.id));
      }
    }
    const fresh = matches.filter(m => !kept.has(keyOf(m.site.productId, m.site.variationId)));
    if (fresh.length > 0) {
      await tx.insert(wcProductLinks).values(fresh.map(m => ({
        itemId: m.itemId, wcProductId: m.site.productId, wcVariationId: m.site.variationId, siteSku: m.site.sku,
        siteStock: m.site.stock, siteManageStock: m.site.manageStock ? 1 : 0, lastReadAt: now, createdAt: now, updatedAt: now,
      })));
    }
    const summary: WcRefreshSummary = {
      siteProductCount: site.length,
      linkedCount: matches.length,
      newCount: fresh.length,
      closedCount,
      unmatchedTotal: unmatched.length,
      unmatched: unmatched.slice(0, WC_LIST_LIMIT),
    };
    await tx.insert(wcSyncRuns).values({
      kind: 'refresh', status: 'ok', userId: actorUserId(actor), startedAt: now, finishedAt: now, summary,
    });
    await logActivity({
      tx, req: actor.req, action: 'WC_CATALOG_REFRESH', entity: WC_CATALOG_AUDIT_ENTITY, entityId: '',
      description: `بازخوانی محصولات سایت: ${matches.length} کالا وصل، ${unmatched.length} محصول سایت بی کالا`,
      details: { siteProductCount: site.length, linkedCount: matches.length, newCount: fresh.length, closedCount, unmatchedTotal: unmatched.length },
    });
    return summary;
  });
}

export function actorUserId(actor: WcActor): number | undefined {
  if (actor.userId) return actor.userId;
  const id = Number((actor.req?.user as { id?: unknown } | undefined)?.id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** A failed exchange with the shop stays visible in the tab */
export async function recordFailedRun(kind: 'refresh' | 'stock_push', actor: WcActor, err: unknown): Promise<void> {
  const message = err instanceof ValidationError ? err.message : 'ارتباط با سایت ناموفق بود.';
  await orm.insert(wcSyncRuns).values({
    kind, status: 'failed', userId: actorUserId(actor), finishedAt: systemNowUtcIso(), errorMessage: message.slice(0, 1000),
  });
}

/** Runs `fn` as the only exchange with the shop; another one at the same time is 409 `WC_SYNC_BUSY` */
export async function withWcSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WOOCOMMERCE_SYNC, fn);
  if (!outcome.acquired) throw new ConflictError('همگام‌سازی دیگری با سایت در جریان است؛ کمی بعد دوباره بزنید.', undefined, WC_SYNC_BUSY);
  return outcome.result;
}

/** The refresh itself, for a caller that already holds the lock */
export async function refreshCatalogLocked(actor: WcActor, conn?: WcConnection): Promise<WcRefreshSummary> {
  const connection = conn ?? await requireWcConnection();
  try {
    return await applyCatalogLinks(await readSiteCatalog(connection), actor);
  } catch (err) {
    if (err instanceof ValidationError && err.code === WC_SHOP_REQUEST_FAILED) await recordFailedRun('refresh', actor, err);
    throw err;
  }
}

export function refreshWcCatalog(actor: WcActor): Promise<WcRefreshSummary> {
  return withWcSyncLock(() => refreshCatalogLocked(actor));
}

export async function hasLiveLinks(): Promise<boolean> {
  const [row] = await orm.select({ id: wcProductLinks.id }).from(wcProductLinks).where(eq(wcProductLinks.isDeleted, 0)).limit(1);
  return Boolean(row);
}

async function lastRun(kind: 'refresh' | 'stock_push'): Promise<WcRunView | null> {
  const [run] = await orm.select().from(wcSyncRuns).where(eq(wcSyncRuns.kind, kind)).orderBy(desc(wcSyncRuns.id)).limit(1);
  if (!run) return null;
  return {
    at: serverTimestampToUtcIso(run.finishedAt ?? run.startedAt),
    status: run.status as WcRunView['status'],
    error: run.errorMessage,
    summary: (run.summary ?? {}) as Record<string, unknown>,
  };
}

/** What the WooCommerce tab shows about the links (`GET /woocommerce/catalog`) */
export async function getWcCatalogReport(): Promise<WcCatalogReport> {
  const [lastRefresh, lastPush] = await Promise.all([lastRun('refresh'), lastRun('stock_push')]);
  const [{ linked }] = await orm.select({ linked: sql<number>`count(*)::int` }).from(wcProductLinks).where(eq(wcProductLinks.isDeleted, 0));
  const [{ refreshed }] = await orm.select({ refreshed: sql<number>`count(*)::int` }).from(wcSyncRuns)
    .where(and(eq(wcSyncRuns.kind, 'refresh'), ne(wcSyncRuns.status, 'failed')));

  const failingWhere = and(eq(wcProductLinks.isDeleted, 0), ne(wcProductLinks.lastError, ''));
  const failingRows = await orm.select({ itemId: items.id, code: items.code, name: items.name, error: wcProductLinks.lastError })
    .from(wcProductLinks).innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(failingWhere).orderBy(asc(items.code)).limit(WC_LIST_LIMIT);
  const [{ failingTotal }] = await orm.select({ failingTotal: sql<number>`count(*)::int` }).from(wcProductLinks).where(failingWhere);

  let itemsNotOnSite: WcCatalogItem[] = [];
  let itemsNotOnSiteTotal = 0;
  if (refreshed > 0) {
    const notLinked = and(
      eq(items.isDeleted, 0), eq(items.type, 'product'), sql`btrim(coalesce(${items.code}, '')) <> ''`, isNull(wcProductLinks.id),
    );
    const base = orm.select({ itemId: items.id, code: items.code, name: items.name }).from(items)
      .leftJoin(wcProductLinks, and(eq(wcProductLinks.itemId, items.id), eq(wcProductLinks.isDeleted, 0)));
    itemsNotOnSite = (await base.where(notLinked).orderBy(asc(items.code)).limit(WC_LIST_LIMIT))
      .map(r => ({ itemId: r.itemId, code: r.code ?? '', name: r.name ?? '' }));
    const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(items)
      .leftJoin(wcProductLinks, and(eq(wcProductLinks.itemId, items.id), eq(wcProductLinks.isDeleted, 0))).where(notLinked);
    itemsNotOnSiteTotal = total;
  }

  const unmatched = Array.isArray(lastRefresh?.summary.unmatched) && lastRefresh?.status !== 'failed'
    ? lastRefresh.summary.unmatched as WcUnmatchedProduct[] : [];
  return {
    refreshed: refreshed > 0,
    linkedCount: linked,
    lastRefresh,
    lastPush,
    unmatched,
    unmatchedTotal: Number(lastRefresh?.status !== 'failed' ? lastRefresh?.summary.unmatchedTotal : 0) || 0,
    itemsNotOnSite,
    itemsNotOnSiteTotal,
    failing: failingRows.map(r => ({ itemId: r.itemId, code: r.code ?? '', name: r.name ?? '', error: r.error })),
    failingTotal,
  };
}

/** The live links of these items (all live links without a list) */
export async function liveLinks(itemIds?: number[]) {
  const where = itemIds ? and(eq(wcProductLinks.isDeleted, 0), inArray(wcProductLinks.itemId, itemIds.length ? itemIds : [-1])) : eq(wcProductLinks.isDeleted, 0);
  return orm.select().from(wcProductLinks).where(where).orderBy(asc(wcProductLinks.id));
}
