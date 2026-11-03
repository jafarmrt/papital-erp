/**
 * v11 phase 8.5 (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md): rules of the old-address redirects and the search and
 * visit-statistics settings, shared by the ERP server, the ERP settings tab and the storefront app. Nothing here reads
 * the database.
 *
 * An old address of the WooCommerce site is kept as one «key»: the path without the site, percent-decoded, in lower case,
 * with Arabic «ي» and «ك» read as Persian and without a trailing slash, so `https://papitalgallery.com/product/%DA%AF…/`
 * and `/product/گ…` are the same key. Of the query only what WordPress resolves a product or a page by is kept
 * (`?p=`, `?page_id=`, `?product=`, `?product_cat=`, `?product_tag=`); a page number or a feed suffix is dropped.
 */

export const REDIRECT_TARGET_KINDS = ['product', 'collection', 'category', 'path'] as const;
export type RedirectTargetKind = typeof REDIRECT_TARGET_KINDS[number];
export const REDIRECT_SOURCES = ['manual', 'woocommerce'] as const;
export type RedirectSource = typeof REDIRECT_SOURCES[number];

export const REDIRECT_PATH_MAX = 300;
export const REDIRECT_TARGET_MAX = 300;
export const REDIRECT_NOTE_MAX = 200;
/** The most redirects the site reads in one answer (a shop of a few hundred products has about two per product) */
export const REDIRECTS_MAX = 5000;

export const REDIRECT_TARGET_KIND_TITLES: Record<RedirectTargetKind, string> = {
  product: 'محصول',
  collection: 'کالکشن',
  category: 'دسته',
  path: 'نشانی دیگر سایت',
};
export const REDIRECT_SOURCE_TITLES: Record<RedirectSource, string> = {
  manual: 'دستی',
  woocommerce: 'از ووکامرس',
};

