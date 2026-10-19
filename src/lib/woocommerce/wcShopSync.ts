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
 *   divided by ten, never rounded); a price in another currency than the shop's is not sent and is listed.
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

export type WcPriceSkipReason = 'no_price' | 'currency_mismatch' | 'not_positive' | 'inexact_unit' | 'variable_parent' | 'not_read';

export const WC_PRICE_SKIP_LABELS: Record<WcPriceSkipReason, string> = {
  no_price: 'در فهرست قیمت فروشگاه قیمتی ندارد',
  currency_mismatch: 'ارز قیمت با واحد پول سایت یکی نیست',
  not_positive: 'قیمت صفر است',
  inexact_unit: 'قیمت در واحد پول سایت با تعداد اعشار سایت دقیق نوشته نمی‌شود',
  variable_parent: 'محصول متغیر است و قیمت روی گونه‌های آن است',
  not_read: 'نوع محصول هنوز از سایت خوانده نشده؛ «بازخوانی محصولات سایت» را بزنید',
};

/** The most decimal places a price is ever sent with, whatever the shop's decimals setting allows */
export const WC_SITE_PRICE_PLACES = 4;

/** The shop's money: its currency (`data/currencies/current`) and the decimals it shows and charges prices with
 * (`woocommerce_price_num_decimals`, review M-A) */
export interface WcSiteMoney { currency: string; decimals: number }

/** The decimal places a price may carry to this shop: its own decimals, at most `WC_SITE_PRICE_PLACES` */
export function sitePricePlaces(shopDecimals: number): number {
  const d = Number.isFinite(shopDecimals) ? Math.floor(shopDecimals) : 0;
  return Math.min(WC_SITE_PRICE_PLACES, Math.max(0, d));
}

/** A price as the shop takes it: plain digits, at most four decimals, never exponent notation (review N-1) */
const SITE_PRICE_TEXT = /^\d+(\.\d{1,4})?$/;

/**
 * The shop's regular price for a program price, or why it is not sent. Nothing is ever rounded (reviews H-1, M-A, M-B): a
 * rial price goes to a rial-unit shop divided by its `rialUnitMultiplier`, another currency only to a shop of that
 * currency, and the result must be exactly the price at the decimals the shop charges with (`sitePricePlaces`), else the
 * product is listed as `inexact_unit` and its shop price is left alone. So 15,000 rials go to a thousand-toman shop with
 * one or more decimals as 1.5 and are not sent to one with none, where the customer would pay 2 thousand tomans.
 */
export function sitePriceOf(
  price: string | number | null | undefined, priceCurrency: string | null | undefined, site: WcSiteMoney,
): { value: string } | { skip: WcPriceSkipReason } {
  const raw = String(price ?? '').trim();
  if (raw === '' || !/^\d+(\.\d+)?$/.test(raw)) return { skip: 'no_price' };
  const own = String(priceCurrency || 'IRR').trim().toUpperCase();
  const currency = site.currency.trim().toUpperCase();
  const multiplier = rialUnitMultiplier(currency);
  if (multiplier !== undefined ? own !== 'IRR' : own !== currency) return { skip: 'currency_mismatch' };
  const unit = multiplier ?? 1;
  const places = sitePricePlaces(site.decimals);
  const value = fin(raw).divide(unit, places);
  if (!value.multiply(unit).equals(raw)) return { skip: 'inexact_unit' };
  if (!value.isPositive()) return { skip: 'not_positive' };
  const text = value.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return SITE_PRICE_TEXT.test(text) ? { value: text } : { skip: 'inexact_unit' };
}

/** A shop product type whose prices are on its variations (`variable`, and extensions such as `variable-subscription`) */
export function isVariableParentType(type: string | null | undefined): boolean {
  const t = String(type ?? '').trim().toLowerCase();
  return t === 'variable' || t.startsWith('variable-');
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
  /** the item's unit, for a stock difference (rows recorded before review N-2 have none) */
  unit?: string;
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
  /** the shop currency and decimals last read (null before the first price run) */
  siteCurrency: string | null;
  siteDecimals: number | null;
  price: WcFieldPushView & { skipped: WcPriceSkipRow[]; skippedTotal: number };
  sku: WcFieldPushView & { pending: number };
  /** the last nightly re-read and the differences it found */
  lastNightly: WcRunView | null;
  /** the shop currency that nightly reading compared prices in (review N-4) */
  differencesCurrency: string | null;
  differences: WcDriftRow[];
  differencesTotal: number;
}

export const PRICE_PUSH_ENABLE_CONFIRM = (title: string) =>
  `از این پس هر دقیقه قیمت فهرست «${title}» به «قیمت عادی» محصولات وصل‌شده در سایت فرستاده می‌شود (قیمت حراج سایت دست نمی‌خورد). `
  + 'قیمت ریالی به واحد پول سایت برده می‌شود و گرد نمی‌شود: قیمتی که با تعداد اعشار سایت دقیق نوشته نشود، یا ارز آن با واحد پول سایت یکی نباشد، فرستاده نمی‌شود. '
  + 'قیمتی که در سایت با دست عوض شود، دوباره با قیمت فهرست جایگزین می‌شود. روشن شود؟';

/** The question before the SKU rename is turned on; `pending` products already carry an earlier code and change at once */
export const SKU_RENAME_ENABLE_CONFIRM = (pending: number) =>
  (pending > 0
    ? `کد ${formatPersianNumber(pending)} محصول در سایت هنوز کد پیشین کالاست و از دقیقه بعد به کد تازه تغییر می‌کند. `
    : '')
  + 'از این پس هم پس از تغییر کد هر کالا، شناسه محصول (SKU) همان محصول در سایت در دقیقه بعد به کد تازه تغییر می‌کند. '
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
