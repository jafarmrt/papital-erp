import axios from 'axios';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { assertSafeExternalUrl, guardedDnsLookup, UNSAFE_RESOLVED_ADDRESS } from '../../lib/ssrfGuard.js';
import { followShopRedirects } from '../../lib/woocommerce/wcRedirect.js';
import { ValidationError } from '../../errors/customErrors.js';
import { wcAuthQueryParams } from './wcRequestAuth.js';
import { readWcConnectionSettings } from './wcConnectionSettings.js';
import type { DbExecutor } from '../../db/drizzle.js';

/**
 * 10.2 package 6 (D-04 part A): the one client of the WooCommerce REST API, moved out of `woocommerce.routes.ts` so the
 * catalog refresh and the stock push (and the automatic push of part B) share it. Every request passes the SSRF guard and
 * follows a redirect only by hand on the same site (OBS-R2-82). A failed request is a 422 `WC_SHOP_REQUEST_FAILED` with a
 * Persian message the user sees, never a 500 whose message production hides.
 */
export const WC_SHOP_REQUEST_FAILED = 'WC_SHOP_REQUEST_FAILED';
export const WC_SETTINGS_INCOMPLETE = 'WC_SETTINGS_INCOMPLETE';
/** a request to the shop never waits longer than this */
export const WC_REQUEST_TIMEOUT_MS = 15_000;
/** the largest answer the shop may send to one request (a catalog page of 100 products is far smaller) */
export const WC_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface WcRequestOptions {
  /** aborts the request when the caller's overall deadline passes */
  signal?: AbortSignal;
}

export interface WcConnection {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}

// Secure HTTPS agent with strict TLS validation (SEC-011) and optional custom CA
const wooCaPath = process.env.WOOCOMMERCE_SSL_CA_PATH;
const httpsAgent = new https.Agent({
  rejectUnauthorized: true,
  ca: (wooCaPath && fs.existsSync(wooCaPath)) ? fs.readFileSync(wooCaPath, 'utf8') : undefined,
});
/**
 * review N-E: an own agent for a plain-HTTP shop too, so Node's global agent (which follows HTTP_PROXY when
 * NODE_USE_ENV_PROXY is set) never carries a shop request past the guarded lookup
 */
const httpAgent = new http.Agent();

/** The stored connection, or 422 `WC_SETTINGS_INCOMPLETE` when the address or a key is missing */
export async function requireWcConnection(executor?: DbExecutor): Promise<WcConnection> {
  const { url, consumerKey, consumerSecret } = await readWcConnectionSettings(executor);
  if (!url || !consumerKey || !consumerSecret) {
    throw new ValidationError('تنظیمات اتصال به ووکامرس کامل نیست. نشانی سایت و دو کلید را در «تنظیمات ← ووکامرس» وارد کنید.', undefined, WC_SETTINGS_INCOMPLETE);
  }
  return { url, consumerKey, consumerSecret };
}

function shopError(message: string, status?: number): ValidationError {
  return new ValidationError(message, status === undefined ? undefined : { status }, WC_SHOP_REQUEST_FAILED);
}

