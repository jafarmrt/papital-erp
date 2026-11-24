import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { StorefrontFacet, StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import type { SectionBackground } from '@erp/storefront/storefrontPageParts';
import type { SiteHomeOwnSection, SiteHomeSection } from '../../lib/home';
import { collectionPath } from '../../lib/brand';
import { faFullDay } from '../../lib/format';
import { NEWS_PATH, newsPath } from '../../lib/news';
import type { SitePageSection } from '../../lib/pages';
import { NewsCover } from '../NewsCover';
import { PageSections } from '../PageSections';
import { ProductGrid } from '../ProductCard';
import { HomeCategories, HomeCollections, HomeIntro, HomeProducts, HomeWholesale, HomeWhy, SectionTitle, type HomeCategory } from './HomeParts';
import { HomeBanner, HomeSlider } from './HomeSlider';

/**
 * v12 phase 10e: the parts of the home page, top to bottom, as the shop ordered them in the ERP (or, until it publishes
 * a home page, the site's own seven). The page has one `<h1>`: the words of its top part (the opening words, or the
 * first slide's title), else the shop's name, unseen, so the page still has one for a screen reader and a search engine.
 * `top` is what stands above the parts while a «صفحهٔ ویژه» asks for the home page (the route leaves the page's own top
 * part out then).
 */
export interface HomeData {
  /** the product beside the opening words, the row of the shop's own first products, the newest, the first categories with a cover each, and the collections */
  lead: StorefrontProductCard | null;
  featured: StorefrontProductCard[];
  newest: StorefrontProductCard[];
  categories: HomeCategory[];
  collections: StorefrontFacet[];
  freeShippingThreshold: string;
  whatsapp: string;
}

const GROUNDS: Readonly<Record<SectionBackground, string>> = { white: '', cream: 'bg-brand-soft', brand: 'bg-brand-soft', dark: 'bg-muted' };
const OWN_KINDS = ['slider', 'banner', 'collectionIntro', 'latestNews', 'homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeNewest', 'homeCollections', 'homeWholesale'];
const isOwn = (part: SiteHomeSection): part is SiteHomeOwnSection => OWN_KINDS.includes(part.kind);

function CollectionIntroPart({ part }: { part: Extract<SiteHomeOwnSection, { kind: 'collectionIntro' }> }) {
  const id = `collection-${part.products[0]?.slug ?? 'intro'}`;
  return (
    <section className={`mt-12 lg:mt-20 ${GROUNDS[part.background]}`} aria-labelledby={id} data-home-part="collectionIntro">
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8 lg:py-14">
        <SectionTitle id={id} title={part.title || `کالکشن ${part.collection}`} href={collectionPath(part.collection)} cta="همهٔ این کالکشن" />
        <div className={`mt-6 grid grid-cols-1 gap-6 ${part.image && part.paragraphs.length ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-center lg:gap-10' : ''}`}>
          {part.paragraphs.length ? (
            <div className="min-w-0 max-w-3xl space-y-4 text-lg leading-9 text-muted-foreground">
              {part.paragraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-line break-words">{paragraph}</p>)}
              {part.moreHref ? (
                <p><Link to={part.moreHref} className="inline-flex min-h-11 items-center gap-1 font-medium text-brand underline-offset-4 hover:underline">آشنایی بیشتر<ArrowLeft className="size-4" aria-hidden /></Link></p>
              ) : null}
            </div>
          ) : null}
          {part.image ? (
            <div className="min-w-0 overflow-hidden rounded-surface bg-muted">
              {/* the collection's own image is on the site (not a draft's), so it is read from the site's image route even in a preview */}
              <NewsCover image={part.image} sizes="(min-width: 1024px) 40vw, 100vw" className="h-auto w-full" />
            </div>
          ) : null}
        </div>
        <div className="mt-8"><ProductGrid products={part.products} /></div>
      </div>
    </section>
  );
}

function LatestNewsPart({ part }: { part: Extract<SiteHomeOwnSection, { kind: 'latestNews' }> }) {
  return (
    <section className={`mt-12 lg:mt-20 ${GROUNDS[part.background]}`} aria-labelledby="latest-news" data-home-part="latestNews">
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8 lg:py-14">
        <SectionTitle id="latest-news" title={part.title || 'تازه‌ترین خبرها'} href={NEWS_PATH} cta="همهٔ خبرها" />
        <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {part.items.map(item => (
            <li key={item.slug} className="min-w-0">
              <article className="flex h-full flex-col overflow-hidden rounded-surface border border-border bg-card">
                {item.cover ? (
                  <Link to={newsPath(item.slug)} tabIndex={-1} aria-hidden className="block aspect-[16/10] overflow-hidden bg-muted">
                    <NewsCover image={{ ...item.cover, alt: '' }} sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" className="size-full object-cover" />
                  </Link>
                ) : null}
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-sm text-muted-foreground"><time dateTime={item.date}>{faFullDay(item.date)}</time></p>
                  <h3 className="mt-1 text-lg font-bold leading-8 break-words"><Link to={newsPath(item.slug)} className="hover:text-brand">{item.title}</Link></h3>
                  {item.summary ? <p className="mt-2 line-clamp-3 leading-7 text-muted-foreground break-words">{item.summary}</p> : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ownPart(part: SiteHomeOwnSection, data: HomeData, heading: boolean): ReactNode {
  switch (part.kind) {
    case 'slider': return <HomeSlider slides={part.slides} heading={heading} />;
    case 'banner': return <HomeBanner image={part.image} mobileImage={part.mobileImage} href={part.href} external={part.external} />;
    case 'collectionIntro': return <CollectionIntroPart part={part} />;
    case 'latestNews': return <LatestNewsPart part={part} />;
    case 'homeIntro': return <HomeIntro part={part} product={data.lead} heading={heading} />;
    case 'homeCategories': return <HomeCategories part={part} categories={data.categories} />;
    case 'homeWhy': return <HomeWhy part={part} freeShippingThreshold={data.freeShippingThreshold} />;
    // the first product stands beside the opening words, so the row starts from the second, as it always has
    case 'homeFeatured': return <HomeProducts part={part} products={data.featured} />;
    case 'homeNewest': return <HomeProducts part={part} products={data.newest.slice(0, 4)} />;
    case 'homeCollections': return <HomeCollections part={part} collections={data.collections} />;
    default: return <HomeWholesale part={part} whatsapp={data.whatsapp} />;
  }
}

/** whether a part gives the page its `<h1>` */
const titles = (part: SiteHomeSection): boolean => part.kind === 'homeIntro' || (part.kind === 'slider' && Boolean(part.slides[0]?.title));

export function HomeSections({ sections, data, top = null, shopName }: {
  sections: readonly SiteHomeSection[]; data: HomeData; shopName: string;
  /** a «صفحهٔ ویژه» that asks for the top of the home page (it writes the page's `<h1>` itself) */
  top?: ReactNode;
}) {
  const parts = sections;
  const headingAt = top ? -1 : parts.findIndex(titles);
  // parts of every page that follow one another are drawn together, by the page's own code
  const runs: Array<{ own: SiteHomeOwnSection; index: number } | { common: SitePageSection[] }> = [];
  parts.forEach((part, index) => {
    const last = runs[runs.length - 1];
    if (isOwn(part)) runs.push({ own: part, index });
    else if (last && 'common' in last) last.common.push(part);
    else runs.push({ common: [part] });
  });
  return (
    <>
      {top}
      {!top && headingAt < 0 ? <h1 className="sr-only">{shopName}</h1> : null}
      {runs.map((run, i) => ('own' in run
        ? <div key={i} className="contents">{ownPart(run.own, data, run.index === headingAt)}</div>
        : <div key={i} className="mt-12 lg:mt-20" data-home-part="page"><PageSections sections={run.common} shipping={null} header={null} keepHeader /></div>))}
    </>
  );
}
