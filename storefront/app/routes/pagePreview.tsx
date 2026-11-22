import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import type { Route } from './+types/pagePreview';
import { pagePreview } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { faDigits } from '../lib/format';
import { brandOf } from '../lib/meta';
import { PageMediaProvider, previewMediaPath } from '../lib/pageMedia';
import { shippingViewFor } from '../lib/pageView.server';
import { SitePageView } from '../components/SitePageView';

/**
 * v12 phase 10c («پیش‌نمایش»): a page's saved draft as a visitor would see it, for the one-hour link a colleague made
 * in the ERP's «صفحه‌های سایت». The page is drawn by the same parts as a published one. It is not a page of the site:
 * no search engine may list it, nothing may keep it, the browser tells no other site where a click came from (the
 * key is in the address), and it is not in the sitemap. An unknown or ended key is the same 404 as any address.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const found = await pagePreview(params.token);
  if (!found) throw new Response('پیدا نشد', { status: 404 });
  const ends = new Date(found.expiresAt);
  // the hour the link ends, on a Tehran clock, as the colleague reads it
  const endsAt = Number.isNaN(ends.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(ends);
  return { page: found.page, endsAt, token: params.token, shipping: await shippingViewFor(found.page.sections), siteUrl: siteEnv().siteUrl };
}

/**
 * A preview and the rest of the site never share a document. A visit-statistics script that is already running in a
 * document reports every later change of its address by itself, so a preview reached by a move inside the site (a link
 * on a page, Back after such a move) would hand its key to that service. Coming here from another page of the site is
 * therefore a fresh load of the document (this never answers, so the move inside the site is never finished), and
 * leaving is one too (the component below). On a first load this is not called: the server's answer is used.
 */
export function clientLoader({ params }: Route.ClientLoaderArgs): Promise<never> {
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

export default function PagePreview({ loaderData }: Route.ComponentProps) {
  const { page, endsAt, token, shipping, siteUrl } = loaderData;
  // leaving for another page of the site is a fresh load of that page, never a move inside this document (see `clientLoader`)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => nextLocation.pathname !== currentLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') window.location.assign(`${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`);
  }, [blocker]);
  return (
    <>
      <p role="status" data-preview-note className="bg-primary px-4 py-3 text-center text-sm font-bold text-primary-foreground">
        {`پیش‌نمایش پیش‌نویس است و هنوز روی سایت نیست.${endsAt ? ` این نشانی تا ساعت ${faDigits(endsAt)} کار می‌کند.` : ''}`}
      </p>
      <PageMediaProvider value={previewMediaPath(token)}>
        <SitePageView page={page} shipping={shipping} siteUrl={siteUrl} preview />
      </PageMediaProvider>
    </>
  );
}
