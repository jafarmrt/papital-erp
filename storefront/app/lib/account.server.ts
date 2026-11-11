import { siteEnv } from './site.server';

/**
 * v11 phase 8.4b (docs/roadmap/V11_STOREFRONT_8_4B_SMS_LOGIN_START_PLAN.md): the buyer's session and the ERP's account
 * routes, from this server only.
 *
 * - The session token lives in the `sf_session` cookie: httpOnly (no script on the page can read it), `SameSite=Lax`
 *   (a form posted from another site carries no session), `Secure` on the live https site, 30 days like the session.
 *   It goes to the ERP in `X-Buyer-Session`, never in an address.
 * - After an SMS code is verified, its phone proof is kept for ten minutes in the `sf_proof` cookie (httpOnly, only
 *   under /account) so the sign-up that follows an SMS sign-in without an account can present it.
 * - Every call says the buyer's own address in `X-Storefront-Client-IP`, so the ERP's limits count each buyer (without it
 *   every buyer would share this server's address and one budget). The address is the one the web server in front
 *   writes: `X-Real-IP`, else the last `X-Forwarded-For` hop (the one it appended; earlier hops are the browser's word).
 *   Those headers are read only with `STOREFRONT_TRUST_PROXY=1`, set when a web server in front overwrites them; without
 *   it a browser could write any address and get a fresh limit with every request.
 * - Every account form is a POST from this site only (`sameSite`): a page elsewhere cannot post the forms in the buyer's
 *   name (sign the buyer out, or into an account of the poster's).
 */
export const SESSION_COOKIE = 'sf_session';
const PROOF_COOKIE = 'sf_proof';
const SESSION_MAX_AGE = 30 * 24 * 3600;
const PROOF_MAX_AGE = 600;
const TIMEOUT_MS = 8000;
const TOKEN = /^[A-Za-z0-9_-]{8,200}$/;

export function cookieOf(request: Request, name: string): string {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    // a cookie a browser or a hand garbled reads as none, never as an error page on every visit
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return '';
    }
  }
  return '';
}

export const secure = () => (siteEnv().siteUrl.startsWith('https://') ? '; Secure' : '');

export function sessionOf(request: Request): string {
  const token = cookieOf(request, SESSION_COOKIE);
  return TOKEN.test(token) ? token : '';
}

export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure()}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

/** The proof kept after a code was verified, for this phone only */
export function proofOf(request: Request, phone: string): string {
  const [kept, proof] = cookieOf(request, PROOF_COOKIE).split('.');
  return kept && kept === phone && proof && TOKEN.test(proof) ? proof : '';
}

export const proofCookie = (phone: string, proof: string) => `${PROOF_COOKIE}=${encodeURIComponent(`${phone}.${proof}`)}; Path=/account; HttpOnly; SameSite=Lax; Max-Age=${PROOF_MAX_AGE}${secure()}`;
export const clearProofCookie = () => `${PROOF_COOKIE}=; Path=/account; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

/**
 * v12 phase 7: a guest's phone proof at the checkout, kept between the code and a second «ثبت سفارش» (a refused order,
 * such as one item short, leaves the proof unused). Its own cookie and path, so the account pages never read it.
 */
const CHECKOUT_PROOF_COOKIE = 'sf_checkout_proof';
export function checkoutProofOf(request: Request, phone: string): string {
  const [kept, proof] = cookieOf(request, CHECKOUT_PROOF_COOKIE).split('.');
  return kept && kept === phone && proof && TOKEN.test(proof) ? proof : '';
}
export const checkoutProofCookie = (phone: string, proof: string) =>
  `${CHECKOUT_PROOF_COOKIE}=${encodeURIComponent(`${phone}.${proof}`)}; Path=/checkout; HttpOnly; SameSite=Lax; Max-Age=${PROOF_MAX_AGE}${secure()}`;
export const clearCheckoutProofCookie = () => `${CHECKOUT_PROOF_COOKIE}=; Path=/checkout; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

/**
 * v12 phase 8a (site review 2.3): a guest's phone proof on the wholesale request, kept between the code and the form
 * that sends it. Its own cookie and path, as at the checkout.
 */
const WHOLESALE_PROOF_COOKIE = 'sf_wholesale_proof';
export function wholesaleProofOf(request: Request): { phone: string; proof: string } {
  const [phone, proof] = cookieOf(request, WHOLESALE_PROOF_COOKIE).split('.');
  return phone && /^09\d{9}$/.test(phone) && proof && TOKEN.test(proof) ? { phone, proof } : { phone: '', proof: '' };
}
export const wholesaleProofCookie = (phone: string, proof: string) =>
  `${WHOLESALE_PROOF_COOKIE}=${encodeURIComponent(`${phone}.${proof}`)}; Path=/wholesale; HttpOnly; SameSite=Lax; Max-Age=${PROOF_MAX_AGE}${secure()}`;
