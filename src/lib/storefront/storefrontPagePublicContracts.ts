import type { StorefrontProductCard } from './storefrontContracts.js';
import type { IconCard, PageKind, RichDoc, SectionBackground } from './storefrontPageParts.js';
import type { StorefrontPublicHome } from './storefrontHomePublicContracts.js';

/**
 * v12 phase 10c (start plan V12_SITE_NEXT_START_PLAN.md §7.2): what `GET /api/storefront/v1/pages[/:slug]` answers, the
 * published copy of a page as the site draws it. It carries no draft, no editor's name, no row id and no id of the media
 * library: an image is named by the key of its file (as a product's photo is), and a row of products is the cards of the
 * items on the site now. A text is the editor's JSON, in which an image node holds `sha256`, `width`, `height`, `alt` and
 * `thumb` in place of the library's id; the site turns it into elements itself, so no HTML crosses from the ERP.
 */
export interface StorefrontPageImage {
  /** the file key; the light version is `GET /api/storefront/v1/media/<sha256>.webp` */
  sha256: string;
  width: number | null;
  height: number | null;
  alt: string;
  /** whether the small version (`<sha256>-thumb.webp`) exists too */
  thumb: boolean;
}

interface PublicSectionBase { background: SectionBackground }
export type StorefrontPageSection =
  | (PublicSectionBase & { kind: 'hero'; title: string; text: string; image: StorefrontPageImage | null; buttonLabel: string; buttonHref: string })
  | (PublicSectionBase & { kind: 'text'; doc: RichDoc })
  | (PublicSectionBase & {
    kind: 'textImage'; title: string; doc: RichDoc; image: StorefrontPageImage | null; imageSide: 'right' | 'left'; buttonLabel: string; buttonHref: string;
  })
  | (PublicSectionBase & { kind: 'iconCards'; title: string; cards: IconCard[] })
  | (PublicSectionBase & { kind: 'gallery'; title: string; images: StorefrontPageImage[] })
  | (PublicSectionBase & { kind: 'people'; title: string; people: Array<{ image: StorefrontPageImage | null; name: string; role: string; contact: string }> })
  | (PublicSectionBase & {
    kind: 'map'; title: string; image: StorefrontPageImage | null; address: string; neshanUrl: string; baladUrl: string; googleUrl: string;
  })
  /** `collection` is the collection the row was made from ('' for chosen items), so the site can link to the rest of it */
  | (PublicSectionBase & { kind: 'products'; title: string; collection: string; products: StorefrontProductCard[] })
  | (PublicSectionBase & { kind: 'button'; label: string; href: string })
  | (PublicSectionBase & { kind: 'shippingMethods'; title: string });

/** One line of `GET /api/storefront/v1/pages`: the pages on the site now, for the sitemap and the site's own links */
export interface StorefrontPageSummary {
  slug: string;
  /** a base page lives at its own address (`/about`), a custom page at `/pages/<slug>`; the home page is never among them */
  kind: Exclude<PageKind, 'home'>;
  title: string;
  noindex: boolean;
  /** when the copy on the site was published, an ISO time in UTC (`2026-11-21T18:13:41.727Z`): the page's last change for a search engine */
  updatedAt: string;
}

/** `GET /api/storefront/v1/page-preview` (key in `X-Preview-Key`): a page's saved draft as the site draws it (always `noindex`), and when its link ends */
export interface StorefrontPagePreview extends StorefrontPublicPage {
  /** ISO time in UTC */
  expiresAt: string;
  /** v12 phase 10e: set when the previewed page is «صفحهٔ اصلی»: its draft as the home page it would be */
  home?: StorefrontPublicHome;
}

export interface StorefrontPublicPage extends StorefrontPageSummary {
  seoTitle: string;
  seoDescription: string;
  shareImage: StorefrontPageImage | null;
  sections: StorefrontPageSection[];
}
