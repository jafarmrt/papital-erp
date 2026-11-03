import { Link } from 'react-router';
import { ArrowLeft, Building2, Hand, Leaf, Truck } from 'lucide-react';
import type { Route } from './+types/home';
import { catalog, facets } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { BRAND, categoryPath, collectionPath, productPath } from '../lib/brand';
import { faNumber, formatPrice } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { whatsappLink } from '../lib/whatsapp';
import { ProductGrid, ProductImage } from '../components/ProductCard';
import { useRootData } from '../root';
import { homeLd } from '../lib/jsonLd';
import { JsonLdScripts } from '../components/JsonLdScripts';

export async function loader() {
  const f = await facets();
  // the owner's order (sort order in «فروشگاه سایت») picks what the home page leads with
  const [featured, newest, ...categoryCovers] = await Promise.all([
    catalog({ limit: 9 }),
    catalog({ sort: 'newest', limit: 8 }),
    ...f.categories.slice(0, 4).map(c => catalog({ category: c.name, limit: 1 })),
  ]);
  return {
    hero: featured.data[0] ?? null,
    featured: featured.data.slice(1, 9),
    newest: newest.data,
    categories: f.categories.slice(0, 4).map((c, i) => ({ ...c, cover: categoryCovers[i]?.data[0]?.cover ?? null })),
    collections: f.collections,
    siteUrl: siteEnv().siteUrl,
  };
}

export function meta({ data }: Route.MetaArgs) {
  return pageMeta({
    title: BRAND.fullName,
    description: 'گردنبند، گوشواره و ست هدیهٔ دست‌ساز با نقش کاشی‌کاری مسجدها و کاخ‌های ایران. قیمت روشن، ارسال به سراسر ایران، هدیهٔ سازمانی و خرید عمده.',
    path: '/',
    siteUrl: data?.siteUrl ?? '',
  });
}

