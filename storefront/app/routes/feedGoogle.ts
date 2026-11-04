import type { StorefrontFeedItem } from '@erp/storefront/storefrontContracts';
import { feed } from '../lib/api.server';
import { siteEnv } from '../lib/site.server';
import { BRAND, mediaPath, productPath } from '../lib/brand';

/**
 * v11 phase 8.5b (start plan 8.5 §4): the product feed in Google's format (RSS 2.0 with the `g:` fields), at
 * `/feeds/google.xml`. Google Merchant Center and the price-comparison sites that read this format fetch it a few times a
 * day; the ERP's answer is kept ten minutes here and the file an hour by the reader. Like the sitemap, a preview or test
 * address has none (404), so a copy of the shop never lists its products as the shop's.
 */
const TITLE_MAX = 150;
/** Google's own category of the shop's goods: Apparel & Accessories > Jewelry */
const GOOGLE_CATEGORY_JEWELRY = '188';

const xml = (text: string) => text
  // a character XML 1.0 cannot carry (a control character pasted into a description) is dropped
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  // and so is half of a pair (a broken emoji): one such character would make the whole file unreadable
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const tag = (name: string, value: string) => (value ? `<${name}>${xml(value)}</${name}>` : '');

/** One item of the feed; a price is whole rials, as Google reads «14500000 IRR» */
export function feedItem(item: StorefrontFeedItem, siteUrl: string): string {
  const photos = item.images.map(image => `${siteUrl}${mediaPath(image.sha256)}`);
  const description = item.description || `${item.name}، ${BRAND.tagline}.`;
  return [
    '<item>',
    tag('g:id', item.sku),
    tag('title', Array.from(item.name).slice(0, TITLE_MAX).join('')),
    tag('description', description),
    tag('link', `${siteUrl}${productPath(item.slug)}`),
    tag('g:image_link', photos[0] ?? ''),
    ...photos.slice(1).map(url => tag('g:additional_image_link', url)),
    tag('g:availability', item.inStock ? 'in_stock' : 'out_of_stock'),
    tag('g:price', `${item.retailPrice} IRR`),
    tag('g:brand', BRAND.fullName),
    tag('g:condition', 'new'),
    // handmade pieces have no GTIN or maker's part number
    tag('g:identifier_exists', 'no'),
    tag('g:google_product_category', GOOGLE_CATEGORY_JEWELRY),
    tag('g:product_type', [item.category, item.collections[0] ?? ''].filter(Boolean).join(' > ')),
    tag('g:material', item.material),
    tag('g:color', item.color),
    '</item>',
  ].filter(Boolean).join('');
}

export async function loader() {
  const { siteUrl, indexable } = siteEnv();
  if (!indexable) throw new Response('پیدا نشد', { status: 404 });
  const items = await feed();
  // an item without a photo is refused by Google; it stays on the site and its sitemap
  const listed = items.filter(item => item.images.length > 0);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    tag('title', BRAND.fullName),
    tag('link', `${siteUrl}/`),
    tag('description', BRAND.tagline),
    ...listed.map(item => feedItem(item, siteUrl)),
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
