import type { Route } from './+types/page';
import { page } from '../lib/api.server';
import { legacyRedirect } from '../lib/legacyRedirect.server';
import { siteEnv } from '../lib/site.server';
import { sitePageMeta } from '../lib/meta';
import { shippingViewFor } from '../lib/pageView.server';
import { SitePageView } from '../components/SitePageView';

/**
 * v12 phase 10c: a page the shop made in the ERP's «صفحه‌های سایت», at `/pages/<its address>`. It is a page only while
 * it is published; before and after, its address is a 404 like any other. The five base pages keep their own addresses
 * (`/about` …), so `/pages/about` is not a second address for one of them.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const found = await page(params.slug);
  if (!found || found.kind !== 'custom') {
    // the address of a page that moved is kept in the ERP's «نشانی‌های سایت قبلی» and goes to the page's address of now (301)
    const moved = await legacyRedirect(request);
    if (moved) throw moved;
    throw new Response('پیدا نشد', { status: 404 });
  }
  return { page: found, shipping: await shippingViewFor(found.sections), siteUrl: siteEnv().siteUrl };
}

export function meta({ data, matches }: Route.MetaArgs) {
  if (!data) return [];
  return sitePageMeta(data.page, data.siteUrl, matches);
}

export default function CustomPage({ loaderData }: Route.ComponentProps) {
  return <SitePageView page={loaderData.page} shipping={loaderData.shipping} siteUrl={loaderData.siteUrl} />;
}
