import { Link } from 'react-router';
import type { Route } from './+types/info';
import { page } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { faDigits, faNumber } from '../lib/format';
import { DEFAULT_SHOP } from '../lib/shopInfo';
import { pageMeta, sitePageMeta } from '../lib/meta';
import { breadcrumbLd } from '../lib/jsonLd';
import { whatsappLink } from '../lib/whatsapp';
import { INFO_PAGES, infoPage } from '../content/pages';
import { JsonLdScripts } from '../components/JsonLdScripts';
import { ShippingMethodsList } from '../components/PageSections';
import { SitePageView } from '../components/SitePageView';
import { shippingView, shippingViewFor } from '../lib/pageView.server';
import { useRootData } from '../root';

/**
 * About, contact, shipping, terms and privacy share this page (`routes.ts` gives each its own address).
 * v12 phase 10c: once the owner publishes one of them in the ERP's «صفحه‌های سایت», the site draws that copy; until then
 * (and whenever the ERP cannot be read) the address shows the text the site always had (`content/pages.ts`). The fixed
 * shipping page is written from the live settings of the ERP, so a method switched off there never shows here.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const fixed = infoPage(new URL(request.url).pathname.replace(/^\/+|\/+$/g, ''));
  if (!fixed) throw new Response('پیدا نشد', { status: 404 });
  const { siteUrl } = siteEnv();
  const published = await page(fixed.slug, { fallback: true });
  if (published?.kind === 'base') return { published, publishedShipping: await shippingViewFor(published.sections), page: null, shipping: null, siteUrl };
  return { published: null, publishedShipping: null, page: fixed, shipping: fixed.slug === 'shipping' ? await shippingView() : null, siteUrl };
}

export function meta({ data, matches }: Route.MetaArgs) {
  if (!data) return [];
  if (data.published) return sitePageMeta(data.published, data.siteUrl, matches);
  if (!data.page) return [];
  return pageMeta({ matches, title: data.page.title, description: data.page.description, path: `/${data.page.slug}`, siteUrl: data.siteUrl });
}

export default function InfoPage({ loaderData }: Route.ComponentProps) {
  const { page, shipping, siteUrl, published, publishedShipping } = loaderData;
  const root = useRootData();
  if (published) return <SitePageView page={published} shipping={publishedShipping} siteUrl={siteUrl} />;
  // the fixed text is sent only while it is the page (a published copy sends none of it)
  if (!page) return null;
  const shop = root?.shop ?? DEFAULT_SHOP;
  const { address, postalCode, phone, mobile, email, hours } = shop.contact;
  const contactLink = 'inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline';
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
          <>
            {/* v12 phase 10a: the address and contact details of the ERP's «اطلاعات فروشگاه»; nothing while none is written */}
            {address || postalCode || phone || mobile || email || hours ? (
              <section className="space-y-4" aria-labelledby="shop-contact" data-shop-contact>
                <h2 id="shop-contact" className="text-lg font-bold text-foreground">نشانی و تماس</h2>
                <dl className="divide-y divide-border rounded-surface border border-border bg-card">
                  {address ? (
                    <div className="px-4 py-3"><dt className="text-sm text-muted-foreground">نشانی</dt><dd>{address}{postalCode ? <>، کد پستی <span dir="ltr">{faDigits(postalCode)}</span></> : null}</dd></div>
                  ) : postalCode ? (
                    <div className="px-4 py-3"><dt className="text-sm text-muted-foreground">کد پستی</dt><dd dir="ltr" className="text-end">{faDigits(postalCode)}</dd></div>
                  ) : null}
                  {phone ? (
                    <div className="px-4 py-3"><dt className="text-sm text-muted-foreground">تلفن</dt><dd><a href={`tel:${phone}`} dir="ltr" className={contactLink}>{faDigits(phone)}</a></dd></div>
                  ) : null}
                  {mobile ? (
                    <div className="px-4 py-3"><dt className="text-sm text-muted-foreground">همراه</dt><dd><a href={`tel:${mobile}`} dir="ltr" className={contactLink}>{faDigits(mobile)}</a></dd></div>
                  ) : null}
                  {email ? (
                    <div className="px-4 py-3"><dt className="text-sm text-muted-foreground">ایمیل</dt><dd><a href={`mailto:${email}`} dir="ltr" className={`${contactLink} break-all`}>{email}</a></dd></div>
                  ) : null}
                  {hours ? (
                    <div className="px-4 py-3"><dt className="text-sm text-muted-foreground">ساعت پاسخ‌گویی</dt><dd>{hours}</dd></div>
                  ) : null}
                </dl>
              </section>
            ) : null}
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">راه‌های گفت‌وگو</h2>
              <ul className="space-y-3">
                {root?.whatsapp ? (
                  <li><a href={whatsappLink(root.whatsapp)} rel="noopener" className={contactLink}>گفت‌وگو در واتس‌اپ</a></li>
                ) : null}
                {shop.social.map(social => (
                  <li key={social.name}>
                    <a href={social.href} rel="noopener" className={contactLink}>
                      {social.name === 'instagram' && shop.instagramHandle ? <>{`${social.title} `}<span dir="ltr" className="ms-1">@{shop.instagramHandle}</span></> : social.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {shipping ? (
          <>
            <section className="space-y-4" aria-labelledby="methods">
              <h2 id="methods" className="text-lg font-bold text-foreground">روش‌های ارسال</h2>
              <ShippingMethodsList shipping={shipping} />
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
