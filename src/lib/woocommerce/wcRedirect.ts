import { ValidationError } from '../../errors/customErrors.js';

/**
 * OBS-R2-82 (decision ت۴۰ item 4): a request to the online shop follows at most this many redirects, each by hand, so
 * the SSRF guard checks every address the API keys are sent to.
 */
export const WC_MAX_REDIRECTS = 3;

export const WC_REDIRECT_REFUSED_CODE = 'WC_REDIRECT_REFUSED';
export const WC_REDIRECT_LIMIT_CODE = 'WC_REDIRECT_LIMIT';

/** One answer of the shop: a redirect carries its `Location`. */
export interface ShopHop<T> {
  status: number;
  location?: string;
  data: T;
}

const isRedirectStatus = (status: number) => status >= 300 && status < 400;

const hostKey = (hostname: string) => hostname.toLowerCase().replace(/^www\./, '');

const effectivePort = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80');

/**
 * The address a shop redirect may be followed to, or null: the same site only — the same host name ignoring letter case
 * and a leading «www.», the same scheme or http → https (never back to http), the same port or the scheme's default one,
 * any path. Its query and fragment are dropped, because the caller sends its own query (and, on plain http, the keys).
 */
export function shopRedirectTarget(currentUrl: string, location: string | undefined): string | null {
  if (!location || !location.trim()) return null;
  let current: URL;
  let next: URL;
  try {
    current = new URL(currentUrl);
    next = new URL(location.trim(), current);
  } catch {
    return null;
  }
  if (next.username || next.password) return null;
  if (!['http:', 'https:'].includes(next.protocol)) return null;
  if (current.protocol === 'https:' && next.protocol !== 'https:') return null;
  if (hostKey(next.hostname) !== hostKey(current.hostname)) return null;
  const defaultPortsUpgrade = current.protocol === 'http:' && next.protocol === 'https:' && !current.port && !next.port;
  if (!defaultPortsUpgrade && effectivePort(next) !== effectivePort(current)) return null;
  next.search = '';
  next.hash = '';
  return next.toString();
}

/**
 * Sends a shop request and follows its redirects by hand: each target must stay on the same site
 * (`shopRedirectTarget`) and pass `guard` (the SSRF guard) before anything is sent to it; at most `WC_MAX_REDIRECTS`
 * hops. Any other redirect is a 422 with a Persian message.
 */
export async function followShopRedirects<T>(
  firstUrl: string,
  send: (url: string) => Promise<ShopHop<T>>,
  guard: (url: string) => Promise<void>
): Promise<T> {
  let url = firstUrl;
  for (let hop = 0; ; hop++) {
    const answer = await send(url);
    if (!isRedirectStatus(answer.status)) return answer.data;
    if (hop >= WC_MAX_REDIRECTS) {
      throw new ValidationError(
        'سایت فروشگاه بیش از سه بار به نشانی دیگری هدایت کرد. نشانی نهایی فروشگاه را در تنظیمات ووکامرس بگذارید.',
        { status: answer.status, location: answer.location ?? null },
        WC_REDIRECT_LIMIT_CODE
      );
    }
    const target = shopRedirectTarget(url, answer.location);
    if (!target) {
      throw new ValidationError(
        `سایت فروشگاه به نشانی دیگری هدایت می‌کند (${answer.status})${answer.location ? `: ${answer.location}` : ''}. ` +
        'برای امنیت کلیدها فقط هدایت به همان سایت (https یا www) دنبال می‌شود؛ نشانی نهایی فروشگاه را در تنظیمات ووکامرس بگذارید.',
        { status: answer.status, location: answer.location ?? null },
        WC_REDIRECT_REFUSED_CODE
      );
    }
    await guard(target);
    url = target;
  }
}
