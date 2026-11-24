import type { Route } from './+types/pagePreview';
import { pagePreview } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { faDigits } from '../lib/format';
import { brandOf } from '../lib/meta';
import { PageMediaProvider, previewMediaPath } from '../lib/pageMedia';
import { shippingViewFor } from '../lib/pageView.server';
import { SitePageView } from '../components/SitePageView';
import { HomeSections } from '../components/home/HomeSections';
import { homeCatalog } from '../lib/homeData.server';
import { useRootData } from '../root';

/**
 * v12 phase 10c («پیش‌نمایش»): a page's saved draft as a visitor would see it, for the one-hour link a colleague made
 * in the ERP's «صفحه‌های سایت». The page is drawn by the same parts as a published one. It is not a page of the site:
 * no search engine may list it, nothing may keep it, the browser tells no other site where a click came from (the
 * key is in the address; `entry.server.tsx` writes the same headers when this page's read fails), and it is not in
 * the sitemap. An unknown or ended key is the same 404 as any address.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const found = await pagePreview(params.token);
  if (!found) throw new Response('پیدا نشد', { status: 404 });
  const ends = new Date(found.expiresAt);
  // the hour the link ends, on a Tehran clock, as the colleague reads it
  const endsAt = Number.isNaN(ends.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(ends);
  // v12 phase 10e: a draft of «صفحهٔ اصلی» is drawn as the home page, with what its parts read from the catalog
  const home = found.home ? { sections: found.home, ...await homeCatalog(found.home) } : null;
  return { page: found.page, home, endsAt, token: params.token, shipping: await shippingViewFor(found.page.sections), siteUrl: siteEnv().siteUrl };
}

/**
 * A preview and the rest of the site never share a document. A visit-statistics script that is already running in a
 * document reports every later change of its address by itself, so a preview reached by a move inside the site (a link
 * on a page, Back after such a move) would hand its key to that service. Coming here from another page of the site is
 * therefore a fresh load of the document (this never answers, so the move inside the site is never finished), and
 * leaving is one too (`PreviewLeaves` in `root.tsx`, which is there for the «پیدا نشد» of a preview as well). On a
 * first load this is not called: the server's answer is used. Anything that reads this page's data again inside the
 * document (a fetcher's submit, Back from a `#` link) comes here too and reloads the page once; a section that needs
 * a fetcher or a POST form on a preview has to take that into account.
 */
export function clientLoader({ params }: Route.ClientLoaderArgs): Promise<never> {
  // the page left behind may be kept by the browser as it is (back-forward cache) with this move still open: on its
  // return it is loaded again, so its progress bar does not stay
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); }, { once: true });
  window.location.assign(`/preview/${encodeURIComponent(params.token)}`);
  return new Promise<never>(() => undefined);
}

export const headers = () => ({
  'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
});

export function meta({ data, matches }: Route.MetaArgs) {
  const brand = brandOf(matches).fullName;
  return [
    { title: data ? `پیش‌نمایش: ${data.page.title} | ${brand}` : `پیش‌نمایش | ${brand}` },
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ];
}

export default function PagePreview({ loaderData, matches }: Route.ComponentProps) {
  const { page, home, endsAt, token, shipping, siteUrl } = loaderData;
  const root = useRootData();
  return (
    <>
      <p role="status" data-preview-note className="bg-primary px-4 py-3 text-center text-sm font-bold text-primary-foreground">
        {`پیش‌نمایش پیش‌نویس است و هنوز روی سایت نیست.${endsAt ? ` این نشانی تا ساعت ${faDigits(endsAt)} کار می‌کند.` : ''}`}
      </p>
      <PageMediaProvider value={previewMediaPath(token)}>
        {home ? (
          home.sections.length > 0
            ? <HomeSections sections={home.sections} shopName={brandOf(matches).fullName} data={{ lead: home.lead, featured: home.featured, newest: home.newest, categories: home.categories, collections: home.collections, freeShippingThreshold: root?.freeShippingThreshold ?? '', whatsapp: root?.whatsapp ?? '' }} />
            : <><h1 className="sr-only">{page.title}</h1><p className="mx-auto max-w-3xl px-4 py-16 text-center text-muted-foreground">این پیش‌نویس صفحهٔ اصلی امروز چیزی برای نشان دادن ندارد (بخش‌هایش خاموش‌اند یا روز اسلایدهایش نرسیده است).</p></>
        ) : <SitePageView page={page} shipping={shipping} siteUrl={siteUrl} preview />}
      </PageMediaProvider>
    </>
  );
}