export const clearWholesaleProofCookie = () => `${WHOLESALE_PROOF_COOKIE}=; Path=/wholesale; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

/** The phone the proof cookie is for ('' = none) */
export function provenPhoneOf(request: Request): string {
  const [phone, proof] = cookieOf(request, PROOF_COOKIE).split('.');
  return phone && /^09\d{9}$/.test(phone) && proof && TOKEN.test(proof) ? phone : '';
}

export function clientAddress(request: Request): string {
  if (process.env.STOREFRONT_TRUST_PROXY !== '1') return '';
  const real = (request.headers.get('x-real-ip') ?? '').trim();
  if (real) return real.slice(0, 64);
  const hops = (request.headers.get('x-forwarded-for') ?? '').split(',').map(h => h.trim()).filter(Boolean);
  return (hops.at(-1) ?? '').slice(0, 64);
}

export interface ApiAnswer<T> {
  status: number;
  data: T | null;
  /** the ERP's own words for a refusal (already in Persian), or a fixed sentence when it could not be reached */
  error: string;
  code: string;
  /** the form field a validation refusal is about ('' = none) */
  field?: string;
}

const UNREACHABLE = 'ارتباط با فروشگاه برقرار نشد؛ چند دقیقهٔ دیگر دوباره امتحان کنید.';

/** One call to the ERP's account routes; never throws for a refusal, so each form can say what went wrong */
export async function accountCall<T>(
  request: Request, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, options: { orderKey?: string } = {},
): Promise<ApiAnswer<T>> {
  const { apiUrl, apiKey } = siteEnv();
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  const address = clientAddress(request);
  if (address) headers['X-Storefront-Client-IP'] = address;
  const session = sessionOf(request);
  if (session) headers['X-Buyer-Session'] = session;
  // v11 phase 8.2: an order's tracking key goes in a header, never in the address (it stays out of access logs)
  if (options.orderKey) headers['X-Order-Key'] = options.orderKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: 503, data: null, error: UNREACHABLE, code: '' };
  }
  let json: { data?: T; error?: unknown; message?: unknown; code?: unknown; details?: { field?: unknown } } = {};
  try {
    json = await res.json() as typeof json;
  } catch {
    json = {};
  }
  if (res.ok) return { status: res.status, data: (json.data ?? null) as T | null, error: '', code: '' };
  const said = typeof json.error === 'string' ? json.error : typeof json.message === 'string' ? json.message : '';
  return {
    status: res.status, data: null, code: typeof json.code === 'string' ? json.code : '',
    field: typeof json.details?.field === 'string' ? json.details.field : '',
    error: res.status === 429 ? said || 'درخواست‌ها زیاد بود؛ کمی صبر کنید.' : res.status >= 500 || !said ? UNREACHABLE : said,
  };
}

/**
 * Where to go after signing in: a path on this site only (never `//other.site`, a full address, or a path a browser
 * would read as one once it drops tabs and line breaks and turns `\` into `/`)
 */
export function safeNext(raw: string | null | undefined): string {
  const next = String(raw ?? '');
  // eslint-disable-next-line no-control-regex
  if (!next.startsWith('/') || next.startsWith('//') || next.length > 300 || /[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  try {
    const resolved = new URL(next, 'http://site.invalid');
    return resolved.origin === 'http://site.invalid' ? next : '/';
  } catch {
    return '/';
  }
}

/**
 * A form post that came from this site: the browser's `Sec-Fetch-Site` says same-origin (or `none`, typed by the buyer),
 * else its `Origin` is this site's own address. A request with neither header (an old browser, a test) is let through:
 * the `SameSite=Lax` cookies already keep another site's post from carrying the buyer's session.
 */
export function sameSite(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const own = new Set([new URL(request.url).origin]);
  try {
    own.add(new URL(siteEnv().siteUrl).origin);
  } catch {
    // no site address configured
  }
  return own.has(origin);
}

/** The answer to a form posted from another site */
export const crossSite = () => new Response('Forbidden', { status: 403 });

/** A phone as the buyer typed it (Persian or Arabic digits, spaces, +98) in the ERP's form, or '' */
export function normalizePhone(raw: unknown): string {
  const digits = String(raw ?? '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s()-]/g, '')
    .replace(/^\+98/, '0')
    .replace(/^0098/, '0')
    .replace(/^98(?=9\d{9}$)/, '0')
    .replace(/^(?=9\d{9}$)/, '0');
  return /^09\d{9}$/.test(digits) ? digits : '';
}

export interface SessionAnswer {
  sessionToken: string;
  expiresAt: string;
}
