import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, TicketPercent } from 'lucide-react';
import type { Route } from './+types/campaign';
import { campaign } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { campaignPath, mediaPath } from '../lib/brand';
import { faDay } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { breadcrumbLd } from '../lib/jsonLd';
import { campaignParagraphs } from '@erp/storefront/storefrontCampaignRules';
import { ProductGrid } from '../components/ProductCard';
import { CampaignHeroImage } from '../components/CampaignHero';
import { JsonLdScripts } from '../components/JsonLdScripts';

/**
 * v11 phase 8.5b: one «صفحهٔ ویژه» (Yalda first), written in «فروشگاه سایت» of the ERP. It is a page only while it is on
 * and inside its days; before and after, its address is a 404 like any other. The text is plain: a blank line starts a
 * paragraph, and nothing in it is read as HTML.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const page = await campaign(params.slug);
  if (!page) throw new Response('پیدا نشد', { status: 404 });
  return { page, siteUrl: siteEnv().siteUrl };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { page, siteUrl } = data;
  return pageMeta({
    title: page.title,
    description: page.summary || `${page.title}: زیورآلات دست‌ساز پاپیتال با نقش کاشی‌های ایران.`,
    path: campaignPath(page.slug),
    image: page.hero ? mediaPath(page.hero.sha256) : undefined,
    siteUrl,
  });
}

function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <aside aria-label="کد تخفیف" className="mt-8 flex flex-col gap-3 rounded-surface border-2 border-dashed border-brand/40 bg-brand-soft p-4 sm:flex-row sm:items-center sm:justify-between lg:p-5">
      <p className="flex items-center gap-3">
        <TicketPercent className="size-6 shrink-0 text-brand" strokeWidth={1.5} aria-hidden />
        <span className="leading-7">
          هنگام ثبت سفارش این کد را بنویسید:
          <bdi dir="ltr" className="mt-1 block font-mono text-lg font-bold tracking-wider text-brand sm:ms-2 sm:mt-0 sm:inline">{code}</bdi>
        </span>
      </p>
      <button type="button" onClick={copy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-brand/30 bg-card px-4 font-medium hover:border-brand">
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'کپی شد' : 'کپی کد'}
      </button>
    </aside>
  );
}

export default function CampaignPage({ loaderData }: Route.ComponentProps) {
  const { page, siteUrl } = loaderData;
  const paragraphs = campaignParagraphs(page.body);
  const until = faDay(page.endsOn);
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 lg:px-8 lg:pt-10">
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">خانه</Link>
      </nav>
      {page.hero ? (
        <figure className="-mx-4 mt-4 overflow-hidden sm:mx-0 sm:rounded-surface sm:border sm:border-border">
          <CampaignHeroImage image={page.hero} eager sizes="(min-width: 1280px) 1216px, 100vw" />
        </figure>
      ) : null}
      <header className={`max-w-3xl ${page.hero ? 'mt-6 lg:mt-10' : 'mt-3'}`}>
        <h1 className="text-3xl font-extrabold leading-tight text-balance lg:text-5xl">{page.title}</h1>
        <div className="tile-rule mt-4 w-24" aria-hidden />
        {page.summary ? <p className="mt-4 text-lg leading-9 text-muted-foreground">{page.summary}</p> : null}
        {until ? <p className="mt-2 text-sm font-medium text-brand">{`تا پایان ${until}`}</p> : null}
      </header>
      {paragraphs.length ? (
        <div className="mt-6 max-w-3xl space-y-4 leading-9 lg:text-lg lg:leading-10">
          {paragraphs.map((lines, i) => (
            <p key={i}>{lines.map((line, j) => <span key={j}>{j > 0 ? <br /> : null}{line}</span>)}</p>
          ))}
        </div>
      ) : null}
      {page.discountCode ? <div className="max-w-3xl"><CodeBox code={page.discountCode} /></div> : null}
      <section className="pt-10 lg:pt-14" aria-labelledby="campaign-products">
        <h2 id="campaign-products" className="text-xl font-extrabold lg:text-3xl">محصولات این صفحه</h2>
        <div className="tile-rule mt-2 w-20 lg:mt-3 lg:w-24" aria-hidden />
        <div className="mt-5 lg:mt-8">
          {page.products.length
            ? <ProductGrid products={page.products} eagerCount={page.hero ? 0 : 2} />
            : <p className="text-muted-foreground">محصولات این صفحه به‌زودی می‌آیند. <Link to="/products" className="font-medium text-brand hover:underline">همهٔ محصولات</Link></p>}
        </div>
      </section>
      <JsonLdScripts blocks={[breadcrumbLd([{ name: 'خانه', path: '/' }, { name: page.title, path: campaignPath(page.slug) }], siteUrl)]} siteUrl={siteUrl} />
    </div>
  );
}