/** One request to the shop's REST API (`/wp-json/wc/v3/<path>`); the answer's body */
export async function makeWcRequest(
  method: 'GET' | 'POST' | 'PUT',
  urlPath: string,
  storeUrl: string,
  key: string,
  secret: string,
  data?: unknown,
  params: Record<string, unknown> = {},
  options: WcRequestOptions = {}
): Promise<unknown> {
  let formattedUrl = storeUrl.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'https://' + formattedUrl;
  }
  if (formattedUrl.endsWith('/')) {
    formattedUrl = formattedUrl.slice(0, -1);
  }

  // OBS-R2-82 (ت۴۰ item 4): every request to the shop, not only the connection test, passes the SSRF guard
  await assertSafeExternalUrl(formattedUrl, { allowLocalEcho: false });
  const fullUrl = `${formattedUrl}/wp-json/wc/v3/${urlPath.replace(/^\//, '')}`;
  const authHeader = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');

  const headers: Record<string, string> = {
    'Authorization': authHeader,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ERP-WooSync/2.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  try {
    // OBS-R2-82: redirects are followed by hand, at most WC_MAX_REDIRECTS hops, only on the same site and each through the
    // SSRF guard, so the keys never reach an address the guard did not check; the query (and on plain http the keys) is
    // built again for each address
    return await followShopRedirects(
      fullUrl,
      async (url, { asGet }) => {
        const response = await axios({
          method: asGet ? 'GET' : method,
          url,
          data: asGet ? undefined : data,
          params: wcAuthQueryParams(url, params, key, secret),
          headers,
          httpAgent,
          httpsAgent,
          // review M-5: the socket checks every address it resolves, so DNS rebinding after the guard reaches nothing inside
          lookup: guardedDnsLookup as never,
          // review N-B: never through an environment proxy (HTTPS_PROXY), which would resolve the name itself and skip the lookup
          proxy: false,
          timeout: WC_REQUEST_TIMEOUT_MS,
          signal: options.signal,
          maxContentLength: WC_MAX_RESPONSE_BYTES,
          maxBodyLength: WC_MAX_RESPONSE_BYTES,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400
        });
        const location = response.headers?.location;
        return { status: response.status, location: location ? String(location) : undefined, data: response.data };
      },
      (url) => assertSafeExternalUrl(url, { allowLocalEcho: false })
    );
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (axios.isCancel(error) || options.signal?.aborted) {
      throw shopError('کار با سایت در مهلت تعیین‌شده تمام نشد و نیمه‌کاره ماند؛ کمی بعد دوباره بزنید.');
    }
    if (axios.isAxiosError(error) && error.code === UNSAFE_RESOLVED_ADDRESS) {
      throw shopError('نشانی سایت هنگام اتصال به نشانی داخلی رسید و برای امنیت چیزی فرستاده نشد. نشانی و DNS سایت را بررسی کنید.');
    }
    if (axios.isAxiosError(error) && error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/i.test(error.message)) {
      throw shopError('پاسخ سایت بزرگ‌تر از اندازه مجاز بود و خوانده نشد.');
    }
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const errorData = error.response.data as { message?: unknown } | undefined;
      const wcMsg = typeof errorData?.message === 'string' ? errorData.message.slice(0, 300) : '';

      if (status === 401 || status === 403) {
        throw shopError(
          `سایت اجازه دسترسی نداد (${status}): ${wcMsg || 'کلید نادرست است یا دیوار آتش میزبان یا کلودفلر جلوی درخواست را گرفته است.'} ` +
          `اگر از کلودفلر یا آروان‌کلود استفاده می‌کنید، $_SERVER['HTTPS']='on'; را در بالای wp-config.php بگذارید ` +
          'و مطمئن شوید کلید دسترسی «خواندن/نوشتن» دارد.',
          status
        );
      } else if (status === 404) {
        throw shopError(
          'مسیر واسط برنامه‌نویسی سایت پیدا نشد (۴۰۴). پیوندهای یکتای وردپرس باید روی «نام نوشته» باشد و افزونه ووکامرس فعال باشد.',
          status
        );
      }
      throw shopError(`سایت وردپرس خطا داد (${status})${wcMsg ? `: ${wcMsg}` : '.'}`, status);
    } else if (axios.isAxiosError(error) && (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')) {
      throw shopError(`دامنه سایت پیدا نشد (${formattedUrl}). نشانی سایت را بررسی کنید.`);
    } else if (axios.isAxiosError(error) && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED')) {
      throw shopError('سایت وردپرس پاسخ نداد یا اتصال را رد کرد. شاید میزبان یا دیوار آتش سایت درخواست را بسته است.');
    }
    throw shopError('ارتباط با سایت وردپرس برقرار نشد.');
  }
}

/** The same request with the stored connection */
export function wcRequest(
  conn: WcConnection, method: 'GET' | 'POST' | 'PUT', urlPath: string, data?: unknown, params: Record<string, unknown> = {},
  options: WcRequestOptions = {},
): Promise<unknown> {
  return makeWcRequest(method, urlPath, conn.url, conn.consumerKey, conn.consumerSecret, data, params, options);
}
