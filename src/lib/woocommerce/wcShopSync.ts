import { fin } from '../financialDecimal';
import { formatPersianNumber } from '../../utils/persianNumber';
import { formatCurrencyLabel } from '../../utils/formatters';
import { rialUnitMultiplier } from './wcCurrency';
import type { WcCatalogItem, WcRunView } from './wcCatalog';

/**
 * 10.2 package 6 (D-04 part C), shared by the server and the WooCommerce tab. Two more things go to the shop, each behind its
 * own setting, off by default:
 * - «فهرست قیمت فروشگاه» (`wc_price_list`): the active price of that price list goes to each linked product's regular price
 *   (plan questions ق۲ / ق۳: the sale price is never touched), converted to the shop's unit (a rial price for a toman shop is
 *   divided by ten and rounded); a price in another currency than the shop's is not sent and is listed.
 * - «تغییر خودکار کد در سایت» (`wc_sku_rename`): after an item's code changes (D-15), the linked product's SKU in the shop
 *   becomes the new code (card ت۲۹).
 * And once a business day, from `WC_NIGHTLY_HOUR`, while any of the automatic sends is on, the shop's catalog is read again:
 * the links, the shop stock and price, and the differences found are listed here («گزارش همگام‌سازی»).
 */
export const WC_PRICE_LIST_SETTING_KEY = 'wc_price_list';
export const WC_SKU_RENAME_SETTING_KEY = 'wc_sku_rename';
/** the nightly re-read runs from this business hour (a server that was down then runs it later that day) */
export const WC_NIGHTLY_HOUR = 3;
/** attempts of one night's re-read, each at least `WC_NIGHTLY_RETRY_MINUTES` after the last failed one */
export const WC_NIGHTLY_MAX_ATTEMPTS = 3;
export const WC_NIGHTLY_RETRY_MINUTES = 30;
/** the shop currency read from the shop is used this long before it is read again */
export const WC_SITE_CURRENCY_TTL_MS = 6 * 60 * 60_000;

/** the kinds of `wc_sync_runs` rows (migration 0131 added the price and SKU runs) */
export type WcRunKind = 'refresh' | 'stock_push' | 'price_push' | 'sku_push';

export type WcPriceSkipReason = 'no_price' | 'currency_mismatch' | 'not_positive' | 'variable_parent' | 'not_read';

export const WC_PRICE_SKIP_LABELS: Record<WcPriceSkipReason, string> = {
  no_price: 'در فهرست قیمت فروشگاه قیمتی ندارد',
  currency_mismatch: 'ارز قیمت با واحد پول سایت یکی نیست',
  not_positive: 'قیمت در واحد پول سایت به صفر گرد می‌شود',
  variable_parent: 'محصول متغیر است و قیمت روی گونه‌های آن است',
  not_read: 'نوع محصول هنوز از سایت خوانده نشده؛ «بازخوانی محصولات سایت» را بزنید',
};

/** The shop's regular price for a program price, or why it is not sent */
export function sitePriceOf(
  price: string | number | null | undefined, priceCurrency: string | null | undefined, siteCurrency: string,
): { value: string } | { skip: WcPriceSkipReason } {
  const raw = String(price ?? '').trim();
  if (raw === '' || !/^\d+(\.\d+)?$/.test(raw)) return { skip: 'no_price' };
  const own = String(priceCurrency || 'IRR').trim().toUpperCase();
  const site = siteCurrency.trim().toUpperCase();
  const multiplier = rialUnitMultiplier(site);
  let value;
  if (multiplier !== undefined) {
    if (own !== 'IRR') return { skip: 'currency_mismatch' };
    value = fin(raw).divide(multiplier, 0);
  } else {
    if (own !== site) return { skip: 'currency_mismatch' };
    value = fin(raw).round(2);
  }
  if (!value.isPositive()) return { skip: 'not_positive' };
  return { value: value.toString() };
}

/** Whether the shop's regular price (as the shop sends it, '' for none) already is this one */
export function sameSitePrice(site: string | null | undefined, wanted: string): boolean {
  const s = String(site ?? '').trim();
  return /^\d+(\.\d+)?$/.test(s) && fin(s).equals(wanted);
}

export function isSkuRenameOn(value: unknown): boolean {
  return String(value ?? '').trim() === '1';
}