function SectionTitle({ id, title, href, cta }: { id: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 id={id} className="text-xl font-extrabold lg:text-3xl">{title}</h2>
        <div className="tile-rule mt-2 w-20 lg:mt-3 lg:w-24" aria-hidden />
      </div>
      {href ? (
        <Link to={href} className="inline-flex min-h-11 items-center gap-1 font-medium text-brand hover:underline">
          {cta}<ArrowLeft className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { hero, featured, newest, categories, collections, siteUrl } = loaderData;
  const root = useRootData();
  return (
    <>
      <section className="border-b border-border bg-brand-soft">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-7 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
          <div>
            <p className="text-sm font-medium text-brand lg:text-base">ساخت دست، در کارگاه پاپیتال</p>
            <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-5xl lg:mt-3 lg:text-6xl">کاشی‌های ایران،<br />این بار برای پوشیدن</h1>
            <p className="mt-3 max-w-lg leading-8 text-muted-foreground lg:mt-5 lg:text-lg lg:leading-9">
              گردنبند و گوشواره با نقش کاشی‌کاری مسجدها و کاخ‌های ایران، بریده و لعاب‌خورده با دست.
            </p>
            <div className="mt-5 flex gap-3 lg:mt-8">
              <Link to="/products" className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-6 text-lg font-bold text-primary-foreground hover:bg-primary/90 sm:flex-none">
                دیدن همهٔ محصولات<ArrowLeft className="size-5" aria-hidden />
              </Link>
            </div>
          </div>
          {hero ? (
            <Link to={productPath(hero.slug)} className="group hidden lg:block">
              <figure className="relative overflow-hidden rounded-surface border border-border bg-card">
                <ProductImage image={hero.cover} eager sizes="600px" className="transition-transform duration-700 ease-motion group-hover:scale-[1.02]" />
                <figcaption className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-control bg-card/90 px-4 py-3 backdrop-blur">
                  <span className="line-clamp-1 font-medium">{hero.name}</span>
                  <span className="shrink-0 font-bold">{formatPrice(hero.retailPrice)}</span>
                </figcaption>
              </figure>
            </Link>
          ) : null}
        </div>
      </section>

      {categories.length ? (
        <section className="mx-auto max-w-7xl px-4 pt-10 lg:px-8 lg:pt-16" aria-labelledby="cats">
          <SectionTitle id="cats" title="خرید بر اساس دسته" />
          <ul className="scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:mt-8 lg:grid lg:grid-cols-4 lg:gap-5 lg:overflow-visible lg:px-0">
            {categories.map(c => (
              <li key={c.name} className="w-[36%] shrink-0 snap-start sm:w-[28%] lg:w-auto">
                <Link to={categoryPath(c.name)} className="group block">
                  <div className="overflow-hidden rounded-surface border border-border bg-card">
                    <ProductImage image={c.cover} eager sizes="(min-width: 1024px) 300px, 36vw" className="transition-transform duration-500 ease-motion group-hover:scale-[1.03]" />
                  </div>
                  <p className="mt-2 flex flex-col lg:mt-3 lg:flex-row lg:items-baseline lg:justify-between">
                    <span className="font-bold lg:text-lg">{c.name}</span>
                    <span className="text-xs text-muted-foreground lg:text-sm">{`${faNumber(c.count)} محصول`}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="چرا پاپیتال" className="mt-10 border-y border-border bg-muted lg:mt-16">
        <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-x-3 gap-y-3 px-4 py-4 text-xs leading-6 sm:text-sm lg:grid-cols-4 lg:py-6 lg:px-8">
          <li className="flex items-center gap-3"><Hand className="size-5 shrink-0 text-brand lg:size-6" strokeWidth={1.5} aria-hidden />ساخت دست، سری‌های کوچک</li>
          <li className="flex items-center gap-3"><Leaf className="size-5 shrink-0 text-brand lg:size-6" strokeWidth={1.5} aria-hidden />کاشی خاک‌پایه، بدون کوره</li>
          <li className="flex items-center gap-3"><Truck className="size-5 shrink-0 text-brand lg:size-6" strokeWidth={1.5} aria-hidden />
            {root?.freeShippingThreshold ? `ارسال رایگان از ${formatPrice(root.freeShippingThreshold)}` : 'ارسال به سراسر ایران'}
          </li>
          <li className="flex items-center gap-3"><Building2 className="size-5 shrink-0 text-brand lg:size-6" strokeWidth={1.5} aria-hidden />هدیهٔ سازمانی و خرید عمده</li>
        </ul>
      </section>

      {featured.length ? (
        <section className="mx-auto max-w-7xl px-4 pt-12 lg:px-8 lg:pt-20" aria-labelledby="featured">
          <SectionTitle id="featured" title="برگزیده‌های کارگاه" href="/products" cta="همهٔ محصولات" />
          <div className="mt-5 lg:mt-8"><ProductGrid products={featured} /></div>
        </section>
      ) : null}

      {collections.length ? (
        <section className="mt-12 bg-brand-soft lg:mt-20" aria-labelledby="collections">
          <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8 lg:py-14">
            <SectionTitle id="collections" title="کالکشن‌ها" />
            <p className="mt-4 max-w-2xl text-muted-foreground">هر کالکشن از یک نقش کاشی می‌آید؛ گردنبند، گوشواره و ست هم‌نقش را کنار هم ببینید.</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {collections.map(c => (
                <li key={c.name}>
                  <Link to={collectionPath(c.name)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand/20 bg-card px-5 font-medium hover:border-brand">
                    {c.name}<span className="text-sm text-muted-foreground">{faNumber(c.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {newest.length ? (
        <section className="mx-auto max-w-7xl px-4 pt-12 lg:px-8 lg:pt-20" aria-labelledby="newest">
          <SectionTitle id="newest" title="تازه‌های کارگاه" href="/products?sort=newest" cta="همهٔ تازه‌ها" />
          <div className="mt-5 lg:mt-8"><ProductGrid products={newest.slice(0, 4)} /></div>
        </section>
      ) : null}

      <section className="mx-auto max-w-7xl px-4 pt-12 lg:px-8 lg:pt-20" aria-labelledby="b2b">
        <div className="grid gap-6 rounded-surface bg-primary px-6 py-10 text-primary-foreground lg:grid-cols-3 lg:items-center lg:px-12 lg:py-14">
          <div className="lg:col-span-2">
            <h2 id="b2b" className="text-2xl font-extrabold lg:text-3xl">هدیهٔ سازمانی و خرید عمده</h2>
            <p className="mt-3 max-w-2xl leading-8 text-primary-foreground/80">
              برای هدیهٔ مناسبتی کارکنان و مشتریان، یا فروش در فروشگاه و گالری خودتان، با قیمت عمده و فاکتور رسمی سفارش بدهید.
            </p>
          </div>
          {root?.whatsapp ? (
            <a href={whatsappLink(root.whatsapp, 'سلام، دربارهٔ خرید سازمانی و عمده سؤال دارم.')} rel="noopener" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-primary-foreground px-6 text-lg font-bold text-primary">
              گفت‌وگو دربارهٔ سفارش<ArrowLeft className="size-5" aria-hidden />
            </a>
          ) : null}
        </div>
      </section>
      <JsonLdScripts blocks={homeLd(siteUrl, root?.logoUrl ?? '')} siteUrl={siteUrl} />
    </>
  );
}
