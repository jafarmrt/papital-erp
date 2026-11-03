import { loadableAnalytics, verificationToken } from '@erp/storefront/storefrontSeoRules';
import type { AnalyticsConfig } from '../components/Analytics';
import { seo } from './api.server';
import { siteEnv } from './site.server';

export interface SiteSeo {
  /** null = no statistics script: none chosen, or not the live site (a preview or test address never counts visits) */
  analytics: AnalyticsConfig | null;
  verification: { google: string; bing: string };
}

/** v11 phase 8.5: what every page writes for search engines and statistics, from the ERP's settings, checked again here */
export async function siteSeo(): Promise<SiteSeo> {
  try {
    const settings = await seo();
    return {
      analytics: siteEnv().indexable ? loadableAnalytics(settings.analytics) : null,
      verification: { google: verificationToken(settings.verification.google), bing: verificationToken(settings.verification.bing) },
    };
  } catch {
    // every page and its security header need this answer: anything odd means no statistics and no codes, never a 500
    return { analytics: null, verification: { google: '', bing: '' } };
  }
}
