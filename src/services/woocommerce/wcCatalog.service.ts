import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { AppError, ConflictError, ValidationError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils/formatters.js';
import {
  chunked, WC_BATCH_SIZE, WC_LIST_LIMIT, WC_MAX_CATALOG_PAGES,
  type WcCatalogItem, type WcCatalogReport, type WcRunView, type WcUnmatchedProduct,
} from '../../lib/woocommerce/wcCatalog.js';
import { resolveItemsByCode } from '../items/itemCodeChange.js';
import { requireWcConnection, wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import { updateLinkRows, type LinkRowUpdate } from './wcLinkUpdates.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
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

/** One reading of the shop's catalog */
export interface SiteCatalog {
  /** products and variations that hold their own stock */
  site: SiteProduct[];
  /** products read but never linked, with the reason (a variation whose stock the parent holds, an external product) */
  skipped: WcUnmatchedProduct[];
  /** the shop had more products than one refresh reads (`WC_MAX_CATALOG_PRODUCTS`) */
  truncated: boolean;
  /** the largest product id read; when the reading was truncated, a link of a product above it is left as it is */
  maxProductId: number;
  /**
   * review M-C: a list came in another order than the id order asked for (a shop or plugin that ignores `orderby`), so a
   * product may have been missed between two pages
   */
  unordered: boolean;
  /**
   * review M-R: a list showed one row on two pages; with `unordered` this is a date order without a tie-breaker, which
   * also leaves a row out, so every link of a product not read is then left as it is
   */
  repeated: boolean;
}

/** review M-6: one refresh never holds the lock longer than this (under the 60 s of a reverse proxy) */
export const WC_CATALOG_DEADLINE_MS = 50_000;
/** variation lists read at the same time */
export const WC_VARIATION_READ_CONCURRENCY = 4;
/** product types that hold no stock of their own in WooCommerce */
const NO_STOCK_TYPES = new Set(['external', 'grouped']);

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

interface PagedRows { rows: RawProduct[]; truncated: boolean; unordered: boolean; repeated: boolean }

/**
 * Every page of a list in id order (review H-1: the default date order has no tie-breaker, so a product could be read on
 * two pages and be reported as a duplicate of itself); a row read twice is kept once and marks the list `repeated`
 * (review M-R), and a new id not above every id read before marks it `unordered` (review M-C)
 */
async function readPages(conn: WcConnection, path: string, fields: string, signal?: AbortSignal): Promise<PagedRows> {
  const rows: RawProduct[] = [];
  const seen = new Set<number>();
  let lastId = 0;
  let unordered = false;
  let repeated = false;
  for (let page = 1; page <= WC_MAX_CATALOG_PAGES; page++) {
    const batch = asRows(await wcRequest(conn, 'GET', path, null, {
      per_page: WC_BATCH_SIZE, page, status: 'any', orderby: 'id', order: 'asc', _fields: fields,
    }, { signal }));
    for (const row of batch) {
      const id = Number(row.id);
      if (seen.has(id)) {
        repeated = true;
        continue;
      }
      seen.add(id);
      if (id <= lastId) unordered = true;
      lastId = Math.max(lastId, id);
      rows.push(row);
    }
    if (batch.length < WC_BATCH_SIZE) return { rows, truncated: false, unordered, repeated };
  }
  return { rows, truncated: true, unordered, repeated };
}

/**
 * `fn` over `inputs`, at most `limit` at a time, results in input order; after the first failure no worker starts another
 * input (review M-A: the other workers kept calling the shop after the refresh had answered and released the lock) and
 * `onFailure` runs once, so the caller can abort what is still in flight; the error thrown is the first one that happened
 */
export async function mapLimited<T, R>(
  inputs: T[], limit: number, fn: (input: T) => Promise<R>, onFailure?: () => void,
): Promise<R[]> {
  const out: R[] = new Array(inputs.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && next < inputs.length) {
      const i = next++;
      try {
        out[i] = await fn(inputs[i]);
      } catch (err) {
        if (failed) return;
        failed = true;
        firstError = err;
        onFailure?.();
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  // review M-D: the error that came first, never the abort message of a reader stopped because of it
  if (failed) throw firstError;
  return out;
}

/**
 * Every product of the shop, and every variation with its own SKU (one that inherits its parent's SKU is the parent). A
 * variation whose stock the parent holds (`manage_stock: "parent"`) and an external or grouped product are listed, never
 * linked, so a push never changes how the shop keeps their stock (review M-1 / N-4).
 */
export async function readSiteCatalog(conn: WcConnection, signal?: AbortSignal): Promise<SiteCatalog> {
  const { rows: products, truncated, unordered: productsUnordered, repeated: productsRepeated } =
    await readPages(conn, 'products', 'id,name,sku,type,stock_quantity,manage_stock', signal);
  const site: SiteProduct[] = [];
  const skipped: WcUnmatchedProduct[] = [];
  let maxProductId = 0;
  const variable: Array<{ productId: number; name: string; sku: string }> = [];
  for (const p of products) {
    const productId = Number(p.id);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    maxProductId = Math.max(maxProductId, productId);
    const name = String(p.name ?? '');
    const sku = String(p.sku ?? '').trim();
    if (NO_STOCK_TYPES.has(String(p.type))) {
      skipped.push({ productId, variationId: 0, name, sku, reason: 'no_stock_type' });
      continue;
    }
    site.push({ productId, variationId: 0, name, sku, stock: stockOf(p), manageStock: p.manage_stock === true });
    if (p.type === 'variable') variable.push({ productId, name, sku });
  }
  // review N-G: the first failed variation read aborts the reads still in flight; the deadline aborts them all too
  const readers = new AbortController();
  const stopReaders = () => readers.abort();
  if (signal?.aborted) readers.abort();
  signal?.addEventListener('abort', stopReaders, { once: true });
  let variationLists: PagedRows[];
  try {
    variationLists = await mapLimited(variable, WC_VARIATION_READ_CONCURRENCY,
      v => readPages(conn, `products/${v.productId}/variations`, 'id,sku,stock_quantity,manage_stock', readers.signal), stopReaders);
  } finally {
    signal?.removeEventListener('abort', stopReaders);
  }
  variable.forEach(({ productId, name, sku }, i) => {
    for (const v of variationLists[i].rows) {
      const variationId = Number(v.id);
      const vSku = String(v.sku ?? '').trim();
      if (!Number.isInteger(variationId) || variationId <= 0 || (vSku !== '' && vSku === sku)) continue;
      if (v.manage_stock === 'parent') {
        skipped.push({ productId, variationId, name, sku: vSku, reason: 'parent_stock' });
        continue;
      }
      site.push({ productId, variationId, name, sku: vSku, stock: stockOf(v), manageStock: v.manage_stock === true });
    }
  });
  return {
    site, skipped, truncated, maxProductId,
    unordered: productsUnordered || variationLists.some(l => l.unordered),
    repeated: productsRepeated || variationLists.some(l => l.repeated),
  };
}

interface Match { site: SiteProduct; itemId: number }

/** Which shop product each item gets, and why the others get none; `heldItemIds` are items a link outside this reading keeps */
export async function matchSiteCatalog(
  executor: DbExecutor, site: SiteProduct[], heldItemIds: ReadonlySet<number> = new Set(),
): Promise<{ matches: Match[]; unmatched: WcUnmatchedProduct[] }> {
  const unmatched: WcUnmatchedProduct[] = [];
  const note = (p: SiteProduct, reason: WcUnmatchedProduct['reason']) =>
    unmatched.push({ productId: p.productId, variationId: p.variationId, name: p.name, sku: p.sku, reason });
  const bySku = new Map<string, SiteProduct[]>();
  for (const p of site) {
    if (!p.sku) { note(p, 'no_sku'); continue; }
    bySku.set(p.sku, [...(bySku.get(p.sku) ?? []), p]);
  }
  const resolved = await resolveItemsByCode(executor, [...bySku.keys()]);
  const byItem = new Map<number, Array<{ site: SiteProduct; current: boolean }>>();
  for (const [sku, products] of bySku) {
    if (products.length > 1) { products.forEach(p => note(p, 'duplicate_sku')); continue; }
    const hit = resolved.get(sku);
    if (!hit) { note(products[0], 'unknown_sku'); continue; }
    byItem.set(hit.itemId, [...(byItem.get(hit.itemId) ?? []), { site: products[0], current: !hit.oldCode }]);
  }
  const matches: Match[] = [];
  for (const [itemId, candidates] of byItem) {
    if (heldItemIds.has(itemId)) { candidates.forEach(c => note(c.site, 'item_taken')); continue; }
    // the product with the item's current code wins over one still holding an earlier code
    const current = candidates.filter(c => c.current);
    const winner = candidates.length === 1 ? candidates[0] : current.length === 1 ? current[0] : null;
    for (const c of candidates) {
      if (c === winner) matches.push({ site: c.site, itemId });
      else note(c.site, winner ? 'item_taken' : 'item_ambiguous');
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
  /** the shop had more products than one refresh reads; links of products past the cap were left as they are */
  catalogTruncated: boolean;
  /** the shop ignored the id order; links of products not read were left as they are (review M-C) */
  catalogUnordered: boolean;
}

/** review M-B: the shop answered no product at all while items are linked (a plugin, a cache or a wrong address) */
export const EMPTY_CATALOG_MESSAGE =
  'سایت هیچ محصولی برنگرداند و پیوند کالاها دست نخورد؛ نشانی سایت، کلیدها و افزونه‌های سایت را بررسی کنید و دوباره بزنید.';

/** Writes the links of one catalog reading (one transaction) and the run row and audit row with it */
export async function applyCatalogLinks(catalog: SiteCatalog, actor: WcActor): Promise<WcRefreshSummary> {
  const { site, skipped, truncated, maxProductId, unordered, repeated } = catalog;
  return orm.transaction(async (tx) => {
    const live = await tx.select().from(wcProductLinks).where(eq(wcProductLinks.isDeleted, 0))
      .orderBy(asc(wcProductLinks.id)).for('update');
    if (site.length + skipped.length === 0 && live.length > 0) {
      throw new ValidationError(EMPTY_CATALOG_MESSAGE, undefined, WC_SHOP_REQUEST_FAILED);
    }
    // review H-A: a link of a product past the cap (a truncated reading, an id above every id read) is left as it is, and so
    // is its item; review M-C / N-1 / M-R: a reading out of id order that was cut at the cap or showed a row twice (a date
    // order without a tie-breaker, which also leaves a row out) may have missed any product, so the link of every product
    // not read is left as it is too. Any other reading lists every product, so a link of a product it misses is closed
    const keepUnread = unordered && (truncated || repeated);
    const readKeys = new Set([...site, ...skipped].map(p => keyOf(p.productId, p.variationId)));
    const leftAsIs = (l: { wcProductId: number; wcVariationId: number }) => (truncated && l.wcProductId > maxProductId)
      || (keepUnread && !readKeys.has(keyOf(l.wcProductId, l.wcVariationId)));
    const untouched = live.filter(leftAsIs);
    const { matches, unmatched: notMatched } = await matchSiteCatalog(tx, site, new Set(untouched.map(l => l.itemId)));
    const unmatched = [...skipped, ...notMatched];
    const wanted = new Map(matches.map(m => [keyOf(m.site.productId, m.site.variationId), m]));
    const now = systemNowUtcIso();
    const kept = new Set<string>();
    const updates: LinkRowUpdate[] = [];
    let closedCount = 0;
    for (const link of live) {
      if (leftAsIs(link)) continue;
      const key = keyOf(link.wcProductId, link.wcVariationId);
      const match = wanted.get(key);
      if (match && match.itemId === link.itemId && !kept.has(key)) {
        kept.add(key);
        updates.push({ id: link.id, values: {
          siteSku: match.site.sku, siteStock: match.site.stock, siteManageStock: match.site.manageStock ? 1 : 0, lastReadAt: now,
        } });
      } else {
        closedCount++;
        updates.push({ id: link.id, values: { isDeleted: 1 } });
      }
    }
    await updateLinkRows(tx, updates, now);
    const fresh = matches.filter(m => !kept.has(keyOf(m.site.productId, m.site.variationId)));
    for (const part of chunked(fresh, 500)) {
      await tx.insert(wcProductLinks).values(part.map(m => ({
        itemId: m.itemId, wcProductId: m.site.productId, wcVariationId: m.site.variationId, siteSku: m.site.sku,
        siteStock: m.site.stock, siteManageStock: m.site.manageStock ? 1 : 0, lastReadAt: now, createdAt: now, updatedAt: now,
      })));
    }
    const linkedCount = matches.length + untouched.length;
    const summary: WcRefreshSummary = {
      siteProductCount: site.length + skipped.length,
      linkedCount,
      newCount: fresh.length,
      closedCount,
      unmatchedTotal: unmatched.length,
      unmatched: unmatched.slice(0, WC_LIST_LIMIT),
      catalogTruncated: truncated,
      catalogUnordered: keepUnread,
    };
    await tx.insert(wcSyncRuns).values({
      kind: 'refresh', status: 'ok', userId: actorUserId(actor), startedAt: now, finishedAt: now, summary,
    });
    const n = formatPersianNumber;
    await logActivity({
      tx, req: actor.req, action: 'WC_CATALOG_REFRESH', entity: WC_CATALOG_AUDIT_ENTITY, entityId: '',
      description: `بازخوانی محصولات سایت: ${n(linkedCount)} کالا وصل، ${n(unmatched.length)} محصول سایت بی کالا`,
      details: {
        siteProductCount: summary.siteProductCount, linkedCount, newCount: fresh.length, closedCount,
        unmatchedTotal: unmatched.length, catalogTruncated: truncated, catalogUnordered: keepUnread,
      },
    });
    return summary;
  });
}

export function actorUserId(actor: WcActor): number | undefined {
  if (actor.userId) return actor.userId;
  const id = Number((actor.req?.user as { id?: unknown } | undefined)?.id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** A failed exchange with the shop stays visible in the tab (review N-1: whatever stopped it, a DNS or redirect refusal too) */
export async function recordFailedRun(kind: 'refresh' | 'stock_push', actor: WcActor, err: unknown): Promise<void> {
  const message = err instanceof AppError && err.statusCode < 500 ? err.message : 'ارتباط با سایت ناموفق بود.';
  try {
    await orm.insert(wcSyncRuns).values({
      kind, status: 'failed', userId: actorUserId(actor), finishedAt: systemNowUtcIso(), errorMessage: message.slice(0, 1000),
    });
  } catch (recordErr) {
    logger.warn(`[WooCommerce] failed run not recorded: ${errorMessageOf(recordErr)}`);
  }
}

/** Runs `fn` as the only exchange with the shop; another one at the same time is 409 `WC_SYNC_BUSY` */
export async function withWcSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WOOCOMMERCE_SYNC, fn);
  if (!outcome.acquired) throw new ConflictError('همگام‌سازی دیگری با سایت در جریان است؛ کمی بعد دوباره بزنید.', undefined, WC_SYNC_BUSY);
  return outcome.result;
}

/** The refresh itself, for a caller that already holds the lock */
export async function refreshCatalogLocked(
  actor: WcActor, conn?: WcConnection, options: { deadlineMs?: number } = {},
): Promise<WcRefreshSummary> {
  const connection = conn ?? await requireWcConnection();
  // review M-6: the whole reading has one deadline; past it every open request is aborted and the run is recorded as failed
  const deadlineMs = options.deadlineMs ?? WC_CATALOG_DEADLINE_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  try {
    const catalog = await readSiteCatalog(connection, deadline.signal);
    clearTimeout(timer);
    return await applyCatalogLinks(catalog, actor);
  } catch (err) {
    const failure = deadline.signal.aborted
      ? new ValidationError(
        `بازخوانی محصولات سایت در ${formatPersianNumber(Math.ceil(deadlineMs / 1000))} ثانیه تمام نشد و پیوندها دست نخورد؛ کمی بعد دوباره بزنید.`,
        undefined, WC_SHOP_REQUEST_FAILED,
      )
      : err;
    await recordFailedRun('refresh', actor, failure);
    throw failure;
  } finally {
    clearTimeout(timer);
    // review M-A: no request of this reading outlives it (the lock is released right after)
    deadline.abort();
  }
}

export function refreshWcCatalog(actor: WcActor): Promise<WcRefreshSummary> {
  return withWcSyncLock(() => refreshCatalogLocked(actor));
}

/** review M-2: a link counts only while its item is live; a link of an item deleted in the program is never pushed */
const liveLinkWhere = and(eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0));

export async function hasLiveLinks(): Promise<boolean> {
  const [row] = await orm.select({ id: wcProductLinks.id }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(liveLinkWhere).limit(1);
  return Boolean(row);
}

async function lastRun(kind: 'refresh' | 'stock_push', okOnly = false): Promise<WcRunView | null> {
  const where = okOnly ? and(eq(wcSyncRuns.kind, kind), ne(wcSyncRuns.status, 'failed')) : eq(wcSyncRuns.kind, kind);
  const [run] = await orm.select().from(wcSyncRuns).where(where).orderBy(desc(wcSyncRuns.id)).limit(1);
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
  // review N-5: the unmatched lists come from the last refresh that read the shop, so a failed one never empties them
  const [lastRefresh, lastReading, lastPush] = await Promise.all([lastRun('refresh'), lastRun('refresh', true), lastRun('stock_push')]);
  const [{ linked }] = await orm.select({ linked: sql<number>`count(*)::int` }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(liveLinkWhere);
  const refreshed = lastReading ? 1 : 0;

  const failingWhere = and(liveLinkWhere, ne(wcProductLinks.lastError, ''));
  const failingRows = await orm.select({ itemId: items.id, code: items.code, name: items.name, error: wcProductLinks.lastError })
    .from(wcProductLinks).innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(failingWhere).orderBy(asc(items.code)).limit(WC_LIST_LIMIT);
  const [{ failingTotal }] = await orm.select({ failingTotal: sql<number>`count(*)::int` }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(failingWhere);

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

  const unmatched = Array.isArray(lastReading?.summary.unmatched) ? lastReading.summary.unmatched as WcUnmatchedProduct[] : [];
  return {
    refreshed: refreshed > 0,
    linkedCount: linked,
    lastRefresh,
    lastPush,
    unmatched,
    unmatchedTotal: Number(lastReading?.summary.unmatchedTotal) || 0,
    catalogTruncated: lastReading?.summary.catalogTruncated === true,
    catalogUnordered: lastReading?.summary.catalogUnordered === true,
    itemsNotOnSite,
    itemsNotOnSiteTotal,
    failing: failingRows.map(r => ({ itemId: r.itemId, code: r.code ?? '', name: r.name ?? '', error: r.error })),
    failingTotal,
  };
}

/** The live links of these items (all live links without a list) */
export async function liveLinks(itemIds?: number[]) {
  const where = itemIds ? and(liveLinkWhere, inArray(wcProductLinks.itemId, itemIds.length ? itemIds : [-1])) : liveLinkWhere;
  return orm.select(getTableColumns(wcProductLinks)).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(where).orderBy(asc(wcProductLinks.id));
}
