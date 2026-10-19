import { ValidationError } from '../../errors/customErrors.js';
import { WC_SITE_CURRENCY_TTL_MS } from '../../lib/woocommerce/wcShopSync.js';
import { wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';

/**
 * 10.2 package 6 (D-04 part C): the shop's currency (`GET data/currencies/current`, WooCommerce's own setting; the Persian
 * WooCommerce plugin answers IRT, IRR, IRHR or IRHT), kept in memory for `WC_SITE_CURRENCY_TTL_MS`, so a price run with
 * nothing to send does not ask the shop for it once a minute. A run that has prices to send, and the nightly re-read, read
 * it again with `fresh` (review M-1): a shop switched between toman and rial meanwhile never gets prices in the old unit.
 * A shop that answers no currency code fails the price run: a price is never sent in a guessed unit.
 */
let cached: { url: string; code: string; at: number } | null = null;

export async function readSiteCurrency(
  conn: WcConnection, signal?: AbortSignal, options: { fresh?: boolean; now?: number } = {},
): Promise<string> {
  const now = options.now ?? Date.now();
  if (!options.fresh && cached && cached.url === conn.url && now - cached.at < WC_SITE_CURRENCY_TTL_MS) return cached.code;
  const answer = await wcRequest(conn, 'GET', 'data/currencies/current', null, {}, { signal });
  const code = String((answer as { code?: unknown } | null)?.code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3,5}$/.test(code)) {
    throw new ValidationError('واحد پول سایت خوانده نشد و قیمتی فرستاده نشد؛ تنظیمات ارز ووکامرس را بررسی کنید.', undefined, WC_SHOP_REQUEST_FAILED);
  }
  cached = { url: conn.url, code, at: now };
  return code;
}

/** The shop currency last read, for the tab (null before the first price run or after a restart) */
export function lastSiteCurrency(): string | null {
  return cached?.code ?? null;
}

/** test hook: read the shop currency again on the next price run */
export function forgetSiteCurrency(): void {
  cached = null;
}
