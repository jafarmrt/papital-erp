import { formatPersianNumber } from '../../utils/persianNumber';
import type { WcAutoPushView } from './wcAutoPush';
import type { WcShopSyncView } from './wcShopSync';

/**
 * 10.2 package 6 (D-04 part A): the contract of the online shop catalog shared by the server (`wcCatalog.service.ts`,
 * `wcStockPush.service.ts`) and the WooCommerce tab. An item is linked to the shop product (or product variation) whose SKU
 * finds it the way an order line does (`resolveItemsByCode`: the current code, else an earlier code); stock goes to the
 * shop in batches of `WC_BATCH_SIZE` through the links instead of two requests per item (OBS-R2-83).
 */

/** objects in one `products/batch` request (WooCommerce's own limit) and products in one catalog page */
export const WC_BATCH_SIZE = 100;
/** catalog pages read at most (10,000 products), so a shop that keeps answering full pages never loops forever */
export const WC_MAX_CATALOG_PAGES = 100;
/** the most products one catalog refresh reads (`WC_MAX_CATALOG_PAGES` full pages) */
export const WC_MAX_CATALOG_PRODUCTS = WC_BATCH_SIZE * WC_MAX_CATALOG_PAGES;
/** unmatched shop products and items kept in a run and sent to the tab */
export const WC_LIST_LIMIT = 200;
/** one exchange with the shop (a stock push, a refresh before it included) never holds the lock longer than this (review N-A / N-D) */
export const WC_PUSH_DEADLINE_MS = 50_000;
/** a push left less than this after the refresh before it is not started (review N-D) */
export const WC_PUSH_MIN_BUDGET_MS = 5_000;

/** The deadline of a refresh run before a push, `elapsedMs` into the exchange: it leaves the push its minimum budget */
export function refreshBudgetMs(elapsedMs: number): number {
  return Math.max(1_000, WC_PUSH_DEADLINE_MS - WC_PUSH_MIN_BUDGET_MS - Math.max(0, elapsedMs));
}

/** What is left of the exchange for the push, `elapsedMs` into it; null when less than `WC_PUSH_MIN_BUDGET_MS` is left */
export function pushBudgetMs(elapsedMs: number): number | null {
  const left = WC_PUSH_DEADLINE_MS - Math.max(0, elapsedMs);
  return left < WC_PUSH_MIN_BUDGET_MS ? null : left;
}

export type WcUnmatchedReason =
  | 'no_sku' | 'unknown_sku' | 'duplicate_sku' | 'item_taken' | 'item_ambiguous' | 'parent_stock' | 'no_stock_type';

export const WC_UNMATCHED_REASON_LABELS: Record<WcUnmatchedReason, string> = {
  no_sku: 'محصول سایت شناسه محصول (SKU) ندارد',
  unknown_sku: 'هیچ کالایی در برنامه این کد را ندارد',
  duplicate_sku: 'چند محصول سایت همین شناسه را دارند',
  item_taken: 'این کالا به محصول دیگری از سایت وصل شد',
  item_ambiguous: 'چند محصول سایت به همین کالا می‌رسند و هیچ‌کدام وصل نشد',
  parent_stock: 'موجودی این گونه را محصول مادر نگه می‌دارد؛ وصل نشد تا شیوه موجودی سایت عوض نشود',
  no_stock_type: 'محصول خارجی یا گروهی است و موجودی ندارد',
};

export interface WcUnmatchedProduct {
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  reason: WcUnmatchedReason;
}

export interface WcRunView {
  at: string | null;
  status: 'ok' | 'partial' | 'failed';
  error: string;
  summary: Record<string, unknown>;
}

export interface WcCatalogItem {
  itemId: number;
  code: string;
  name: string;
  error?: string;
}

export interface WcCatalogReport {
  /** a catalog refresh has run at least once */
  refreshed: boolean;
  linkedCount: number;
  lastRefresh: WcRunView | null;
  lastPush: WcRunView | null;
  unmatched: WcUnmatchedProduct[];
  unmatchedTotal: number;
  /** the last refresh that read the shop stopped at `WC_MAX_CATALOG_PRODUCTS` (review N-2) */
  catalogTruncated: boolean;
  /** the shop did not list the last refresh's products in id order, so links of products it did not read were kept (review M-C) */
  catalogUnordered: boolean;
  /** v11 phase 6.5: the shop's count of products changed while the last refresh read it, so unread links were kept */
  catalogShifted: boolean;
  /** PR #420 review finding 1: products the shop counted but did not list in the last reading, whose unread links were kept */
  catalogMissing: number;
  /** #322 review note 3: variable products whose variation list the last refresh read in part */
  partialVariationProducts: number;
  /** finished products with a code and no live link (only after a refresh) */
  itemsNotOnSite: WcCatalogItem[];
  itemsNotOnSiteTotal: number;
  /** links whose last push failed */
  failing: WcCatalogItem[];
  failingTotal: number;
  /** part B: the automatic push (`GET /woocommerce/catalog` adds it) */
  autoPush?: WcAutoPushView;
  /** part C: the price push, the SKU rename and the nightly re-read */
  shopSync?: WcShopSyncView;
}

/** The stock the shop takes: WooCommerce holds whole numbers, so a fractional stock is floored and never below zero */
export function siteStockQuantity(sellable: number): number {
  return Number.isFinite(sellable) && sellable > 0 ? Math.floor(sellable + 1e-9) : 0;
}

