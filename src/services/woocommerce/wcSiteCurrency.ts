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

export async function readSiteMoney(
  conn: WcConnection, signal?: AbortSignal, options: { fresh?: boolean; now?: number } = {},
): Promise<WcSiteMoney> {
  const now = options.now ?? Date.now();
  if (!options.fresh && cached && cached.url === conn.url && now - cached.at < WC_SITE_CURRENCY_TTL_MS) return cached.money;
  const answer = await wcRequest(conn, 'GET', 'data/currencies/current', null, {}, { signal });
  const currency = String((answer as { code?: unknown } | null)?.code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3,5}$/.test(currency)) throw UNREADABLE('واحد پول');
  const setting = await wcRequest(conn, 'GET', 'settings/general/woocommerce_price_num_decimals', null, {}, { signal });
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
