import { campaigns, facets, feed, newsIndex, pages as sitePages } from '../lib/api.server';
import { lastModOf, pagePath } from '../lib/pages';
import { NEWS_PATH, newsPath } from '../lib/news';
import { siteEnv } from '../lib/site.server';
import { campaignPath, categoryPath, collectionPath, mediaPath, productPath } from '../lib/brand';
import { INFO_PAGES } from '../content/pages';

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Every page a buyer can reach, with each product's cover photo (Google's image extension); none while not indexable.
 * The products are the feed's (every item on the site in one read, which the site keeps ten minutes), so each comes
 * with the day its page last changed (v12 phase 10c); an ERP not yet updated sends no day and the entry has none.
 */
export async function loader() {
  const { siteUrl, indexable } = siteEnv();
  if (!indexable) throw new Response('پیدا نشد', { status: 404 });
  const [f, products, pages, written, news] = await Promise.all([facets(), feed(), campaigns(), sitePages(), newsIndex()]);
  // v12 phase 10c: a page published in the ERP's «صفحه‌های سایت» carries the day it was published (`lastmod`), and one
  // marked «در موتور جست‌وجو نیاید» is not in the map at all (also when it is one of the five base pages)
  const lastmod = (iso: unknown) => (typeof iso === 'string' && lastModOf(iso) ? `<lastmod>${lastModOf(iso)}</lastmod>` : '');
  const base = new Map(written.filter(page => page.kind === 'base').map(page => [page.slug, page]));
  const url = (path: string, extra = '') => `<url><loc>${xml(`${siteUrl}${path}`)}</loc>${extra}</url>`;
  const entries = [
    url('/'),
    url('/products'),
    ...f.categories.map(c => url(categoryPath(c.name))),
    ...f.collections.map(c => url(collectionPath(c.name))),
    ...products.map(p => url(productPath(p.slug), `${lastmod(p.updatedAt)}${p.images[0]
      ? `<image:image><image:loc>${xml(`${siteUrl}${mediaPath(p.images[0].sha256)}`)}</image:loc></image:image>`
      : ''}`)),
    ...INFO_PAGES.filter(page => !base.get(page.slug)?.noindex).map(page => url(`/${page.slug}`, lastmod(base.get(page.slug)?.updatedAt ?? ''))),
    ...written.filter(page => page.kind === 'custom' && !page.noindex).map(page => url(pagePath(page), lastmod(page.updatedAt))),
    url('/corporate-gift'),
    // v12 phase 10d: the list of news and each item on the site now, with the day it was published; none while the shop
    // has not turned «خبرها روی سایت بیایند» on or has no item on the site
    ...(news.length > 0 ? [url(NEWS_PATH), ...news.map(item => url(newsPath(item.slug), item.lastmod ? `<lastmod>${item.lastmod}</lastmod>` : ''))] : []),
    // phase 8.5b: the «صفحه‌های ویژه» on the site now; one that ends leaves the map with it
    ...pages.map(c => url(campaignPath(c.slug))),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