/** The business day (`YYYY-MM-DD`) and hour (0–23) of `now` in the display time zone */
export function businessDayHour(now: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) % 24 };
}

/** One night's attempts so far: whether one succeeded, how many failed and when the last failed one started */
export interface NightlyAttempts { succeeded: boolean; failed: number; lastFailedAt: number | null }

/** Whether the nightly re-read runs now */
export function nightlyDue(hour: number, attempts: NightlyAttempts, nowMs: number): boolean {
  if (hour < WC_NIGHTLY_HOUR || attempts.succeeded || attempts.failed >= WC_NIGHTLY_MAX_ATTEMPTS) return false;
  return attempts.lastFailedAt === null || nowMs - attempts.lastFailedAt >= WC_NIGHTLY_RETRY_MINUTES * 60_000;
}

/** A difference the nightly re-read found between the shop and the program */
export interface WcDriftRow {
  itemId: number;
  code: string;
  name: string;
  kind: 'stock' | 'price';
  /** the shop's number as read */
  site: string | null;
  /** stock: the number the program last sent or read; price: the price the program sends */
  program: string | null;
}

export interface WcPriceSkipRow extends WcCatalogItem { reason: WcPriceSkipReason }

export interface WcFieldPushView {
  enabled: boolean;
  lastRun: WcRunView | null;
  failedRuns: number;
  nextAttemptAt: string | null;
  /** links stopped after `WC_AUTO_MAX_LINK_FAILURES` refusals in a row; the nightly re-read lets them try again */
  stopped: WcCatalogItem[];
  stoppedTotal: number;
}

export interface WcShopSyncView {
  /** the price list whose prices go to the shop ('' = off) and the configured price lists to choose from */
  priceList: string;
  /** the stored price list is no longer one of the configured price lists, so no price is sent */
  priceListMissing: boolean;
  priceLists: string[];
  /** the shop currency last read (null before the first price run) */
  siteCurrency: string | null;
  price: WcFieldPushView & { skipped: WcPriceSkipRow[]; skippedTotal: number };
  sku: WcFieldPushView & { pending: number };
  /** the last nightly re-read and the differences it found */
  lastNightly: WcRunView | null;
  differences: WcDriftRow[];
  differencesTotal: number;
}

export const PRICE_PUSH_ENABLE_CONFIRM = (title: string) =>
  `از این پس هر دقیقه قیمت فهرست «${title}» به «قیمت عادی» محصولات وصل‌شده در سایت فرستاده می‌شود (قیمت حراج سایت دست نمی‌خورد). `
  + 'قیمت ریالی برای سایت تومانی بر ده تقسیم و گرد می‌شود و قیمتی که ارزش با واحد پول سایت یکی نیست فرستاده نمی‌شود. روشن شود؟';

export const SKU_RENAME_ENABLE_CONFIRM =
  'از این پس پس از تغییر کد هر کالا، شناسه محصول (SKU) همان محصول در سایت هم در دقیقه بعد به کد تازه تغییر می‌کند. '
  + 'سفارشی که با کد قدیم برسد همچنان کالا را پیدا می‌کند. روشن شود؟';

const RIAL_UNIT_LABELS: Record<string, string> = { IRR: 'ریال', IRT: 'تومان', TOMAN: 'تومان', IRHR: 'هزار ریال', IRHT: 'هزار تومان' };

/** The shop currency's Persian name (the Persian WooCommerce plugin's rial units, else the currency code's label) */
export function siteCurrencyLabel(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase();
  return RIAL_UNIT_LABELS[c] ?? formatCurrencyLabel(c);
}

/** The one-line result of the last automatic price or SKU run, for the tab */
export function fieldRunText(run: WcRunView | null): string {
  if (!run?.at) return 'هنوز انجام نشده';
  const n = (v: unknown) => formatPersianNumber(Math.max(0, Math.floor(Number(v) || 0)));
  if (run.status === 'failed') return `ناموفق${run.error ? `: ${run.error}` : ''}`;
  const failed = Number(run.summary.failedCount) || 0;
  return `${n(run.summary.syncedCount)} محصول به‌روز شد${failed > 0 ? `، ${n(failed)} محصول را سایت نپذیرفت` : ''}`;
}
