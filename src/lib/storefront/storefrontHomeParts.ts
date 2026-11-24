import type { PageIcon, SectionBackground } from './storefrontPageParts.js';
import type { SiteLink } from './storefrontSiteLinks.js';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the parts only «صفحهٔ اصلی» takes. The home page is one
 * row of «صفحه‌های سایت» (kind 'home', made by migration 0036, never removed), written with the same builder and
 * published the same way; while it is not published the site keeps the home page in its own code. Nothing here reads
 * the database.
 *
 * Besides the parts every page takes, the home page takes: a slider and a banner (images of the library with a link
 * chosen as in the menus), «معرفی کالکشن» (the words of «کالکشن‌های سایت» with a few of its products), «تازه‌ترین خبرها»,
 * and the seven parts the site's own home page has today, each with its words here and its work in the site's code.
 * Every part of the home page can be switched off (`hidden`) without losing its words.
 */
export const HOME_PAGE_SLUG = 'fixed-home';
export const HOME_PAGE_TITLE = 'صفحهٔ اصلی';

export const HOME_SECTION_KINDS = [
  'slider', 'banner', 'collectionIntro', 'latestNews', 'homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeCollections', 'homeNewest', 'homeWholesale',
] as const;
export type HomeSectionKind = typeof HOME_SECTION_KINDS[number];
export const isHomeSectionKind = (value: unknown): value is HomeSectionKind => (HOME_SECTION_KINDS as readonly unknown[]).includes(value);

export const HOME_SECTION_KIND_TITLES: Readonly<Record<HomeSectionKind, string>> = {
  slider: 'اسلایدر',
  banner: 'بنر',
  collectionIntro: 'معرفی کالکشن',
  latestNews: 'تازه‌ترین خبرها',
  homeIntro: 'سربرگ صفحهٔ اصلی',
  homeCategories: 'خرید بر اساس دسته',
  homeWhy: 'چرا پاپیتال',
  homeFeatured: 'برگزیده‌های کارگاه',
  homeCollections: 'کالکشن‌ها',
  homeNewest: 'تازه‌های کارگاه',
  homeWholesale: 'هدیهٔ سازمانی و خرید عمده',
};
/** the parts whose look is the site's own: the ground chosen for a section is not theirs to take */
export const HOME_KINDS_WITH_BACKGROUND: readonly HomeSectionKind[] = ['collectionIntro', 'latestNews'];
/** the parts the home page takes once */
export const HOME_KINDS_ONCE: readonly HomeSectionKind[] = ['homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeCollections', 'homeNewest', 'homeWholesale', 'latestNews'];

export const SLIDES_MAX = 5;
export const SLIDE_TITLE_MAX = 80;
export const SLIDE_TEXT_MAX = 200;
export const HOME_KICKER_MAX = 80;
export const WHY_POINTS_MIN = 2;
export const WHY_POINTS_MAX = 4;
export const WHY_POINT_TEXT_MAX = 60;
/** how many products «معرفی کالکشن» shows, and how many news items «تازه‌ترین خبرها» */
export const COLLECTION_INTRO_PRODUCTS = 3;
export const LATEST_NEWS_COUNT = 3;

interface HomeBase { background: SectionBackground; hidden?: boolean }
export interface Slide {
  imageAssetId: number | null;
  /** another crop for a phone's upright screen; null = the same image */
  mobileImageAssetId: number | null;
  imageAlt: string;
  title: string;
  text: string;
  buttonLabel: string;
  link: SiteLink | null;
  /** the first and the last day the slide is shown (ISO `YYYY-MM-DD`, the shop's own day); '' = no bound */
  startsOn: string;
  endsOn: string;
}
export interface SliderSection extends HomeBase { kind: 'slider'; slides: Slide[] }
export interface BannerSection extends HomeBase { kind: 'banner'; imageAssetId: number | null; mobileImageAssetId: number | null; imageAlt: string; link: SiteLink | null }
export interface CollectionIntroSection extends HomeBase { kind: 'collectionIntro'; title: string; collection: string }
export interface LatestNewsSection extends HomeBase { kind: 'latestNews'; title: string }
export interface HomeIntroSection extends HomeBase { kind: 'homeIntro'; kicker: string; title: string; text: string; buttonLabel: string; buttonHref: string }
export interface HomeCategoriesSection extends HomeBase { kind: 'homeCategories'; title: string }
export interface WhyPoint { icon: PageIcon; text: string }
export interface HomeWhySection extends HomeBase { kind: 'homeWhy'; points: WhyPoint[] }
export interface HomeFeaturedSection extends HomeBase { kind: 'homeFeatured'; title: string; buttonLabel: string; buttonHref: string }
export interface HomeCollectionsSection extends HomeBase { kind: 'homeCollections'; title: string; text: string }
export interface HomeNewestSection extends HomeBase { kind: 'homeNewest'; title: string; buttonLabel: string; buttonHref: string }
export interface HomeWholesaleSection extends HomeBase {
  kind: 'homeWholesale'; title: string; text: string; buttonLabel: string; buttonHref: string; secondLabel: string; secondHref: string;
}
export type HomeSection =
  | SliderSection | BannerSection | CollectionIntroSection | LatestNewsSection | HomeIntroSection | HomeCategoriesSection | HomeWhySection
  | HomeFeaturedSection | HomeCollectionsSection | HomeNewestSection | HomeWholesaleSection;

