import type { WcCatalogItem, WcRunView } from './wcCatalog';

/**
 * 10.2 package 6 (D-04 part B): the automatic stock push, shared by the server (`wcAutoPush.service.ts`) and the WooCommerce
 * tab. Once a minute, while «ارسال خودکار» is on (off by default), the stock of each linked product whose sellable stock
 * changed goes to the shop, less what the shop's open orders hold. Only products whose stock tracking is already on in the
 * shop are pushed; stock tracking is never turned on automatically, and the others are listed in the tab.
 */
export const WC_AUTO_PUSH_SETTING_KEY = 'wc_auto_push';
/** one automatic run a minute (plan question ق۴) */
export const WC_AUTO_PUSH_INTERVAL_MS = 60_000;
/** a link whose pushes failed this many times in a row stops being pushed automatically until a manual push succeeds */
export const WC_AUTO_MAX_LINK_FAILURES = 5;
/** the most products one automatic run sends; the rest go on the next run, so a large change never floods the shop */
export const WC_AUTO_PUSH_MAX_PRODUCTS = 500;
/** after this many minutes at most between two automatic attempts once runs keep failing */
export const WC_AUTO_MAX_BACKOFF_MINUTES = 30;

/**
 * Orders the shop has already taken stock for and the program has not (plan question ق۶): on-hold orders and processing
 * orders whose invoice is not in the program yet. Their quantities are kept off the stock sent to the shop. A pending
 * (unpaid) order is left out (review M-1): WooCommerce lowers no stock for it (its checkout hold is the shop's own
 * reserved stock), so keeping it off would leave the shop too low once the order is cancelled.
 */
export const WC_OPEN_ORDER_STATUSES = ['on-hold', 'processing'] as const;
/**
 * pages of open orders read at most (100 orders each); a shop whose first page says it holds more open orders than this
 * (`X-WP-Total`) stops the push at once with nothing sent (review M-6)
 */
export const WC_MAX_ORDER_PAGES = 25;
/**
 * a completed order the program failed to invoice is kept off the shop's stock only while its order log was touched in
 * the last this many days (delta review M-1): an older one was most likely entered by hand and would be counted twice
 */
export const WC_FAILED_ORDER_HOLD_DAYS = 30;
/**
 * The part of a push's deadline the open order reading may take (delta review N-2): all of it but the push's own minimum
 * budget, and never less than half, so a long order list fails the run instead of leaving the push no time to send.
 */
export function orderReadBudgetMs(deadlineMs: number, minPushBudgetMs: number): number {
  return Math.max(Math.floor(deadlineMs / 2), deadlineMs - minPushBudgetMs);
}
/** every link tracked in the shop is compared once an hour, whatever moved (review M-3) */
export const WC_AUTO_FULL_PASS_MS = 60 * 60_000;
/** automatic run rows older than this are removed by the daily operational purge (review c); manual runs stay */
export const WC_AUTO_RUN_RETENTION_DAYS = 30;

/** Minutes to wait after `failedRuns` automatic runs failed in a row: 1, 2, 4 … at most `WC_AUTO_MAX_BACKOFF_MINUTES` */
export function autoPushBackoffMinutes(failedRuns: number): number {
  if (!Number.isFinite(failedRuns) || failedRuns <= 0) return 0;
  return Math.min(2 ** Math.min(failedRuns - 1, 10), WC_AUTO_MAX_BACKOFF_MINUTES);
}

export function isAutoPushOn(value: unknown): boolean {
  return String(value ?? '').trim() === '1';
}

export interface WcAutoPushView {
  enabled: boolean;
  /** the last automatic run that sent something or failed (a run with nothing to send leaves no row); `partial` when the
   * shop refused some products (shown as a warning, never as a success) */
  lastRun: WcRunView | null;
  /** automatic runs that failed in a row, and when the next one may run (UTC, with a Z) */
  failedRuns: number;
  nextAttemptAt: string | null;
  /** linked products whose stock tracking is off in the shop: never pushed automatically */
  untracked: WcCatalogItem[];
  untrackedTotal: number;
  /** links left out of the automatic push after `WC_AUTO_MAX_LINK_FAILURES` failures in a row */
  stopped: WcCatalogItem[];
  stoppedTotal: number;
}

export const AUTO_PUSH_ENABLE_CONFIRM =
  'با روشن شدن ارسال خودکار، هر دقیقه موجودی قابل فروش کالاهای وصل‌شده (منهای سفارش‌های باز سایت) به سایت می‌رود. '
  + 'پیش از روشن کردن، شمارش انبار انجام شده باشد تا عدد درست به سایت برود. فقط محصولاتی که ردیابی موجودی آن‌ها در سایت روشن است به‌روز می‌شوند. روشن شود؟';

/** review M-6: the bulk push card says what changed in v10.2.8 */
export const BULK_PUSH_OPEN_ORDERS_NOTE =
  'از این نسخه، موجودی سفارش‌های باز سایت (در انتظار بررسی و در حال انجامی که هنوز فاکتور نشده) از عدد فرستاده‌شده کم می‌شود؛ '
  + 'اگر سفارش‌های باز سایت خوانده نشود، هیچ موجودی‌ای فرستاده نمی‌شود. '
  + 'سفارش تکمیل‌شده‌ای هم که فاکتورش در برنامه ثبت نشد تا ۳۰ روز کم می‌شود؛ اگر فروش آن را دستی ثبت کرده‌اید، '
  + 'سفارش را از فهرست سفارش‌ها دوباره همگام کنید تا دو بار کم نشود.';
