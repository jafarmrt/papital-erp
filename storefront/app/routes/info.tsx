import { Link } from 'react-router';
import type { Route } from './+types/info';
import { publicSettings } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { BRAND } from '../lib/brand';
import { faNumber, formatPrice } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { breadcrumbLd } from '../lib/jsonLd';
import { whatsappLink } from '../lib/whatsapp';
import { INFO_PAGES, infoPage } from '../content/pages';
import { JsonLdScripts } from '../components/JsonLdScripts';
import { useRootData } from '../root';

/**
 * About, contact, shipping, terms and privacy share this page (`routes.ts` gives each its own address). The shipping
 * page is written from the live settings of the ERP, so a method switched off there never shows here.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const page = infoPage(new URL(request.url).pathname.replace(/^\/+|\/+$/g, ''));
  if (!page) throw new Response('پیدا نشد', { status: 404 });
  const settings = page.slug === 'shipping' ? await publicSettings() : null;
  return {
    page,
    shipping: settings
      ? {
          methods: settings.shippingMethods.map(m => ({ title: m.title, description: m.description, cost: shippingCost(m.pricing, m.flatRate), free: m.isFreeShippingEligible })),
          freeShippingThreshold: settings.freeShippingThreshold,
          reservationHours: settings.reservationHours,
        }
      : null,
    siteUrl: siteEnv().siteUrl,
  };
}

/** What a buyer pays for one method, in their words (never the rate table itself, which the checkout works out) */
function shippingCost(pricing: string, flatRate: string): string {
  switch (pricing) {
    case 'flat': return /^[1-9]\d*$/.test(flatRate) ? `هزینهٔ ارسال ${formatPrice(flatRate)}` : 'بدون هزینهٔ ارسال';
    case 'table': return 'هزینه به وزن بسته و استان مقصد بستگی دارد و هنگام ثبت سفارش نشان داده می‌شود.';
    case 'on_delivery': return 'هزینهٔ ارسال را هنگام تحویل به پیک می‌پردازید.';
    case 'free': return 'بدون هزینهٔ ارسال';
    default: return '';
  }
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  return pageMeta({ title: data.page.title, description: data.page.description, path: `/${data.page.slug}`, siteUrl: data.siteUrl });
}

export default function InfoPage({ loaderData }: Route.ComponentProps) {
  const { page, shipping, siteUrl } = loaderData;
  const root = useRootData();
  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 lg:px-8 lg:pt-12">
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">خانه</Link>
      </nav>
      <h1 className="mt-3 text-3xl font-extrabold text-balance lg:text-4xl">{page.title}</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />
      {page.draft ? (
        <p className="mt-6 rounded-control border border-border bg-card px-4 py-3 text-sm text-muted-foreground" role="note">
          متن این صفحه پیش‌نویس است و پیش از راه‌اندازی سایت کامل می‌شود.
        </p>
      ) : null}

      <div className="mt-8 space-y-10 leading-8 text-foreground/90">
        {page.sections.map((section, i) => (
          <section key={i} className="space-y-4">
            {section.heading ? <h2 className="text-lg font-bold text-foreground">{section.heading}</h2> : null}
            {section.paragraphs.map((p, j) => <p key={j}>{p}</p>)}
          </section>
        ))}

        {page.slug === 'contact' ? (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">راه‌های گفت‌وگو</h2>
            <ul className="space-y-3">
              {root?.whatsapp ? (
                <li><a href={whatsappLink(root.whatsapp)} rel="noopener" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">گفت‌وگو در واتس‌اپ</a></li>
              ) : null}
              <li>
                <a href={BRAND.instagram} rel="noopener" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
                  اینستاگرام <span dir="ltr" className="ms-1">@{BRAND.instagramHandle}</span>
                </a>
              </li>
            </ul>
          </section>
        ) : null}

        {shipping ? (
          <>
            <section className="space-y-4" aria-labelledby="methods">
              <h2 id="methods" className="text-lg font-bold text-foreground">روش‌های ارسال</h2>
              {shipping.methods.length ? (
                <ul className="divide-y divide-border rounded-surface border border-border bg-card">
                  {shipping.methods.map(m => (
                    <li key={m.title} className="space-y-1 px-4 py-4">
                      <p className="font-bold text-foreground">{m.title}</p>
                      {m.description ? <p className="text-muted-foreground">{m.description}</p> : null}
                      {m.cost ? <p>{m.cost}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : <p>روش‌های ارسال به‌زودی همین‌جا نوشته می‌شوند.</p>}
              {/^[1-9]\d*$/.test(shipping.freeShippingThreshold) && shipping.methods.some(m => m.free) ? (
                <p>برای خرید از {formatPrice(shipping.freeShippingThreshold)} به بالا، ارسال با {shipping.methods.filter(m => m.free).map(m => m.title).join('، ')} رایگان است.</p>
              ) : null}
            </section>
            <section className="space-y-4" aria-labelledby="payment">
              <h2 id="payment" className="text-lg font-bold text-foreground">پرداخت</h2>
              <p>پرداخت کارت‌به‌کارت است. شمارهٔ کارت پس از ثبت سفارش نشان داده می‌شود و رسید واریز را برای فروشگاه می‌فرستید.</p>
              <p>کالاهای سفارش تا {faNumber(shipping.reservationHours)} ساعت برای شما کنار گذاشته می‌شوند. اگر رسیدی در این مدت نرسد، سفارش خودبه‌خود لغو می‌شود.</p>
              <p>هدیهٔ سازمانی و خرید عمده با فاکتور رسمی انجام می‌شود.</p>
            </section>
          </>
        ) : null}
      </div>

      <nav aria-label="صفحه‌های دیگر" className="mt-16 border-t border-border pt-6">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {INFO_PAGES.filter(p => p.slug !== page.slug).map(p => (
            <li key={p.slug}><Link to={`/${p.slug}`} className="inline-flex min-h-10 items-center text-muted-foreground hover:text-foreground">{p.title}</Link></li>
          ))}
        </ul>
      </nav>

      <JsonLdScripts blocks={[breadcrumbLd([{ name: 'خانه', path: '/' }, { name: page.title }], siteUrl)]} siteUrl={siteUrl} />
    </div>
  );
}