export const emptySlide = (): Slide => ({ imageAssetId: null, mobileImageAssetId: null, imageAlt: '', title: '', text: '', buttonLabel: '', link: null, startsOn: '', endsOn: '' });

/**
 * A new part of the home page, as the builder adds it. The seven parts of the site's own home page start with the words
 * that page has today (`storefront/app/routes/home.tsx`), so adding one changes nothing a visitor reads.
 */
export function emptyHomeSection(kind: HomeSectionKind): HomeSection {
  const background: SectionBackground = 'white';
  switch (kind) {
    case 'slider': return { kind, background, slides: [emptySlide()] };
    case 'banner': return { kind, background, imageAssetId: null, mobileImageAssetId: null, imageAlt: '', link: null };
    case 'collectionIntro': return { kind, background: 'cream', title: '', collection: '' };
    case 'latestNews': return { kind, background, title: 'تازه‌ترین خبرها' };
    case 'homeIntro':
      return {
        kind, background, kicker: 'ساخت دست، در کارگاه پاپیتال', title: 'کاشی‌های ایران، این بار برای پوشیدن',
        text: 'گردنبند و گوشواره با نقش کاشی‌کاری مسجدها و کاخ‌های ایران، بریده و لعاب‌خورده با دست.', buttonLabel: 'دیدن همهٔ محصولات', buttonHref: '/products',
      };
    case 'homeCategories': return { kind, background, title: 'خرید بر اساس دسته' };
    case 'homeWhy':
      return {
        kind, background,
        points: [
          { icon: 'hand', text: 'ساخت دست، سری‌های کوچک' }, { icon: 'leaf', text: 'کاشی خاک‌پایه، بدون کوره' },
          // an empty «ارسال» point is written by the site: free delivery from the shop's own threshold, or delivery to all of Iran
          { icon: 'truck', text: '' }, { icon: 'building', text: 'هدیهٔ سازمانی و خرید عمده' },
        ],
      };
    case 'homeFeatured': return { kind, background, title: 'برگزیده‌های کارگاه', buttonLabel: 'همهٔ محصولات', buttonHref: '/products' };
    case 'homeCollections': return { kind, background, title: 'کالکشن‌ها', text: 'هر کالکشن از یک نقش کاشی می‌آید؛ گردنبند، گوشواره و ست هم‌نقش را کنار هم ببینید.' };
    case 'homeNewest': return { kind, background, title: 'تازه‌های کارگاه', buttonLabel: 'همهٔ تازه‌ها', buttonHref: '/products?sort=newest' };
    default:
      return {
        kind: 'homeWholesale', background, title: 'هدیهٔ سازمانی و خرید عمده',
        text: 'برای هدیهٔ مناسبتی همکاران و مشتریان، یا فروش در فروشگاه و گالری خودتان، با قیمت عمده و فاکتور رسمی سفارش بدهید.',
        buttonLabel: 'درخواست خرید عمده', buttonHref: '/wholesale', secondLabel: 'هدیهٔ سازمانی', secondHref: '/corporate-gift',
      };
  }
}

/** «شروع از صفحهٔ اصلی امروز»: the parts of the site's own home page, in its order, with its words */
export const TODAY_HOME_KINDS: readonly HomeSectionKind[] = ['homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeCollections', 'homeNewest', 'homeWholesale'];
export const todayHomeSections = (): HomeSection[] => TODAY_HOME_KINDS.map(emptyHomeSection);
