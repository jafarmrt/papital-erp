import type { PageAssetInfo, PageStatus } from './storefrontPageContracts.js';
import type { NewsValues } from './storefrontNewsRules.js';

/**
 * v12 phase 10d: «خبرهای سایت» between the ERP's server and its screen. The words of the states are a page's
 * (`PAGE_STATUS_TITLES`): a draft, on the site, on the site with unpublished changes.
 */
export interface NewsListRow {
  id: number;
  slug: string;
  title: string;
  status: PageStatus;
  /** the day the draft is dated ('' = the day it is published) */
  newsDate: string;
  /** the day the copy on the site is dated ('' while the item is not on the site); a day to come = not yet shown */
  publishedDate: string;
  /** the copy on the site is dated after today (Tehran): it comes on by itself that day */
  scheduled: boolean;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface NewsDetail extends NewsListRow {
  draft: NewsValues;
  /** the images the draft names, with their titles */
  assets: PageAssetInfo[];
}

export interface NewsList {
  data: NewsListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** «خبرها روی سایت بیایند»: while it is off the site has no news at all, whatever is published here */
  siteEnabled: boolean;
}

export interface NewsCreateInput { title: string; slug: string }
export type NewsSaveInput = NewsValues & { version: number };
