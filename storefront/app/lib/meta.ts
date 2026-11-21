import type { RootData } from '../root';
import { DEFAULT_SHOP, type SiteBrand } from './shopInfo';
import { mediaPath } from './brand';
import { pageCardImage, pageDescription, pagePath, type SitePage } from './pages';

/** The matched routes as a page's `meta` gets them; the root's data holds the shop's name */
export type MetaMatches = ReadonlyArray<{ id: string; data?: unknown } | undefined>;

/** v12 phase 10a: the brand's name as the ERP's «اطلاعات فروشگاه» has it (the site's own while the root could not load) */
export const brandOf = (matches: MetaMatches | undefined): SiteBrand => (
  (matches?.find(m => m?.id === 'root')?.data as RootData | undefined)?.shop?.brand ?? DEFAULT_SHOP.brand
);

/**
 * Title, description, canonical and social card of a page; absolute links only when the site address is known. A page
 * passes its `matches` so its title ends with the brand's name of now; `title: ''` is the brand's full name alone.
 */
export function pageMeta({ title, description, path, image, siteUrl, matches }: {
  title: string; description: string; path: string; image?: string; siteUrl: string; matches: MetaMatches | undefined;
}) {
  const brand = brandOf(matches);
  const full = title === '' || title === brand.fullName ? brand.fullName : `${title} | ${brand.fullName}`;
  const tags: Array<Record<string, string>> = [
    { title: full },
    { name: 'description', content: description },
    { property: 'og:title', content: full },
    { property: 'og:description', content: description },
    { property: 'og:locale', content: 'fa_IR' },
    { property: 'og:site_name', content: brand.fullName },
  ];
  if (siteUrl) {
    tags.push({ tagName: 'link', rel: 'canonical', href: `${siteUrl}${path}` }, { property: 'og:url', content: `${siteUrl}${path}` });
    if (image) tags.push({ property: 'og:image', content: `${siteUrl}${image}` });
  }
  return tags;
}

/** v12 phase 10c: title, description and social card of a page of the ERP; «در موتور جست‌وجو نیاید» is the page's own `noindex` */
export function sitePageMeta(page: SitePage, siteUrl: string, matches: MetaMatches | undefined) {
  const image = pageCardImage(page);
  return [
    ...pageMeta({
      matches, title: page.seoTitle.trim() || page.title, description: pageDescription(page), path: pagePath(page),
      image: image ? mediaPath(image.sha256) : undefined, siteUrl,
    }),
    ...(page.noindex ? [{ name: 'robots', content: 'noindex' }] : []),
  ];
}

/**
 * v11 phase 8.5b: what price-comparison sites read from a product page. Torob reads `product_id`, `product_name`,
 * `product_price` (whole toman) and `availability` (`instock` / `outofstock`); Emalls and others read the Open Graph
 * product fields (the price in rial with its currency) and the page's schema.org Product. A price that is not whole toman
 * is written rounded down, as the comparison sites take no fraction.
 */
export function productMeta(item: { sku: string; name: string; retailPrice: string; stock: { status: string } }) {
  const inStock = item.stock.status !== 'out';
  const tags: Array<Record<string, string>> = [
    { name: 'product_id', content: item.sku },
    { name: 'product_name', content: item.name },
    { name: 'availability', content: inStock ? 'instock' : 'outofstock' },
    { property: 'og:type', content: 'product' },
    { property: 'product:availability', content: inStock ? 'in stock' : 'out of stock' },
    { property: 'product:condition', content: 'new' },
  ];
  if (/^\d+$/.test(item.retailPrice)) {
    tags.push(
      { name: 'product_price', content: (BigInt(item.retailPrice) / 10n).toString() },
      { property: 'product:price:amount', content: item.retailPrice },
      { property: 'product:price:currency', content: 'IRR' },
    );
  }
  return tags;
}
