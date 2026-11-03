import type { AnalyticsProvider, RedirectSource, RedirectTargetKind, SeoSettingsValues } from './storefrontSeoRules.js';

/**
 * v11 phase 8.5: the answers of the old-address redirects and the search and statistics settings, one contract for the
 * ERP server, the «فروشگاه سایت» tab and the storefront app (`AGENTS.md` §6.5).
 */

/** The search and statistics settings in `app_settings`: a group of its own, under its own version */
export const STOREFRONT_SEO_SETTING_KEYS = {
  googleVerification: 'sf_seo_google_verification',
  bingVerification: 'sf_seo_bing_verification',
  analyticsProvider: 'sf_seo_analytics_provider',
  analyticsId: 'sf_seo_analytics_id',
  analyticsUrl: 'sf_seo_analytics_url',
  alternateSiteUrl: 'sf_seo_alternate_site_url',
  version: 'sf_seo_version',
} as const;

export interface StorefrontSeoSettingsInput extends SeoSettingsValues {
  version: number;
}

export type StorefrontSeoSettingsView = StorefrontSeoSettingsInput;

/** `GET /api/storefront/v1/seo`: what every page of the site needs for search engines and visit statistics */
export interface StorefrontPublicSeo {
  verification: { google: string; bing: string };
  analytics: { provider: AnalyticsProvider; id: string; url: string };
  alternateSiteUrl: string;
}

export interface StorefrontRedirectInput {
  /** the old address as the owner typed or pasted it; the ERP keeps its key (`legacyPathKey`) */
  fromPath: string;
  targetKind: RedirectTargetKind;
  /** the item a product redirect sends to (its current address on the site); null for the other kinds */
  targetItemId: number | null;
  /** a collection or category name, or a path of the site; '' for a product */
  target: string;
  note: string;
  isActive: boolean;
}

export interface StorefrontRedirectRow extends Omit<StorefrontRedirectInput, 'fromPath'> {
  id: number;
  /** the key of the old address */
  fromPath: string;
  source: RedirectSource;
  /** a product target's code and name, '' for the other kinds */
  targetCode: string;
  targetName: string;
  /** a product target's site address, '' while the item is not published (the redirect then waits) */
  targetSlug: string;
  version: number;
}

export interface StorefrontRedirectPage {
  data: StorefrontRedirectRow[];
  total: number;
  page: number;
  limit: number;
}

/** What one reading of the WooCommerce site added to the redirects */
export interface StorefrontRedirectImportResult {
  /** products, categories and tags read from the WooCommerce site */
  read: { products: number; categories: number; tags: number };
  created: number;
  updated: number;
  unchanged: number;
  /** old addresses whose redirect was made, edited or removed by hand, which a reading never changes or brings back */
  keptManual: number;
  /** read but matched with nothing on the new site: a product without an item link, a category or tag without a name match */
  unmatched: number;
  /** the site had more products than one reading takes; the rest are left for the next reading */
  truncated: boolean;
}

/** `GET /api/storefront/v1/redirects`: the live redirects whose target is on the site, by the old address's key */
export interface StorefrontPublicRedirect {
  from: string;
  kind: RedirectTargetKind;
  /** a product's site address (slug), a collection or category name, or a site path */
  target: string;
}