/** The WordPress query fields that name a product, a page or a product list, and the path each is read as */
const QUERY_PATHS: Array<{ field: string; key: (value: string) => string | null }> = [
  { field: 'p', key: v => (/^\d{1,12}$/.test(v) ? `/?p=${v}` : null) },
  { field: 'page_id', key: v => (/^\d{1,12}$/.test(v) ? `/?p=${v}` : null) },
  { field: 'product', key: v => (v ? `/product/${v}` : null) },
  { field: 'product_cat', key: v => (v ? `/product-category/${v}` : null) },
  { field: 'product_tag', key: v => (v ? `/product-tag/${v}` : null) },
];

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function foldText(text: string): string {
  return text.normalize('NFC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌+/g, '‌').toLowerCase();
}

/**
 * The key of an old address (a whole link or a path, with or without its query); null when it names nothing that could
 * be redirected (the home page itself, or no path at all)
 */
export function legacyPathKey(address: string): string | null {
  let text = address.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  if (!text.startsWith('/')) text = `/${text}`;
  const hash = text.indexOf('#');
  if (hash >= 0) text = text.slice(0, hash);
  const question = text.indexOf('?');
  const rawPath = question >= 0 ? text.slice(0, question) : text;
  const query = new URLSearchParams(question >= 0 ? text.slice(question + 1) : '');

  let segments = rawPath.split('/').filter(Boolean).map(s => foldText(decodeSegment(s)).trim()).filter(Boolean);
  // WordPress list pages and feeds of a product, a category or a tag
  if (segments.length >= 2 && segments[segments.length - 2] === 'page' && /^\d+$/.test(segments[segments.length - 1])) segments = segments.slice(0, -2);
  while (segments.length > 1 && ['feed', 'amp', 'embed'].includes(segments[segments.length - 1])) segments = segments.slice(0, -1);
  if (segments[0] === 'index.php') segments = segments.slice(1);
  // a nested category is reached by its own (last) slug
  if (segments[0] === 'product-category' && segments.length > 2) segments = [segments[0], segments[segments.length - 1]];

  if (segments.length === 0) {
    for (const { field, key } of QUERY_PATHS) {
      const value = query.get(field);
      if (value === null) continue;
      const found = key(foldText(value.trim()));
      if (found) return found.slice(0, REDIRECT_PATH_MAX);
    }
    return null;
  }
  const key = `/${segments.join('/')}`;
  return key.length > REDIRECT_PATH_MAX ? null : key;
}

/** Why an old address cannot be a redirect's source; null when it can */
export function legacyPathError(address: string): string | null {
  if (address.trim().length > REDIRECT_PATH_MAX * 3) return 'نشانی قدیمی بیش از اندازه بلند است.';
  const key = legacyPathKey(address);
  if (!key) return 'نشانی قدیمی باید مسیری از سایت قبلی باشد، مانند /product/نام-محصول یا ‎/?p=123‎.';
  if (key.length > REDIRECT_PATH_MAX) return `نشانی قدیمی حداکثر ${REDIRECT_PATH_MAX.toLocaleString('fa-IR')} نویسه است.`;
  return null;
}

/**
 * A path of this site a redirect may send to: it starts with one «/» (never «//» or «/\», which a browser reads as another
 * site), and has no space or control character
 */
export function isSafeSitePath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('//') || path.startsWith('/\\')) return false;
  if (path.length > REDIRECT_TARGET_MAX) return false;
  // a «.» or «..» segment (also written %2e) is resolved away by the browser, and «/..//x» would become «//x»
  if (/(^|\/)(\.|%2e){1,2}(\/|\?|#|$)/i.test(path.split(/[?#]/)[0] + '/')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\s\u0000-\u001f\u007f\\]/.test(path);
}

/** Why a redirect's target cannot be saved; null when it can (a product target is checked by its item in the ERP) */
export function redirectTargetError(kind: RedirectTargetKind, target: string): string | null {
  const text = target.trim();
  if (kind === 'product') return null;
  if (!text) return kind === 'path' ? 'نشانی مقصد لازم است.' : `نام ${REDIRECT_TARGET_KIND_TITLES[kind]} لازم است.`;
  if (text.length > REDIRECT_TARGET_MAX) return `مقصد حداکثر ${REDIRECT_TARGET_MAX.toLocaleString('fa-IR')} نویسه است.`;
  if (kind === 'path' && !isSafeSitePath(text)) return 'نشانی مقصد باید مسیری از همین سایت باشد که با «/» آغاز می‌شود، مانند /products.';
  return null;
}

/**
 * Where an old address that no redirect names goes on the new site, by the shape WooCommerce gives its addresses; null
 * keeps the 404. These are guesses, so they are temporary (302): a row added later replaces them without a stale cache.
 */
export function legacyFallback(key: string): string | null {
  const [first, second] = key.split('/').filter(Boolean);
  if (first === 'shop' || first === 'product-category' || first === 'product-tag') return '/products';
  if (first === 'product' && second) {
    const words = second.replace(/[-_]+/g, ' ').trim().slice(0, 100);
    return words ? `/products?q=${encodeURIComponent(words)}` : '/products';
  }
  if (first === 'cart' || first === 'checkout' || first === 'my-account' || first === 'wishlist') return '/';
  return null;
}

/** The query fields of a link that a redirect carries over (campaign links of Instagram posts and ads) */
export function campaignParams(search: string): URLSearchParams {
  const kept = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(search)) {
    if (/^utm_[a-z]{1,20}$/.test(name) || name === 'gclid' || name === 'fbclid') kept.append(name, value.slice(0, 200));
  }
  return kept;
}

/** v11 phase 8.5: the visit-statistics services the site can load (default none) */
export const ANALYTICS_PROVIDERS = ['none', 'ga4', 'matomo'] as const;
export type AnalyticsProvider = typeof ANALYTICS_PROVIDERS[number];
export const ANALYTICS_PROVIDER_TITLES: Record<AnalyticsProvider, string> = {
  none: 'خاموش',
  ga4: 'گوگل آنالیتیکس ۴',
  matomo: 'ماتومو',
};
export const isAnalyticsProvider = (value: unknown): value is AnalyticsProvider => typeof value === 'string' && (ANALYTICS_PROVIDERS as readonly string[]).includes(value);

const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
const MATOMO_SITE_ID = /^[1-9]\d{0,5}$/;
const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
export const SITE_URL_MAX = 200;

/** A site address the settings take: https, a host with a dot, no user, no port, query or fragment */
export function httpsSiteUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (!url.hostname.includes('.') || text.length > SITE_URL_MAX) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export interface SeoSettingsValues {
  googleVerification: string;
  bingVerification: string;
  analyticsProvider: AnalyticsProvider;
  /** GA4: the measurement id (G-…); Matomo: the site id */
  analyticsId: string;
  /** Matomo only: the https address of the Matomo server */
  analyticsUrl: string;
  /** the brand's site in another language (papital.gallery), linked from the home page as its other-language version */
  alternateSiteUrl: string;
}

