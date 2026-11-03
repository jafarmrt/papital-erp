import { redirect } from 'react-router';
import type { StorefrontPublicRedirect } from '@erp/storefront/storefrontSeoContracts';
import { campaignParams, isSafeSitePath, legacyFallback, legacyPathKey } from '@erp/storefront/storefrontSeoRules';
import { redirects } from './api.server';
import { categoryPath, collectionPath, productPath } from './brand';

/**
 * v11 phase 8.5: an address of the old WooCommerce site that no page of this site answers. A redirect the owner keeps in
 * the ERP («نشانی‌های سایت قبلی») is permanent (301), so search engines move the old page's standing to the new one; an
 * address in WooCommerce's shape that no redirect names gets the site's own guess, temporary (302), so a redirect added
 * later takes over at once. Campaign fields of the link (utm_…) go along, so an old Instagram link still counts.
 */
function pathOf(r: StorefrontPublicRedirect): string {
  if (r.kind === 'product') return productPath(r.target);
  if (r.kind === 'collection') return collectionPath(r.target);
  if (r.kind === 'category') return categoryPath(r.target);
  return r.target;
}

function withCampaign(path: string, search: string): string {
  const kept = campaignParams(search);
  if ([...kept].length === 0) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${kept.toString()}`;
}

/** The redirect of a request to an old address, or null when it is not one (the page's own 404 stays) */
export async function legacyRedirect(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const key = legacyPathKey(`${url.pathname}${url.search}`);
  if (!key) {
    // WordPress's search box: /?s=…
    const words = (url.searchParams.get('s') ?? '').trim().slice(0, 100);
    return url.pathname === '/' && words ? redirect(withCampaign(`/products?q=${encodeURIComponent(words)}`, url.search), 301) : null;
  }
  const listed = await redirects();
  let kept = listed.get(key);
  // a listed redirect to another listed old address is followed here, so the browser makes one hop and two rows that
  // name each other never loop (a cycle keeps the 404)
  const seen = new Set([key]);
  while (kept?.kind === 'path') {
    const next = legacyPathKey(kept.target);
    const further = next ? listed.get(next) : undefined;
    if (!next || !further) break;
    if (seen.has(next) || seen.size >= 5) return null;
    seen.add(next);
    kept = further;
  }
  const to = kept ? pathOf(kept) : legacyFallback(key);
  if (!to || !isSafeSitePath(to)) return null;
  // never back to the address asked for
  if (new URL(to, url).pathname === url.pathname) return null;
  return redirect(withCampaign(to, url.search), {
    status: kept ? 301 : 302,
    headers: { 'Cache-Control': kept ? 'public, max-age=3600' : 'no-store' },
  });
}
