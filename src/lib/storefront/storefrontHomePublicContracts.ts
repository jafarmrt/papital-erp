import type { StorefrontProductCard } from './storefrontContracts.js';
import type { PageIcon, SectionBackground } from './storefrontPageParts.js';
import type { StorefrontNewsCard } from './storefrontNewsPublicContracts.js';
import type { StorefrontPageImage, StorefrontPageSection } from './storefrontPagePublicContracts.js';

/**
 * v12 phase 10e (start plan V12_SITE_NEXT_START_PLAN.md §7.2; its own security review, `AGENTS.md` §1.9c): what
 * `GET /api/storefront/v1/home` answers, the published copy of «صفحهٔ اصلی» as the site draws it. Like a page's answer it
 * carries no draft, editor, row id or library id. Only what a visitor sees today goes out: a part switched off, a slide
 * outside its days, a slide or banner whose image has left the library, «معرفی کالکشن» of a collection with no item on
 * the site and «تازه‌ترین خبرها» while there is no news are left out; a button whose target is not on the site now goes
 * out without its address. The ERP builds every address (as for the menus). The seven parts the site has in its own code
 * («خرید بر اساس دسته» …) carry only their words: the site fills them from the catalog as it does today.
 */
export interface StorefrontSlide {
  image: StorefrontPageImage;
  /** another crop for an upright screen, or null for the same image */
  mobileImage: StorefrontPageImage | null;
  title: string;
  text: string;
  /** '' with `href` '' when the slide has no button, or its target is not on the site now */
  buttonLabel: string;
  href: string;
  /** the address leaves the site */
  external: boolean;
}

export type StorefrontHomeOwnSection =
  | { kind: 'slider'; slides: StorefrontSlide[] }
  | { kind: 'banner'; image: StorefrontPageImage; mobileImage: StorefrontPageImage | null; href: string; external: boolean }
  | {
    kind: 'collectionIntro'; background: SectionBackground; title: string; collection: string; intro: string; image: StorefrontPageImage | null;
    /** the address of «آشنایی بیشتر» ('' = none) */
    moreHref: string; products: StorefrontProductCard[];
  }
  | { kind: 'latestNews'; background: SectionBackground; title: string; items: StorefrontNewsCard[] }
  | { kind: 'homeIntro'; kicker: string; title: string; text: string; buttonLabel: string; buttonHref: string }
  | { kind: 'homeCategories'; title: string }
  /** a point with an empty text is the delivery line the site writes itself */
  | { kind: 'homeWhy'; points: Array<{ icon: PageIcon; text: string }> }
  | { kind: 'homeFeatured' | 'homeNewest'; title: string; buttonLabel: string; buttonHref: string }
  | { kind: 'homeCollections'; title: string; text: string }
  | { kind: 'homeWholesale'; title: string; text: string; buttonLabel: string; buttonHref: string; secondLabel: string; secondHref: string };

export type StorefrontHomeSection = StorefrontPageSection | StorefrontHomeOwnSection;

export interface StorefrontPublicHome {
  /** the search title and description of the home page ('' = the site's own) */
  seoTitle: string;
  seoDescription: string;
  shareImage: StorefrontPageImage | null;
  /** when the copy on the site was published, an ISO time in UTC */
  updatedAt: string;
  sections: StorefrontHomeSection[];
}