/**
 * Whether the site may load a statistics service as the ERP sent it: the site checks the id and address again before it
 * writes them into a page, so a value that went wrong on the way never becomes a script
 */
export function loadableAnalytics(analytics: { provider: string; id: string; url: string }): { provider: 'ga4' | 'matomo'; id: string; url: string } | null {
  if (analytics.provider === 'ga4' && GA4_ID.test(analytics.id)) return { provider: 'ga4', id: analytics.id, url: '' };
  if (analytics.provider === 'matomo' && MATOMO_SITE_ID.test(analytics.id)) {
    const url = httpsSiteUrl(analytics.url);
    if (url) return { provider: 'matomo', id: analytics.id, url };
  }
  return null;
}

/** A search-engine verification code the site may write into a page; '' otherwise */
export const verificationToken = (value: string): string => (VERIFICATION_TOKEN.test(value) ? value : '');

/** The first problem of a search and statistics settings form, as the field and the message; null when it is valid */
export function seoSettingsError(raw: SeoSettingsValues): { field: keyof SeoSettingsValues; message: string } | null {
  const values = {
    ...raw, googleVerification: raw.googleVerification.trim(), bingVerification: raw.bingVerification.trim(), analyticsId: raw.analyticsId.trim(),
    analyticsUrl: raw.analyticsUrl.trim(), alternateSiteUrl: raw.alternateSiteUrl.trim(),
  };
  if (values.googleVerification && !VERIFICATION_TOKEN.test(values.googleVerification)) {
    return { field: 'googleVerification', message: 'کد تأیید گوگل فقط حرف انگلیسی، رقم، «-» و «_» دارد؛ فقط کد درون برچسب را بنویسید.' };
  }
  if (values.bingVerification && !VERIFICATION_TOKEN.test(values.bingVerification)) {
    return { field: 'bingVerification', message: 'کد تأیید بینگ فقط حرف انگلیسی، رقم، «-» و «_» دارد؛ فقط کد درون برچسب را بنویسید.' };
  }
  if (!isAnalyticsProvider(values.analyticsProvider)) return { field: 'analyticsProvider', message: 'سرویس آمار بازدید شناخته نیست.' };
  if (values.analyticsProvider === 'ga4' && !GA4_ID.test(values.analyticsId.toUpperCase())) {
    return { field: 'analyticsId', message: 'شناسهٔ اندازه‌گیری گوگل آنالیتیکس با G- آغاز می‌شود، مانند G-ABC123XYZ.' };
  }
  if (values.analyticsProvider === 'matomo') {
    if (!MATOMO_SITE_ID.test(values.analyticsId)) return { field: 'analyticsId', message: 'شناسهٔ سایت در ماتومو یک عدد است، مانند ۱.' };
    if (!values.analyticsUrl || httpsSiteUrl(values.analyticsUrl) === null) {
      return { field: 'analyticsUrl', message: 'نشانی سرور ماتومو باید با https:// آغاز شود، مانند https://stats.example.com.' };
    }
  }
  if (values.alternateSiteUrl && httpsSiteUrl(values.alternateSiteUrl) === null) {
    return { field: 'alternateSiteUrl', message: 'نشانی سایت زبان دیگر باید با https:// آغاز شود، مانند https://papital.gallery.' };
  }
  return null;
}

/** The values as they are saved (after `seoSettingsError` passed): trimmed, the unused statistics fields emptied and addresses without a trailing slash */
export function normalizedSeoSettings(values: SeoSettingsValues): SeoSettingsValues {
  const provider = values.analyticsProvider;
  return {
    googleVerification: values.googleVerification.trim(),
    bingVerification: values.bingVerification.trim(),
    analyticsProvider: provider,
    analyticsId: provider === 'none' ? '' : provider === 'ga4' ? values.analyticsId.trim().toUpperCase() : values.analyticsId.trim(),
    analyticsUrl: provider === 'matomo' ? (httpsSiteUrl(values.analyticsUrl) ?? '') : '',
    alternateSiteUrl: httpsSiteUrl(values.alternateSiteUrl) ?? '',
  };
}
