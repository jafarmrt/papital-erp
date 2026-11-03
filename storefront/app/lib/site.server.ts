/**
 * The storefront server's own settings, from its environment (never from the browser). The ERP address and key stay
 * on the server: the browser only ever talks to this app.
 */
export interface SiteEnv {
  apiUrl: string;
  apiKey: string;
  /** the public address of the site, for canonical links and social cards; '' while unknown */
  siteUrl: string;
  /** shown on every page while the data is a preview (never on the live site) */
  previewNotice: string;
  /**
   * Search engines may index the site only when its public address is known, it is not a preview and nobody turned
   * indexing off (`STOREFRONT_NOINDEX=1`, e.g. on a test address); otherwise every page says noindex and robots.txt
   * shuts the whole site.
   */
  indexable: boolean;
  /**
   * The site can be installed on a phone (web app manifest and service worker), only with `STOREFRONT_PWA=1`. Turned
   * off again, the worker is removed from every phone on its next visit.
   */
  pwa: boolean;
}

export function siteEnv(): SiteEnv {
  const siteUrl = (process.env.STOREFRONT_SITE_URL ?? '').replace(/\/+$/, '');
  const previewNotice = process.env.STOREFRONT_PREVIEW_NOTICE ?? '';
  return {
    apiUrl: (process.env.STOREFRONT_API_URL ?? 'http://127.0.0.1:3000/api/storefront/v1').replace(/\/+$/, ''),
    apiKey: process.env.STOREFRONT_API_KEY ?? '',
    siteUrl,
    previewNotice,
    indexable: siteUrl !== '' && previewNotice === '' && process.env.STOREFRONT_NOINDEX !== '1',
    pwa: process.env.STOREFRONT_PWA === '1',
  };
}
