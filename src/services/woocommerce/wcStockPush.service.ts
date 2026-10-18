import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { chunked, siteStockQuantity, WC_LIST_LIMIT } from '../../lib/woocommerce/wcCatalog.js';
import { shopSellableStocks } from './shopWarehouse.js';
import { requireWcConnection, wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import {
  actorUserId, hasLiveLinks, liveLinks, refreshCatalogLocked, withWcSyncLock, type WcActor, type WcRefreshSummary,
} from './wcCatalog.service.js';

/**
 * 10.2 package 6 (D-04 part A, OBS-R2-83): stock goes to the shop through the item links, in `products/batch` requests of
 * at most 100 products (and `products/<id>/variations/batch` for variations), instead of a SKU search and a write per
 * item. The number sent is the item's sellable stock in the shop warehouse (`shopSellableStocks`, TD-293), floored to a
 * whole number. Each product's answer is kept on its link: a success records the stock the shop now holds, a failure its
 * message; one failed request fails only its own batch.
 */
type Link = Awaited<ReturnType<typeof liveLinks>>[number];

export interface WcStockPushResult {
  totalItems: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
}

interface BatchAnswerRow { id?: unknown; error?: { message?: unknown } }

interface Outcome { link: Link; quantity: number; error: string }

function answerRows(answer: unknown): BatchAnswerRow[] {
  const rows = (answer as { update?: unknown } | null)?.update;
  return Array.isArray(rows) ? rows as BatchAnswerRow[] : [];
}

async function pushBatch(conn: WcConnection, path: string, rows: Array<{ link: Link; id: number; quantity: number }>): Promise<Outcome[]> {
  try {
    const answer = await wcRequest(conn, 'POST', path, {
      update: rows.map(r => ({ id: r.id, manage_stock: true, stock_quantity: r.quantity })),
    });
    const byId = new Map(answerRows(answer).map(a => [Number(a.id), a]));
    return rows.map(r => {
      const a = byId.get(r.id);
      if (!a) return { link: r.link, quantity: r.quantity, error: 'سایت پاسخی برای این محصول نداد.' };
      const message = a.error ? String(a.error.message ?? 'خطای سایت').slice(0, 300) : '';
      return { link: r.link, quantity: r.quantity, error: message };
    });
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : 'ارتباط با سایت ناموفق بود.';
    return rows.map(r => ({ link: r.link, quantity: r.quantity, error: message.slice(0, 300) }));
  }
}

/** Sends the stock of these links in batches; returns each link's outcome */
export async function sendStocks(conn: WcConnection, wanted: Array<{ link: Link; quantity: number }>): Promise<Outcome[]> {
  const simple = wanted.filter(w => w.link.wcVariationId === 0).map(w => ({ ...w, id: w.link.wcProductId }));
  const byParent = new Map<number, Array<{ link: Link; quantity: number; id: number }>>();
  for (const w of wanted.filter(x => x.link.wcVariationId > 0)) {
    byParent.set(w.link.wcProductId, [...(byParent.get(w.link.wcProductId) ?? []), { ...w, id: w.link.wcVariationId }]);
  }
  const outcomes: Outcome[] = [];
  for (const rows of chunked(simple)) outcomes.push(...await pushBatch(conn, 'products/batch', rows));
  for (const [parent, rows] of byParent) {
    for (const part of chunked(rows)) outcomes.push(...await pushBatch(conn, `products/${parent}/variations/batch`, part));
  }
  return outcomes;
}

/** The whole-number stock each linked item should show in the shop */
export async function wantedSiteStocks(links: Link[]): Promise<Map<number, number>> {
  const itemIds = [...new Set(links.map(l => l.itemId))];
  const { sellable } = await shopSellableStocks(orm, itemIds);
  return new Map(itemIds.map(id => [id, siteStockQuantity(sellable.get(id) ?? 0)]));
}

/** Records the outcomes on the links, the run row and one audit row (counts only), in one transaction */
async function recordOutcomes(outcomes: Outcome[], skippedCount: number, totalItems: number, actor: WcActor, trigger: string): Promise<WcStockPushResult> {
  const now = systemNowUtcIso();
  const failed = outcomes.filter(o => o.error);
  const errors = failed.map(o => `${o.link.siteSku || `#${o.link.wcProductId}`}: ${o.error}`);
  const result: WcStockPushResult = {
    totalItems, syncedCount: outcomes.length - failed.length, failedCount: failed.length, skippedCount, errors: errors.slice(0, WC_LIST_LIMIT),
  };
  await orm.transaction(async (tx) => {
    for (const o of outcomes) {
      await tx.update(wcProductLinks).set(o.error
        ? { lastError: o.error, failureCount: sql`${wcProductLinks.failureCount} + 1`, updatedAt: now }
        : { siteStock: o.quantity, siteManageStock: 1, lastPushedAt: now, lastError: '', failureCount: 0, updatedAt: now })
        .where(eq(wcProductLinks.id, o.link.id));
    }
    const status = failed.length === 0 ? 'ok' : failed.length === outcomes.length ? 'failed' : 'partial';
    await tx.insert(wcSyncRuns).values({
      kind: 'stock_push', status, userId: actorUserId(actor), startedAt: now, finishedAt: now,
      summary: { trigger, totalItems, syncedCount: result.syncedCount, failedCount: result.failedCount, skippedCount, errors: errors.slice(0, 20) },
    });
    await logActivity({
      tx, req: actor.req, action: 'WC_STOCK_PUSH', entity: 'فروشگاه اینترنتی', entityId: '',
      description: `ارسال موجودی به سایت: ${result.syncedCount} محصول به‌روز شد، ${result.failedCount} ناموفق`,
      details: { trigger, totalItems, syncedCount: result.syncedCount, failedCount: result.failedCount, skippedCount },
    });
  });
  return result;
}

export interface PushOptions {
  itemIds?: number[];
  /** leave out links whose shop stock already equals the wanted stock */
  onlyChanged?: boolean;
  trigger: 'all' | 'item' | 'auto';
}

/** The push itself, for a caller that holds the `WOOCOMMERCE_SYNC` lock */
export async function pushStocksLocked(actor: WcActor, options: PushOptions, conn?: WcConnection): Promise<WcStockPushResult> {
  const connection = conn ?? await requireWcConnection();
  const links = await liveLinks(options.itemIds);
  const wanted = await wantedSiteStocks(links);
  const rows = links.map(link => ({ link, quantity: wanted.get(link.itemId) ?? 0 }));
  const toSend = options.onlyChanged ? rows.filter(r => !(r.link.siteManageStock === 1 && r.link.siteStock === r.quantity)) : rows;
  if (toSend.length === 0) return { totalItems: links.length, syncedCount: 0, failedCount: 0, skippedCount: links.length, errors: [] };
  const outcomes = await sendStocks(connection, toSend);
  return recordOutcomes(outcomes, links.length - toSend.length, links.length, actor, options.trigger);
}


export const WC_ITEM_NOT_LINKED = 'WC_ITEM_NOT_LINKED';

export interface WcPushAllResult extends WcStockPushResult {
  /** the catalog refresh run first because no item was linked yet */
  refreshed?: WcRefreshSummary;
}

/** «ارسال موجودی همه کالاها»: every linked item, after a first catalog refresh when nothing is linked yet */
export function pushAllStocks(actor: WcActor): Promise<WcPushAllResult> {
  return withWcSyncLock(async () => {
    const conn = await requireWcConnection();
    const refreshed = (await hasLiveLinks()) ? undefined : await refreshCatalogLocked(actor, conn);
    const result = await pushStocksLocked(actor, { trigger: 'all' }, conn);
    return refreshed ? { ...result, refreshed } : result;
  });
}

/** One item's stock (the items page): through its link; 422 `WC_ITEM_NOT_LINKED` when the shop has no product for it */
export function pushItemStock(actor: WcActor, itemId: number): Promise<{ sku: string; quantity: number }> {
  return withWcSyncLock(async () => {
    const [item] = await orm.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));
    if (!item) throw new NotFoundError('کالای مورد نظر در سامانه پیدا نشد.');
    if (!String(item.code ?? '').trim()) throw new ValidationError('کالا کد (SKU) ندارد و به سایت فرستاده نمی‌شود.', undefined, WC_ITEM_NOT_LINKED);
    const conn = await requireWcConnection();
    let [link] = await liveLinks([itemId]);
    if (!link) {
      // a product made on the site since the last refresh: read the catalog once before giving up
      await refreshCatalogLocked(actor, conn);
      [link] = await liveLinks([itemId]);
    }
    if (!link) {
      throw new ValidationError(
        `محصولی با شناسه «${item.code}» در سایت نیست یا به کالای دیگری وصل است؛ فهرست «محصولات سایت بی کالای متناظر» را در «تنظیمات ← ووکامرس» ببینید.`,
        undefined, WC_ITEM_NOT_LINKED,
      );
    }
    const result = await pushStocksLocked(actor, { itemIds: [itemId], trigger: 'item' }, conn);
    if (result.failedCount > 0) throw new ValidationError(`موجودی به سایت نرسید: ${result.errors[0] ?? ''}`, undefined, WC_SHOP_REQUEST_FAILED);
    const [after] = await liveLinks([itemId]);
    return { sku: after?.siteSku || String(item.code), quantity: Number(after?.siteStock ?? 0) };
  });
}
