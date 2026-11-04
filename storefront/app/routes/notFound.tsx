import type { Route } from './+types/notFound';
import { legacyRedirect } from '../lib/legacyRedirect.server';
import { campaigns, isCampaignSlug } from '../lib/api.server';
import { campaignPath } from '../lib/brand';
import { campaignParams } from '@erp/storefront/storefrontSeoRules';

/**
 * No page of the site: an old WooCommerce address goes to its new page (phase 8.5), a short address of a «صفحهٔ ویژه»
 * on the site now (/yalda, phase 8.5b) goes to the page, and anything else is the 404. The short address is temporary
 * (302): next year's page may have another address.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const moved = await legacyRedirect(request);
  if (moved) throw moved;
  const url = new URL(request.url);
  const short = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? '';
  if (short && isCampaignSlug(short) && (await campaigns()).some(c => c.slug === short)) {
    // the campaign fields of an Instagram or ad link (utm_…) go along
    const kept = campaignParams(url.search).toString();
    throw new Response(null, { status: 302, headers: { Location: kept ? `${campaignPath(short)}?${kept}` : campaignPath(short), 'Cache-Control': 'no-store' } });
  }
  throw new Response('پیدا نشد', { status: 404 });
}

export default function NotFound() {
  return null;
}
