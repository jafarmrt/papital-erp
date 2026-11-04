import { BRAND } from './brand';

/** Title, description, canonical and social card of a page; absolute links only when the site address is known */
export function pageMeta({ title, description, path, image, siteUrl }: { title: string; description: string; path: string; image?: string; siteUrl: string }) {
  const full = title === BRAND.fullName ? title : `${title} | ${BRAND.fullName}`;
  const tags: Array<Record<string, string>> = [
    { title: full },
    { name: 'description', content: description },
    { property: 'og:title', content: full },
    { property: 'og:description', content: description },
    { property: 'og:locale', content: 'fa_IR' },
    { property: 'og:site_name', content: BRAND.fullName },
  ];
  if (siteUrl) {
    tags.push({ tagName: 'link', rel: 'canonical', href: `${siteUrl}${path}` }, { property: 'og:url', content: `${siteUrl}${path}` });
    if (image) tags.push({ property: 'og:image', content: `${siteUrl}${image}` });
  }
  return tags;
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
