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
  chunked, WC_LIST_LIMIT,
  type WcCatalogItem, type WcCatalogReport, type WcRunView, type WcUnmatchedProduct,
} from '../../lib/woocommerce/wcCatalog.js';
import { resolveItemsByCode } from '../items/itemCodeChange.js';
import { requireWcConnection, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import { updateLinkRows, type LinkRowUpdate } from './wcLinkUpdates.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import type { WcDriftRow, WcRunKind, WcSiteMoney } from '../../lib/woocommerce/wcShopSync.js';
import { catalogDifferences, type KeptLink } from './wcCatalogDrift.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { readSiteCatalog, WC_CATALOG_DEADLINE_MS, type SiteCatalog, type SiteProduct } from './wcCatalogRead.js';

export { mapLimited, readSiteCatalog, WC_CATALOG_DEADLINE_MS, WC_VARIATION_READ_CONCURRENCY } from './wcCatalogRead.js';
export type { SiteCatalog, SiteProduct } from './wcCatalogRead.js';

/**
 * 10.2 package 6 (D-04 part A): «بازخوانی محصولات سایت». The shop's catalog is read page by page (products, then the
 * variations of each variable product), each SKU finds its item the way an order line does (`resolveItemsByCode`), and
 * `wc_product_links` is brought to that picture in one transaction: a link that still matches keeps its row, one that no
 * longer does is closed, a new match gets a new row. A SKU two shop products share, or an item two products reach, gets no
 * link, so stock never goes to the wrong product. Shop requests run outside any transaction, under the session advisory
 * lock `WOOCOMMERCE_SYNC` (one exchange with the shop at a time); the reading itself is `wcCatalogRead.ts`.
 */
export const WC_SYNC_BUSY = 'WC_SYNC_BUSY';
export const WC_CATALOG_AUDIT_ENTITY = 'فروشگاه اینترنتی';

export interface WcActor {
  req?: Request;
  userId?: number;
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
  /** v11 phase 6.5: the shop's count of products changed while it was read; links of products not read were left as they are */
  catalogShifted: boolean;
  /**
   * PR #420 review finding 1: products the shop counted but did not list, whose unread links this reading kept (a refresh
   * by hand asks instead, so it is 0 there)
   */
  catalogMissing: number;
  /** #322 review note 3: variable products whose variation list was read in part; their unread variations kept their links */
  partialVariationProducts: number;
  /** part C: the nightly re-read's trigger, business day and the differences it found between the shop and the program */
  trigger?: 'nightly';
  businessDay?: string;
  /** the shop currency and decimals the nightly prices were compared in (review N-4) */
  siteCurrency?: string;
  siteDecimals?: number;
  differences?: WcDriftRow[];
  differencesTotal?: number;
}

/** part C: how one refresh was started; the nightly re-read writes no audit row and lists the differences it found */
export interface RefreshRun {
  nightly?: { businessDay: string };
  /**
   * #322 review note 2: the user saw that this refresh closes this many links of items left without a product and confirmed
   * it; a reading that would close more asks again (PR #420 review nit 8)
   */
  confirmClose?: number;
  /** a refresh by hand: a gap in the shop's list (`SiteCatalog.missing`) asks before closing a link it did not read */
  askOnGap?: boolean;
  /** the regular price the program sends to each item's product (the shop's unit), when a price list goes to the shop */
  wantedPrices?: ReadonlyMap<number, string>;
  siteMoney?: WcSiteMoney;
}

/** review M-B: the shop answered no product at all while items are linked (a plugin, a cache or a wrong address) */
export const EMPTY_CATALOG_MESSAGE =
  'سایت هیچ محصولی برنگرداند و پیوند کالاها دست نخورد؛ نشانی سایت، کلیدها و افزونه‌های سایت را بررسی کنید و دوباره بزنید.';

/**
 * #322 review note 2: a refresh that would leave at least this many items without a product, and more than half of the
 * items whose links it compared, asks first (PR #420 review finding 3: an item whose product was read with another SKU, as
 * from another shop with the same ids, counts as well as one whose product was not read)
 */
export const WC_MASS_CLOSE_MIN = 5;
export const WC_MASS_CLOSE_CONFIRM = 'WC_MASS_CLOSE_CONFIRM';

export function massCloseMessage(closedCount: number, liveCount: number, missing = 0): string {
  const n = formatPersianNumber;
  return `این بازخوانی پیوند ${n(closedCount)} کالا از ${n(liveCount)} کالای وصل را می‌بست و سایت برای آن‌ها محصولی با همان کد نشان نداد؛ پیوندی بسته نشد. `
    + (missing > 0 ? `سایت ${n(missing)} محصول را در شمار محصولاتش آورد ولی در فهرست نشان نداد. ` : '')
    + 'اگر این محصولات واقعاً از سایت برداشته شده‌اند، در زبانهٔ ووکامرس «بازخوانی محصولات سایت» را بزنید و بستن پیوندها را تأیید کنید؛ وگرنه نشانی سایت و افزونه‌های آن را بررسی کنید.';
}

/** Writes the links of one catalog reading (one transaction) and the run row and audit row with it */
export async function applyCatalogLinks(catalog: SiteCatalog, actor: WcActor, run: RefreshRun = {}): Promise<WcRefreshSummary> {
  const { site, skipped, truncated, maxProductId, unordered, repeated, shifted, missing, partialVariationProducts } = catalog;
  return orm.transaction(async (tx) => {
    const live = await tx.select().from(wcProductLinks).where(eq(wcProductLinks.isDeleted, 0))
      .orderBy(asc(wcProductLinks.id)).for('update');
    if (site.length + skipped.length === 0 && live.length > 0) {
      throw new ValidationError(EMPTY_CATALOG_MESSAGE, undefined, WC_SHOP_REQUEST_FAILED);
    }
    // review H-A: a link of a product past the cap (a truncated reading, an id above every id read) is left as it is, and so
    // is its item; review M-C / N-1 / M-R / M-S: a reading that showed a row twice (an order with ties, such as date or
    // menu order, which also leaves a row out, whether its ids look ascending or not) or that was out of id order and cut at
    // the cap may have missed any product, so the link of every product not read is left as it is too, and so it is when the
    // shop's count moved during the reading (v11 phase 6.5, #322 review notes 1 and 4: a product removed from a page already
    // read moves the next pages up and one product is never shown). Any other reading lists every product, so a link of a
    // product it misses is closed. A variation list read in part keeps the links of its own unread variations (note 3). A
    // gap in the shop's list that did not move (PR #420 review finding 1) keeps them too, unless the user confirmed closing
    // them or this is a refresh by hand, which asks below
    const outOfOrder = repeated || (unordered && truncated);
    const gapKeeps = missing > 0 && run.confirmClose === undefined && !run.askOnGap;
    const keepUnread = outOfOrder || shifted || gapKeeps;
    const partialParents = new Set(partialVariationProducts);
    const readKeys = new Set([...site, ...skipped].map(p => keyOf(p.productId, p.variationId)));
    const leftAsIs = (l: { wcProductId: number; wcVariationId: number }) => (truncated && l.wcProductId > maxProductId)
      || ((keepUnread || (l.wcVariationId > 0 && partialParents.has(l.wcProductId)))
        && !readKeys.has(keyOf(l.wcProductId, l.wcVariationId)));
    const untouched = live.filter(leftAsIs);
    const { matches, unmatched: notMatched } = await matchSiteCatalog(tx, site, new Set(untouched.map(l => l.itemId)));
    const unmatched = [...skipped, ...notMatched];
    const wanted = new Map(matches.map(m => [keyOf(m.site.productId, m.site.variationId), m]));
    const now = systemNowUtcIso();
    const kept = new Set<string>();
    const keptPairs: KeptLink[] = [];
    const updates: LinkRowUpdate[] = [];
    let closedCount = 0;
    const closedLinks: typeof live = [];
    for (const link of live) {
      if (leftAsIs(link)) continue;
      const key = keyOf(link.wcProductId, link.wcVariationId);
      const match = wanted.get(key);
      if (match && match.itemId === link.itemId && !kept.has(key)) {
        kept.add(key);
        keptPairs.push({ link, itemId: link.itemId, site: match.site });
        updates.push({ id: link.id, values: {
          siteSku: match.site.sku, siteStock: match.site.stock, siteManageStock: match.site.manageStock ? 1 : 0, lastReadAt: now,
          siteType: match.site.type, siteRegularPrice: match.site.regularPrice,
        } });
      } else {
        closedCount++;
        closedLinks.push(link);
        updates.push({ id: link.id, values: { isDeleted: 1 } });
      }
    }
    // #322 review note 2: a reading that would leave most linked items without a product at once (a plugin or a cache
    // hiding products, a wrong address) changes nothing until the user confirms it, and so does a refresh by hand whose
    // list had a gap and would close a link it did not read; the nightly re-read and the stock push never confirm
    const relinked = new Set([...matches.map(m => m.itemId), ...untouched.map(l => l.itemId)]);
    const lost = closedLinks.filter(l => !relinked.has(l.itemId));
    const compared = live.length - untouched.length;
    const mass = lost.length >= WC_MASS_CLOSE_MIN && lost.length * 2 > compared;
    const gapCloses = missing > 0 && lost.some(l => !readKeys.has(keyOf(l.wcProductId, l.wcVariationId)));
    if ((mass || gapCloses) && (run.confirmClose === undefined || lost.length > run.confirmClose)) {
      throw new ConflictError(massCloseMessage(lost.length, compared, missing),
        { closedCount: lost.length, liveCount: compared, missingCount: missing }, WC_MASS_CLOSE_CONFIRM);
    }
    await updateLinkRows(tx, updates, now);
    const fresh = matches.filter(m => !kept.has(keyOf(m.site.productId, m.site.variationId)));
    for (const part of chunked(fresh, 500)) {
      await tx.insert(wcProductLinks).values(part.map(m => ({
        itemId: m.itemId, wcProductId: m.site.productId, wcVariationId: m.site.variationId, siteSku: m.site.sku,
        siteStock: m.site.stock, siteManageStock: m.site.manageStock ? 1 : 0, lastReadAt: now, createdAt: now, updatedAt: now,
        siteType: m.site.type, siteRegularPrice: m.site.regularPrice,
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
      catalogUnordered: outOfOrder,
      catalogShifted: shifted,
      catalogMissing: gapKeeps ? missing : 0,
      partialVariationProducts: partialParents.size,
    };
    if (run.nightly) {
      // part C: what the shop holds that the program did not send (a stock or price changed by hand in the shop)
      const freshPairs = fresh.map(m => ({ link: null, itemId: m.itemId, site: m.site }));
      const drift = await catalogDifferences(tx, [...keptPairs, ...freshPairs], run.wantedPrices);
      const money = run.siteMoney ? { siteCurrency: run.siteMoney.currency, siteDecimals: run.siteMoney.decimals } : {};
      Object.assign(summary, { trigger: 'nightly', businessDay: run.nightly.businessDay, ...money, ...drift });
    }
    await tx.insert(wcSyncRuns).values({
      kind: 'refresh', status: 'ok', userId: actorUserId(actor), startedAt: now, finishedAt: now, summary,
    });
    // part C: the nightly re-read is recorded by its run row only, like the automatic push
    if (run.nightly) return summary;
    const n = formatPersianNumber;
    await logActivity({
      tx, req: actor.req, action: 'WC_CATALOG_REFRESH', entity: WC_CATALOG_AUDIT_ENTITY, entityId: '',
      description: `بازخوانی محصولات سایت: ${n(linkedCount)} کالا وصل، ${n(unmatched.length)} محصول سایت بی کالا`,
      details: {
        siteProductCount: summary.siteProductCount, linkedCount, newCount: fresh.length, closedCount,
        unmatchedTotal: unmatched.length, catalogTruncated: truncated, catalogUnordered: outOfOrder, catalogShifted: shifted,
        catalogMissing: missing, partialVariationProducts: partialParents.size,
        ...(run.confirmClose !== undefined ? { confirmClose: run.confirmClose } : {}),
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
export async function recordFailedRun(
  kind: WcRunKind, actor: WcActor, err: unknown, summary?: Record<string, unknown>,
): Promise<void> {
  const message = err instanceof AppError && err.statusCode < 500 ? err.message : 'ارتباط با سایت ناموفق بود.';
  try {
    await orm.insert(wcSyncRuns).values({
      kind, status: 'failed', userId: actorUserId(actor), finishedAt: systemNowUtcIso(), errorMessage: message.slice(0, 1000),
      ...(summary ? { summary } : {}),
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
  actor: WcActor, conn?: WcConnection, options: { deadlineMs?: number; run?: RefreshRun } = {},
): Promise<WcRefreshSummary> {
  const connection = conn ?? await requireWcConnection();
  // review M-6: the whole reading has one deadline; past it every open request is aborted and the run is recorded as failed
  const deadlineMs = options.deadlineMs ?? WC_CATALOG_DEADLINE_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  try {
    const catalog = await readSiteCatalog(connection, deadline.signal);
    clearTimeout(timer);
    return await applyCatalogLinks(catalog, actor, options.run);
  } catch (err) {
    const failure = deadline.signal.aborted
      ? new ValidationError(
        `بازخوانی محصولات سایت در ${formatPersianNumber(Math.ceil(deadlineMs / 1000))} ثانیه تمام نشد و پیوندها دست نخورد؛ کمی بعد دوباره بزنید.`,
        undefined, WC_SHOP_REQUEST_FAILED,
      )
      : err;
    await recordFailedRun('refresh', actor, failure,
      options.run?.nightly ? { trigger: 'nightly', businessDay: options.run.nightly.businessDay } : undefined);
    throw failure;
  } finally {
    clearTimeout(timer);
    // review M-A: no request of this reading outlives it (the lock is released right after)
    deadline.abort();
  }
}

/** «بازخوانی محصولات سایت» by hand: it asks before closing the links of products a gap in the shop's list hid */
export function refreshWcCatalog(actor: WcActor, options: { confirmClose?: number } = {}): Promise<WcRefreshSummary> {
  return withWcSyncLock(() => refreshCatalogLocked(actor, undefined, { run: { askOnGap: true, confirmClose: options.confirmClose } }));
}

/** review M-2: a link counts only while its item is live; a link of an item deleted in the program is never pushed */
const liveLinkWhere = and(eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0));

export async function hasLiveLinks(): Promise<boolean> {
  const [row] = await orm.select({ id: wcProductLinks.id }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(liveLinkWhere).limit(1);
  return Boolean(row);
}

/** part B: the automatic push's runs carry `trigger: 'auto'` in their summary */
export const autoRunCondition = sql`coalesce(${wcSyncRuns.summary}->>'trigger', '') = 'auto'`;

export function runView(run: typeof wcSyncRuns.$inferSelect): WcRunView {
  return {
    at: serverTimestampToUtcIso(run.finishedAt ?? run.startedAt),
    status: run.status as WcRunView['status'],
    error: run.errorMessage,
    summary: (run.summary ?? {}) as Record<string, unknown>,
  };
}

async function lastRun(kind: 'refresh' | 'stock_push', okOnly = false): Promise<WcRunView | null> {
  // «آخرین ارسال موجودی» is the last manual push; the automatic push has its own line (part B)
  const where = and(eq(wcSyncRuns.kind, kind), okOnly ? ne(wcSyncRuns.status, 'failed') : undefined,
    kind === 'stock_push' ? sql`not (${autoRunCondition})` : undefined);
  const [run] = await orm.select().from(wcSyncRuns).where(where).orderBy(desc(wcSyncRuns.id)).limit(1);
  return run ? runView(run) : null;
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
    catalogShifted: lastReading?.summary.catalogShifted === true,
    catalogMissing: Number(lastReading?.summary.catalogMissing) || 0,
    partialVariationProducts: Number(lastReading?.summary.partialVariationProducts) || 0,
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
