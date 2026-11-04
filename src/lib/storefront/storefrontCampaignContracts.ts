import type { StorefrontImage, StorefrontProductCard } from './storefrontContracts.js';
import type { CampaignStatus, CampaignValues } from './storefrontCampaignRules.js';

/**
 * v11 phase 8.5b: «صفحه‌های ویژه», one contract for the server, the «فروشگاه سایت» tab and the storefront app
 * (`AGENTS.md` §6.5).
 */
export type CampaignInput = CampaignValues;

export interface CampaignRow extends CampaignValues {
  id: number;
  /** the hero image as the list shows it; null for none. `onSite` is false when it has no light version (the site skips it) */
  hero: { assetId: number; title: string; onSite: boolean } | null;
  /** the chosen items with their code and name, in the page's order; `onSite` is false while one is not offered */
  products: Array<{ itemId: number; code: string; name: string; onSite: boolean }>;
  /** where the page stands today (Tehran) */
  status: CampaignStatus;
  version: number;
}

export interface CampaignsView {
  campaigns: CampaignRow[];
  /** the ERP collections of live products, for the page's collection */
  collections: string[];
}

/** An image of the media library a page may take as its hero (it has a light version) */
export interface CampaignHeroOption {
  id: number;
  title: string;
  section: string;
  /** the item code when the image is a product photo, '' otherwise */
  itemCode: string;
  width: number | null;
  height: number | null;
}

export interface CampaignHeroOptionPage {
  data: CampaignHeroOption[];
  total: number;
  page: number;
  limit: number;
}

/** `GET /api/storefront/v1/campaigns`: the pages on the site now, newest first */
export interface StorefrontCampaignSummary {
  slug: string;
  title: string;
  summary: string;
  hero: StorefrontImage | null;
  homeBanner: boolean;
  /** the last day it shows (Tehran), '' for no end */
  endsOn: string;
}

/** `GET /api/storefront/v1/campaigns/:slug`: one page on the site now */
export interface StorefrontCampaignPage extends StorefrontCampaignSummary {
  body: string;
  /** shown only while the code is live, on and open to retail buyers today; '' otherwise */
  discountCode: string;
  /** the items on the site now, in the page's order (a collection's in the shop's order), at most CAMPAIGN_PRODUCTS_MAX */
  products: StorefrontProductCard[];
}
