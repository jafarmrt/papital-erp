import type { StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import { campaigns, catalog, facets, pages as sitePages } from '../lib/api.server';
import { lastModOf, pagePath } from '../lib/pages';
import { siteEnv } from '../lib/site.server';
import { campaignPath, categoryPath, collectionPath, mediaPath, productPath } from '../lib/brand';
import { INFO_PAGES } from '../content/pages';

/** The ERP answers at most this many cards a page (CATALOG_PAGE_MAX); a shop of a few hundred items is a few calls */
const PAGE = 60;
const MAX_PAGES = 50;

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function everyProduct(): Promise<StorefrontProductCard[]> {
  const all: StorefrontProductCard[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await catalog({ page, limit: PAGE });
    all.push(...result.data);
    if (page * PAGE >= result.total || result.data.length === 0) break;
  }
  return all;
}

/** Every page a buyer can reach, with each product's cover photo (Google's image extension); none while not indexable */
export async function loader() {
  const { siteUrl, indexable } = siteEnv();
  if (!indexable) throw new Response('پیدا نشد', { status: 404 });
  const [f, products, pages, written] = await Promise.all([facets(), everyProduct(), campaigns(), sitePages()]);
  // v12 phase 10c: a page published in the ERP's «صفحه‌های سایت» carries the day it was published (`lastmod`), and one
  // marked «در موتور جست‌وجو نیاید» is not in the map at all (also when it is one of the five base pages)
  const lastmod = (iso: string) => (lastModOf(iso) ? `<lastmod>${lastModOf(iso)}</lastmod>` : '');
  const base = new Map(written.filter(page => page.kind === 'base').map(page => [page.slug, page]));
  const url = (path: string, extra = '') => `<url><loc>${xml(`${siteUrl}${path}`)}</loc>${extra}</url>`;
  const entries = [
    url('/'),
    url('/products'),
    ...f.categories.map(c => url(categoryPath(c.name))),
    ...f.collections.map(c => url(collectionPath(c.name))),
    ...products.map(p => url(productPath(p.slug), p.cover
      ? `<image:image><image:loc>${xml(`${siteUrl}${mediaPath(p.cover.sha256)}`)}</image:loc></image:image>`
      : '')),
    ...INFO_PAGES.filter(page => !base.get(page.slug)?.noindex).map(page => url(`/${page.slug}`, lastmod(base.get(page.slug)?.updatedAt ?? ''))),
    ...written.filter(page => page.kind === 'custom' && !page.noindex).map(page => url(pagePath(page), lastmod(page.updatedAt))),
    url('/corporate-gift'),
    // phase 8.5b: the «صفحه‌های ویژه» on the site now; one that ends leaves the map with it
    ...pages.map(c => url(campaignPath(c.slug))),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
