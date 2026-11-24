import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { Route } from './+types/home';
import { campaigns, home, seo } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { campaignPath, mediaPath } from '../lib/brand';
import { DEFAULT_SHOP } from '../lib/shopInfo';
import { faDay } from '../lib/format';
import { isTopPart, todayHome } from '../lib/home';
import { homeCatalog } from '../lib/homeData.server';
import { brandOf, pageMeta } from '../lib/meta';
import { CampaignHeroImage } from '../components/CampaignHero';
import { HomeSections } from '../components/home/HomeSections';
import { useRootData } from '../root';
import { homeLd } from '../lib/jsonLd';
import { JsonLdScripts } from '../components/JsonLdScripts';
import { legacyRedirect } from '../lib/legacyRedirect.server';
import { httpsSiteUrl } from '@erp/storefront/storefrontSeoRules';

export async function loader({ request }: Route.LoaderArgs) {
  // phase 8.5: WordPress finds a product, a page or a search by the home page's query (/?p=…, /?s=…)
  if (new URL(request.url).search) {
    const moved = await legacyRedirect(request);
    if (moved) throw moved;
  }
  const [seoSettings, pages, published] = await Promise.all([seo(), campaigns(), home()]);
  // v12 phase 10e: the home page the shop wrote and published in the ERP, else the site's own (the same seven parts)
  const all = published?.sections ?? todayHome();
  // phase 8.5b: a «صفحهٔ ویژه» that asks for the home page takes the top of it while it is on the site (the newest first):
  // it stands where the page's top part (the slider, or the opening words) was, which is then not sent to the browser at all
  const banner = pages.find(p => p.homeBanner) ?? null;
  const sections = banner && all.length > 0 && isTopPart(all[0]) ? all.slice(1) : all;
  return {
    sections, ...await homeCatalog(sections, all),
    seoTitle: published?.seoTitle ?? '', seoDescription: published?.seoDescription ?? '', shareImage: published?.shareImage ?? null,
    banner,
    siteUrl: siteEnv().siteUrl,
    alternateSiteUrl: seoSettings.alternateSiteUrl,
  };
}

export function meta({ data, matches }: Route.MetaArgs) {
  return pageMeta({
    matches,
    // the shop's own search title and description of its home page, when it wrote them
    title: data?.seoTitle ?? '',
    description: data?.seoDescription || 'گردنبند، گوشواره و ست هدیهٔ دست‌ساز با نقش کاشی‌کاری مسجدها و کاخ‌های ایران. قیمت روشن، ارسال به سراسر ایران، هدیهٔ سازمانی و خرید عمده.',
    path: '/',
    image: data?.shareImage ? mediaPath(data.shareImage.sha256) : undefined,
    siteUrl: data?.siteUrl ?? '',
  }).concat(languageAlternates(data?.siteUrl ?? '', data?.alternateSiteUrl ?? ''));
}

/** phase 8.5: the brand's site in another language, so each search engine shows its own reader the right one */
function languageAlternates(siteUrl: string, alternate: string): Array<Record<string, string>> {
  const other = httpsSiteUrl(alternate);
  if (!siteUrl || !other) return [];
  return [
    { tagName: 'link', rel: 'alternate', hrefLang: 'fa', href: `${siteUrl}/` },
    { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: `${other}/` },
  ];
}

/** phase 8.5b: the top of the home page while a «صفحهٔ ویژه» asks for it; the shop's own words come back when it ends */
function CampaignBanner({ banner }: { banner: NonNullable<Route.ComponentProps['loaderData']['banner']> }) {
  const until = faDay(banner.endsOn);
  return (
    <section className="border-b border-border bg-brand-soft" aria-labelledby="campaign-banner">
      <div className="mx-auto grid max-w-7xl items-center gap-6 px-4 py-7 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
        {banner.hero ? (
          <Link to={campaignPath(banner.slug)} className="-mx-4 block overflow-hidden sm:mx-0 sm:rounded-surface sm:border sm:border-border lg:order-last" tabIndex={-1} aria-hidden>
            <CampaignHeroImage image={banner.hero} eager sizes="(min-width: 1024px) 600px, 100vw" className="max-h-[40vh]" />
          </Link>
        ) : null}
        <div>
          {until ? <p className="text-sm font-medium text-brand lg:text-base">{`تا پایان ${until}`}</p> : null}
          <h1 id="campaign-banner" className="mt-2 text-3xl font-extrabold leading-tight text-balance sm:text-5xl lg:mt-3 lg:text-6xl">{banner.title}</h1>
          {banner.summary ? <p className="mt-3 max-w-lg leading-8 text-muted-foreground lg:mt-5 lg:text-lg lg:leading-9">{banner.summary}</p> : null}
          <div className="mt-5 flex flex-wrap gap-3 lg:mt-8">
            <Link to={campaignPath(banner.slug)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-6 text-lg font-bold text-primary-foreground hover:bg-primary/90 sm:flex-none">
              دیدن صفحه<ArrowLeft className="size-5" aria-hidden />
            </Link>
            <Link to="/products" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-brand/30 bg-card px-5 font-medium hover:border-brand">
              همهٔ محصولات
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home({ loaderData, matches }: Route.ComponentProps) {
  const { sections, banner, lead, featured, newest, categories, collections, siteUrl } = loaderData;
  const root = useRootData();
  return (
    <>
      <HomeSections
        sections={sections} shopName={brandOf(matches).fullName} top={banner ? <CampaignBanner banner={banner} /> : null}
        data={{ lead, featured, newest, categories, collections, freeShippingThreshold: root?.freeShippingThreshold ?? '', whatsapp: root?.whatsapp ?? '' }}
      />
      <JsonLdScripts blocks={homeLd(siteUrl, root?.logoUrl ?? '', root?.shop ?? DEFAULT_SHOP)} siteUrl={siteUrl} />
    </>
  );
}