export function chunked<T>(rows: readonly T[], size = WC_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The one-line Persian result of a catalog refresh for a toast */
/**
 * A manual stock push sets `manage_stock: true` like the earlier per-item push, so a product whose stock tracking was off on
 * the site has it on afterwards; the push result says how many (coordinator decision on part A, never silent)
 */
export function trackingEnabledNote(count: unknown): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n > 0 ? ` ردیابی موجودی ${formatPersianNumber(n)} محصول در سایت روشن شد.` : '';
}

/** Shown on the panel while the last reading of the shop stopped at the product cap (review N-2) */
export function catalogCapNotice(): string {
  return `بازخوانی سایت به سقف ${formatPersianNumber(WC_MAX_CATALOG_PRODUCTS)} محصول رسید؛ محصولات پس از آن خوانده نشد و پیوند آن‌ها دست نخورد.`;
}

/**
 * Shown while the last reading may have missed a product (it showed a product twice, or came out of id order and stopped at
 * the cap; review M-C / N-1 / M-R / M-S)
 */
export function catalogOrderNotice(): string {
  return 'ممکن است در بازخوانی سایت محصولی خوانده نشده باشد؛ پیوند محصولاتی که خوانده نشد دست نخورد. اگر این پیام تکرار شد، افزونه‌ها، دسترسی کلید سایت یا تنظیمات مرتب‌سازی آن را بررسی کنید.';
}

/** v11 phase 6.5 (#322 review notes 1 and 4): the shop's count of products changed while it was read */
export function catalogShiftNotice(): string {
  return 'تعداد محصولات سایت هنگام بازخوانی تغییر کرد و ممکن است محصولی خوانده نشده باشد؛ پیوند محصولاتی که خوانده نشد دست نخورد. کمی بعد دوباره بازخوانی کنید.';
}

/**
 * PR #420 review finding 1: the shop counted products it did not list (the nightly re-read or the stock push kept their
 * links; a refresh by hand asks before closing them)
 */
export function catalogMissingNotice(count: unknown): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n > 0
    ? `سایت ${formatPersianNumber(n)} محصول را در شمار محصولاتش آورد ولی در فهرست نشان نداد؛ پیوند محصولاتی که خوانده نشد دست نخورد. «بازخوانی محصولات سایت» را بزنید تا بستن آن‌ها پرسیده شود.`
    : '';
}

/** #322 review note 3: some variation lists were read in part */
export function partialVariationsNotice(count: unknown): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n > 0 ? `گونه‌های ${formatPersianNumber(n)} محصول متغیر کامل خوانده نشد؛ پیوند گونه‌هایی از آن‌ها که خوانده نشد دست نخورد.` : '';
}

/** #322 review note 2: what the refresh asks before closing most links at once */
export function massCloseConfirmText(details: unknown): string {
  const d = (details ?? {}) as { closedCount?: unknown; liveCount?: unknown; missingCount?: unknown };
  const n = (v: unknown) => formatPersianNumber(Math.max(0, Math.floor(Number(v) || 0)));
  const missing = Math.max(0, Math.floor(Number(d.missingCount) || 0));
  return `سایت برای ${n(d.closedCount)} کالا از ${n(d.liveCount)} کالای وصل محصولی با همان کد نشان نداد. `
    + (missing > 0 ? `سایت ${n(missing)} محصول را در شمار محصولاتش آورد ولی در فهرست نشان نداد. ` : '')
    + 'اگر ادامه دهید پیوند این کالاها بسته می‌شود و موجودی و قیمت آن‌ها دیگر به سایت نمی‌رود. '
    + 'اگر این محصولات را در سایت برنداشته‌اید، انصراف دهید و نشانی سایت و افزونه‌های آن را بررسی کنید.';
}

/** The number of closings the user confirmed, from the details of the question (`closedCount`) */
export function massCloseCount(details: unknown): number {
  return Math.max(0, Math.floor(Number((details as { closedCount?: unknown } | null | undefined)?.closedCount) || 0));
}

export function catalogRefreshMessage(summary: {
  siteProductCount?: unknown; linkedCount?: unknown; unmatchedTotal?: unknown; catalogTruncated?: unknown; catalogUnordered?: unknown;
  catalogShifted?: unknown; catalogMissing?: unknown; partialVariationProducts?: unknown;
}): string {
  const n = (v: unknown) => formatPersianNumber(Math.max(0, Math.floor(Number(v) || 0)));
  const unmatched = Number(summary.unmatchedTotal) || 0;
  return `${n(summary.siteProductCount)} محصول سایت خوانده شد و ${n(summary.linkedCount)} کالا به محصول سایت وصل است.`
    + (unmatched > 0 ? ` ${n(unmatched)} محصول سایت به هیچ کالایی وصل نشد؛ فهرست آن پایین‌تر است.` : '')
    + (summary.catalogTruncated === true ? ` ${catalogCapNotice()}` : '')
    + (summary.catalogUnordered === true ? ` ${catalogOrderNotice()}` : '')
    + (summary.catalogShifted === true ? ` ${catalogShiftNotice()}` : '')
    + (catalogMissingNotice(summary.catalogMissing) ? ` ${catalogMissingNotice(summary.catalogMissing)}` : '')
    + (partialVariationsNotice(summary.partialVariationProducts) ? ` ${partialVariationsNotice(summary.partialVariationProducts)}` : '');
}
