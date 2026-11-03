import { Link } from 'react-router';
import { MessageCircle, Truck, Hand, ShieldCheck } from 'lucide-react';
import type { Route } from './+types/product';
import { catalog, product as productBySlug } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { BRAND, categoryPath, collectionPath, mediaPath, productPath } from '../lib/brand';
import { faDigits, faNumber, priceUnit, tomanDigits } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { whatsappLink } from '../lib/whatsapp';
import type { StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import { ProductCard, ProductImage } from '../components/ProductCard';
import { StockBadge } from '../components/StockBadge';
import { useRootData } from '../root';
import { breadcrumbLd } from '../lib/jsonLd';
import { JsonLdScripts } from '../components/JsonLdScripts';

export async function loader({ params }: Route.LoaderArgs) {
  const item = await productBySlug(params.slug);
  if (!item) throw new Response('پیدا نشد', { status: 404 });
  // the row below leaves out the «از همین طرح» items, so it asks for that many more
  const limit = 9 + item.sameDesign.length;
  // the same collection, else the same category; an item with neither shows no «related» row
  const sameCollection = item.collections[0]
    ? await catalog({ collection: item.collections[0], limit })
    : item.category ? await catalog({ category: item.category, limit }) : { data: [] };
  return {
    item,
    // an item already shown as «از همین طرح» is not repeated in the row below it
    related: sameCollection.data.filter(p => p.slug !== item.slug && !item.sameDesign.some(t => t.slug === p.slug)).slice(0, 8),
    relatedTitle: item.collections[0] ? `دیگر قطعه‌های کالکشن ${item.collections[0]}` : `دیگر ${item.category}‌ها`,
    siteUrl: siteEnv().siteUrl,
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { item, siteUrl } = data;
  const description = item.seoDescription || `${item.name}، ساخت دست پاپیتال با نقش کاشی‌های ایران.`;
  return pageMeta({ title: item.seoTitle || item.name, description, path: productPath(item.slug), image: item.cover ? mediaPath(item.cover.sha256) : undefined, siteUrl });
}

function productJsonLd(item: Route.ComponentProps['loaderData']['item'], siteUrl: string) {
  const photos = item.images.length ? item.images : item.cover ? [item.cover] : [];
  const availability = item.stock.status === 'out' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.name,
    sku: item.sku,
    description: item.seoDescription || item.description.slice(0, 300),
    ...(photos.length ? { image: photos.map(i => `${siteUrl}${mediaPath(i.sha256)}`) } : {}),
    brand: { '@type': 'Brand', name: BRAND.fullName },
    offers: { '@type': 'Offer', priceCurrency: 'IRR', price: item.retailPrice, availability, url: `${siteUrl}${productPath(item.slug)}` },
  };
}

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { item, related, relatedTitle, siteUrl } = loaderData;
  const root = useRootData();
  const images = item.images.length ? item.images : item.cover ? [item.cover] : [];
  const details = [
    ['جنس', item.material],
    ['اندازه', item.size],
    ['رنگ', item.color],
    ['وزن', item.weightGrams ? `${faNumber(item.weightGrams)} گرم` : ''],
  ].filter(([, v]) => v);
  const out = item.stock.status === 'out';
  const orderText = `سلام، این محصول را می‌خواهم:\n${item.name} (کد ${item.sku})${siteUrl ? `\n${siteUrl}${productPath(item.slug)}` : ''}`;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 lg:px-8 lg:pt-10">
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">خانه</Link>
        <span className="mx-2" aria-hidden>/</span>
        {item.category ? <Link to={categoryPath(item.category)} className="hover:text-foreground">{item.category}</Link> : <Link to="/products">محصولات</Link>}
      </nav>

      <div className="mt-4 grid gap-8 lg:mt-6 lg:grid-cols-12 lg:gap-12">
        <section aria-label="تصویرهای محصول" className="lg:col-span-7">
          <ul className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible lg:px-0">
            {images.map((image, i) => (
              <li key={image.sha256} className={`w-[86%] shrink-0 snap-center sm:w-[60%] lg:w-auto ${i === 0 ? 'lg:col-span-2' : ''}`}>
                <div className="overflow-hidden rounded-surface border border-border bg-card">
                  <ProductImage image={image} eager={i === 0} sizes={i === 0 ? '(min-width: 1024px) 680px, 86vw' : '(min-width: 1024px) 330px, 86vw'} />
                </div>
              </li>
            ))}
          </ul>
          {images.length > 1 ? <p className="mt-2 text-center text-sm text-muted-foreground lg:hidden">{`${faNumber(images.length)} تصویر، برای دیدن بقیه بکشید`}</p> : null}
        </section>

        <section className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            {item.collections.length ? (
              <p className="flex flex-wrap gap-2 text-sm">
                {item.collections.map(c => <Link key={c} to={collectionPath(c)} className="font-medium text-brand hover:underline">کالکشن {c}</Link>)}
              </p>
            ) : null}
            <h1 className="mt-2 text-2xl font-extrabold leading-tight lg:text-3xl">{item.name}</h1>

            <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p className="text-3xl font-extrabold lg:text-4xl" aria-label={`قیمت ${tomanDigits(item.retailPrice)} ${priceUnit(item.retailPrice)}`}>
                {tomanDigits(item.retailPrice)}
                <span className="ms-1.5 text-base font-medium text-muted-foreground">{priceUnit(item.retailPrice)}</span>
              </p>
              <StockBadge stock={item.stock} className="mb-1.5" />
            </div>

            <div className="mt-6 space-y-3">
              {root?.whatsapp ? (
                <a
                  // out of stock: no address, so neither a tap nor the keyboard opens the chat
                  href={out ? undefined : whatsappLink(root.whatsapp, orderText)}
                  rel="noopener"
                  aria-disabled={out || undefined}
                  className={`flex min-h-13 w-full items-center justify-center gap-2 rounded-control px-6 text-lg font-bold transition-colors duration-(--motion) ${out ? 'pointer-events-none bg-muted text-muted-foreground' : 'bg-brand text-brand-foreground hover:bg-brand/90'}`}
                >
                  <MessageCircle className="size-5" strokeWidth={2} aria-hidden />
                  {out ? 'فعلاً ناموجود' : 'سفارش در واتس‌اپ'}
                </a>
              ) : null}
              <p className="text-sm text-muted-foreground">کد کالا: <bdi dir="ltr" className="font-medium text-foreground">{item.sku}</bdi></p>
            </div>

            <ul className="mt-6 grid gap-3 border-y border-border py-5 text-sm">
              <li className="flex items-center gap-3"><Hand className="size-5 text-brand" strokeWidth={1.75} aria-hidden />ساخت دست در کارگاه پاپیتال؛ هر قطعه کمی با دیگری فرق دارد.</li>
              {root?.shippingTitles.length ? (
                <li className="flex items-center gap-3"><Truck className="size-5 text-brand" strokeWidth={1.75} aria-hidden />ارسال با {root.shippingTitles.join('، ')}</li>
              ) : null}
              <li className="flex items-center gap-3"><ShieldCheck className="size-5 text-brand" strokeWidth={1.75} aria-hidden />پرداخت کارت‌به‌کارت با تأیید سفارش از سوی فروشگاه</li>
            </ul>

            {details.length ? (
              <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                {details.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{faDigits(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {item.description ? (
              <div className="mt-8 space-y-4 leading-8 text-foreground/90">
                <h2 className="text-lg font-bold">دربارهٔ این قطعه</h2>
                {item.description.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {item.sameDesign.length ? (
        <ProductRow id="same-design" title="از همین طرح" note="همین نقش، روی قطعه‌های دیگر" products={item.sameDesign} />
      ) : null}

      {related.length ? <ProductRow id="related" title={relatedTitle} products={related} /> : null}

      <JsonLdScripts
        siteUrl={siteUrl}
        blocks={[
          productJsonLd(item, siteUrl),
          breadcrumbLd([
            { name: 'خانه', path: '/' },
            item.category ? { name: item.category, path: categoryPath(item.category) } : { name: 'محصولات', path: '/products' },
            { name: item.name },
          ], siteUrl),
        ]}
      />
    </div>
  );
}

/** A row of cards: a swipe strip on phones, a grid of four on a wide screen */
function ProductRow({ id, title, note, products }: { id: string; title: string; note?: string; products: StorefrontProductCard[] }) {
  return (
    <section className="mt-20" aria-labelledby={id}>
      <h2 id={id} className="text-xl font-extrabold lg:text-2xl">{title}</h2>
      {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
      <div className="tile-rule mt-3 w-24" aria-hidden />
      <ul className="scrollbar-none -mx-4 mt-6 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0">
        {products.map(p => <li key={p.slug} className="w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-auto"><ProductCard product={p} /></li>)}
      </ul>
    </section>
  );
}
