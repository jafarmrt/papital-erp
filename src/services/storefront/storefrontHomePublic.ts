import { and, eq, isNotNull } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { storefrontPages, type PublishedPage } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import {
  COLLECTION_INTRO_PRODUCTS, HOME_PAGE_SLUG, LATEST_NEWS_COUNT, homeSectionLinks, isHomeSectionKind, pageAssetIds, pageLink, type HomeSection, type PageSection,
} from '../../lib/storefront/storefrontPageRules.js';
import type { StorefrontHomeOwnSection, StorefrontHomeSection, StorefrontPublicHome, StorefrontSlide } from '../../lib/storefront/storefrontHomePublicContracts.js';
import type { StorefrontCollectionText } from '../../lib/storefront/storefrontCollectionContracts.js';
import type { StorefrontNewsCard } from '../../lib/storefront/storefrontNewsPublicContracts.js';
import type { SiteLink } from '../../lib/storefront/storefrontSiteLinks.js';
import { campaignCards } from './storefrontCatalog.service.js';
import { publicCollectionTexts } from './storefrontCollections.service.js';
import { publicNewsList } from './storefrontNewsPublic.js';
import { imageOf, imagesOf, isoOf, publicSection, type Images } from './storefrontPagePublic.js';
import { siteLinkResolver } from './storefrontSiteLinkTargets.js';

/**
 * v12 phase 10e (start plan §7.2; `AGENTS.md` §1.9): «صفحهٔ اصلی» as the site reads it. Only the published copy of the
 * home row goes out, built for today: see `storefrontHomePublicContracts.ts` for what is left out. Until the home page is
 * published the answer is 404 and the site keeps the home page in its own code.
 */
const notPublished = () => new NotFoundError('صفحهٔ اصلی هنوز منتشر نشده است.', undefined, 'STOREFRONT_HOME_NOT_PUBLISHED');
const linkOf = (value: unknown): string => pageLink(value) ?? '';

/** What the parts of the home page read besides the page itself, each read once and only when a part asks for it */
interface HomeNow {
  today: string;
  images: Images;
  hrefOf: (link: SiteLink | null) => { href: string; external: boolean };
  collections: () => Promise<StorefrontCollectionText[]>;
  news: () => Promise<StorefrontNewsCard[]>;
}

const once = <T>(read: () => Promise<T>): (() => Promise<T>) => {
  let kept: Promise<T> | null = null;
  return () => (kept ??= read());
};

async function homeSection(section: HomeSection, now: HomeNow): Promise<StorefrontHomeOwnSection | null> {
  const { background } = section;
  switch (section.kind) {
    case 'slider': {
      const slides = section.slides.flatMap((slide): StorefrontSlide[] => {
        // a slide is shown from its first day to its last, by the shop's own day
        if ((slide.startsOn && slide.startsOn > now.today) || (slide.endsOn && slide.endsOn < now.today)) return [];
        const image = imageOf(now.images, slide.imageAssetId, slide.imageAlt);
        if (!image) return [];
        const target = now.hrefOf(slide.link);
        return [{
          image, mobileImage: imageOf(now.images, slide.mobileImageAssetId, slide.imageAlt), title: slide.title, text: slide.text,
          // a button whose target is not on the site now is left out, and the slide stays
          buttonLabel: target.href ? slide.buttonLabel : '', ...target,
        }];
      });
      return slides.length ? { kind: 'slider', slides } : null;
    }
    case 'banner': {
      const image = imageOf(now.images, section.imageAssetId, section.imageAlt);
      return image ? { kind: 'banner', image, mobileImage: imageOf(now.images, section.mobileImageAssetId, section.imageAlt), ...now.hrefOf(section.link) } : null;
    }
    case 'collectionIntro': {
      const products = await campaignCards({ collection: section.collection }, COLLECTION_INTRO_PRODUCTS);
      // a collection with no item on the site has no page to lead to
      if (products.length === 0) return null;
      const words = (await now.collections()).find(row => row.name === section.collection);
      return {
        kind: 'collectionIntro', background, title: section.title, collection: section.collection, intro: words?.intro ?? '', image: words?.image ?? null,
        moreHref: words?.moreHref ?? '', products,
      };
    }
    case 'latestNews': {
      const items = (await now.news()).slice(0, LATEST_NEWS_COUNT);
      return items.length ? { kind: 'latestNews', background, title: section.title, items } : null;
    }
    case 'homeIntro':
      return { kind: 'homeIntro', kicker: section.kicker, title: section.title, text: section.text, buttonLabel: section.buttonLabel, buttonHref: linkOf(section.buttonHref) };
    case 'homeCategories':
      return { kind: 'homeCategories', title: section.title };
    case 'homeWhy':
      return { kind: 'homeWhy', points: section.points.map(point => ({ icon: point.icon, text: point.text })) };
    case 'homeFeatured': case 'homeNewest':
      return { kind: section.kind, title: section.title, buttonLabel: section.buttonLabel, buttonHref: linkOf(section.buttonHref) };
    case 'homeCollections':
      return { kind: 'homeCollections', title: section.title, text: section.text };
    case 'homeWholesale':
      return {
        kind: 'homeWholesale', title: section.title, text: section.text, buttonLabel: section.buttonLabel, buttonHref: linkOf(section.buttonHref),
        secondLabel: section.secondLabel, secondHref: linkOf(section.secondHref),
      };
    default:
      return null;
  }
}

/** One copy of the home page as the site gets it: the copy on the site, or (a preview link) the draft, built the same way */
export async function homeForSite(copy: PublishedPage, updatedAt: string): Promise<StorefrontPublicHome> {
  // a part switched off is not on the site at all: its images and links are not even read
  const sections = (Array.isArray(copy.sections) ? copy.sections : []).filter((section: PageSection) => section.hidden !== true);
  const images = await imagesOf(pageAssetIds({ shareImageAssetId: copy.shareImageAssetId, sections }));
  const links = homeSectionLinks(sections).map(entry => entry.link);
  const resolve = links.length ? await siteLinkResolver(links) : () => null;
  const now: HomeNow = {
    today: await businessTodayIsoDate(), images,
    hrefOf: (link) => {
      const href = link ? resolve(link) ?? '' : '';
      return { href, external: href !== '' && link?.kind === 'url' };
    },
    collections: once(publicCollectionTexts),
    news: once(async () => (await publicNewsList(1)).data),
  };
  const out: StorefrontHomeSection[] = [];
  // one after another: the parts that read the catalog share its few seconds of memory
  for (const section of sections) {
    const built = isHomeSectionKind(section.kind) ? await homeSection(section as HomeSection, now) : await publicSection(section, images);
    if (built) out.push(built);
  }
  return { seoTitle: copy.seoTitle, seoDescription: copy.seoDescription, shareImage: imageOf(images, copy.shareImageAssetId, copy.title), updatedAt, sections: out };
}

/** `GET /api/storefront/v1/home`: the copy of the home page on the site, or 404 until it is published */
export async function publicHome(): Promise<StorefrontPublicHome> {
  const [row] = await orm.select().from(storefrontPages)
    .where(and(eq(storefrontPages.kind, 'home'), eq(storefrontPages.slug, HOME_PAGE_SLUG), eq(storefrontPages.isDeleted, 0), isNotNull(storefrontPages.published), isNotNull(storefrontPages.publishedAt)))
    .limit(1);
  if (!row?.published) throw notPublished();
  return homeForSite(row.published, isoOf(row.publishedAt ?? row.updatedAt));
}
