import { ValidationError } from '../../errors/customErrors.js';
import { WC_SITE_CURRENCY_TTL_MS, type WcSiteMoney } from '../../lib/woocommerce/wcShopSync.js';
import { wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';

/**
 * 10.2 package 6 (D-04 part C): the shop's money, its currency (`GET data/currencies/current`, WooCommerce's own setting;
 * the Persian WooCommerce plugin answers IRT, IRR, IRHR or IRHT) and the decimals it shows and charges prices with
 * (`GET settings/general/woocommerce_price_num_decimals`, review M-A: WooCommerce keeps a regular price as sent but rounds
 * the price the customer pays to these decimals). Kept in memory for `WC_SITE_CURRENCY_TTL_MS`, so a price run with nothing
 * to send does not ask the shop once a minute. A run that has prices to send, and the nightly re-read, read both again with
 * `fresh` (review M-1): a shop switched between toman and rial, or to fewer decimals, never gets prices for the old setting.
 * A shop that answers no currency code or no decimals fails the price run: a price is never sent for a guessed setting.
 */
let cached: { url: string; money: WcSiteMoney; at: number } | null = null;

const UNREADABLE = (what: string) => new ValidationError(
  `${what} سایت خوانده نشد و قیمتی فرستاده نشد؛ تنظیمات ارز ووکامرس را بررسی کنید.`, undefined, WC_SHOP_REQUEST_FAILED,
);

/** WooCommerce lets only a key of a user who manages the shop read its settings and its currency */
export const DECIMALS_FORBIDDEN_MESSAGE =
  'تعداد اعشار قیمت سایت خوانده نشد و قیمتی فرستاده نشد؛ کلید باید از کاربری با نقش مدیر فروشگاه ساخته شده باشد تا تنظیمات اعشار خوانده شود.';
export const CURRENCY_FORBIDDEN_MESSAGE =
  'واحد پول سایت خوانده نشد و قیمتی فرستاده نشد؛ کلید باید از کاربری با نقش مدیر فروشگاه ساخته شده باشد تا تنظیمات ارز خوانده شود.';

/**
 * Review nit N-1: `settings/general/*` and `data/currencies/*` need a key of a user with the `manage_woocommerce`
 * capability (PR #420 review finding 4: the currency is read first), while products and orders open for any read/write
 * key. A 401 / 403 there names that, not the client's firewall text; the status is kept, so the run still counts as a
 * shop-level failure and waits before the next try.
 */
async function readManagerOnly(conn: WcConnection, path: string, forbidden: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await wcRequest(conn, 'GET', path, null, {}, { signal });
  } catch (err) {
    const status = err instanceof ValidationError ? (err.details as { status?: unknown } | undefined)?.status : undefined;
    if (status === 401 || status === 403) throw new ValidationError(forbidden, { status }, WC_SHOP_REQUEST_FAILED);
    throw err;
  }
}

export async function readSiteMoney(
  conn: WcConnection, signal?: AbortSignal, options: { fresh?: boolean; now?: number } = {},
): Promise<WcSiteMoney> {
  const now = options.now ?? Date.now();
  if (!options.fresh && cached && cached.url === conn.url && now - cached.at < WC_SITE_CURRENCY_TTL_MS) return cached.money;
  const answer = await readManagerOnly(conn, 'data/currencies/current', CURRENCY_FORBIDDEN_MESSAGE, signal);
  const currency = String((answer as { code?: unknown } | null)?.code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3,5}$/.test(currency)) throw UNREADABLE('واحد پول');
  const setting = await readManagerOnly(conn, 'settings/general/woocommerce_price_num_decimals', DECIMALS_FORBIDDEN_MESSAGE, signal);
  const decimalsText = String((setting as { value?: unknown } | null)?.value ?? '').trim();
  if (!/^\d{1,2}$/.test(decimalsText)) throw UNREADABLE('تعداد اعشار قیمت');
  const money = { currency, decimals: Number(decimalsText) };
  cached = { url: conn.url, money, at: now };
  return money;
}

/** The shop money last read, for the tab (null before the first price run or after a restart) */
export function lastSiteMoney(): WcSiteMoney | null {
  return cached?.money ?? null;
}

/** test hook: read the shop money again on the next price run */
export function forgetSiteCurrency(): void {
  cached = null;
}
