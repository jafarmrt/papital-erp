import type { PageKind, PageTemplateKey, PageValues } from './storefrontPageRules.js';

/**
 * v12 phase 10b: the answers of «صفحه‌های سایت», one contract for the ERP server and the page builder (`AGENTS.md` §6.5).
 */

/** 'draft' = never on the site; 'published' = on the site as it is edited; 'changed' = on the site, with newer edits waiting */
export type PageStatus = 'draft' | 'published' | 'changed';
export const PAGE_STATUS_TITLES: Readonly<Record<PageStatus, string>> = {
  draft: 'پیش‌نویس',
  published: 'روی سایت',
  changed: 'روی سایت، با تغییر منتشرنشده',
};

export interface PageListRow {
  id: number;
  kind: PageKind;
  slug: string;
  title: string;
  status: PageStatus;
  /** '' while the page was never published */
  publishedAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

/** An image of the media library a page names, as the builder shows it */
export interface PageAssetInfo {
  assetId: number;
  title: string;
  /** a live image with a light version; false = the page cannot be published with it */
  usable: boolean;
}

export interface PageDetail extends PageListRow {
  /** the draft the builder edits */
  draft: PageValues;
  assets: PageAssetInfo[];
  /** v12 phase 10c: the places of «فهرست‌های سایت» (`header`, `drawer`, `footer`, `bottom`) that link to this page */
  menuPlaces: string[];
}

/** v12 phase 10c: what «پیش‌نمایش» answers: the link on the site (its key is in it and is kept nowhere else) and when it ends */
export interface PagePreviewLink {
  /** the path on the site, `/preview/<key>` */
  path: string;
  /** the whole address, with the site's address of «جست‌وجو و آمار بازدید» (the main domain when none is written) */
  url: string;
  /** ISO time in UTC */
  expiresAt: string;
  /** false = no address is written in «جست‌وجو و آمار بازدید», so `url` begins with the main domain */
  addressSet: boolean;
}

export interface PageSaveInput extends PageValues {
  version: number;
}

export interface PageCreateInput {
  title: string;
  slug: string;
  /** «شروع از الگو»; null = an empty page */
  template: PageTemplateKey | null;
}

export interface PageImageOptions {
  data: Array<{ assetId: number; title: string }>;
  total: number;
  page: number;
  limit: number;
}
