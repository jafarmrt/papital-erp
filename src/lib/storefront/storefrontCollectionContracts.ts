import type { StorefrontPageImage } from './storefrontPagePublicContracts.js';
import type { CollectionTextValues } from './storefrontCollectionRules.js';

/** v12 phase 10e: one collection as «کالکشن‌های سایت» lists it, with its own words when the shop has written them */
export interface CollectionTextRow extends CollectionTextValues {
  /** how many items of the collection are on the site now (0 = the collection has no page there) */
  count: number;
  /** the title of the chosen image in the library ('' = none), and whether it can still be shown */
  imageTitle: string;
  imageUsable: boolean;
  /** the title of the chosen page ('' = none or removed), and whether it is on the site now */
  morePageTitle: string;
  morePageLive: boolean;
  /** 0 while nothing has been saved for the collection yet; every save is sent under it */
  version: number;
}
export interface CollectionTextList {
  data: CollectionTextRow[];
  /** the pages of «صفحه‌های سایت» «آشنایی بیشتر» may name */
  pages: Array<{ id: number; title: string; live: boolean }>;
}
export type CollectionTextSaveInput = CollectionTextValues & { version: number };

/**
 * `GET /api/storefront/v1/collections` (`AGENTS.md` §1.9c): the words of each collection that has an item on the site
 * and something to show. Only what a visitor sees: the collection's name, its paragraphs, its image by the key of its
 * file, and the address of «آشنایی بیشتر» while that page is on the site. No row id, no library id, no editor's name.
 */
export interface StorefrontCollectionText {
  name: string;
  intro: string;
  image: StorefrontPageImage | null;
  /** the address on the site of the page «آشنایی بیشتر» leads to ('' = none) */
  moreHref: string;
}
