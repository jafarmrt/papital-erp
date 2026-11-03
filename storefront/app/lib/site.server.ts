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
}

export function siteEnv(): SiteEnv {
  return {
    apiUrl: (process.env.STOREFRONT_API_URL ?? 'http://127.0.0.1:3000/api/storefront/v1').replace(/\/+$/, ''),
    apiKey: process.env.STOREFRONT_API_KEY ?? '',
    siteUrl: (process.env.STOREFRONT_SITE_URL ?? '').replace(/\/+$/, ''),
    previewNotice: process.env.STOREFRONT_PREVIEW_NOTICE ?? '',
  };
}
