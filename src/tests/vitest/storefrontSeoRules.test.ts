// @vitest-environment node
/**
 * v11 phase 8.5 (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md): the old-address key the ERP saves and the site looks up,
 * the site's own guesses for an address with no redirect, the safe targets, the statistics settings, and what a reading of
 * the WooCommerce site becomes.
 */
import { describe, expect, it } from 'vitest';
import {
  campaignParams, httpsSiteUrl, isSafeSitePath, legacyFallback, legacyPathError, legacyPathKey, normalizedSeoSettings, redirectTargetError,
  seoSettingsError, type SeoSettingsValues,
} from '../../lib/storefront/storefrontSeoRules';
import { decodeEntities, planRedirectImport, redirectCandidates } from '../../services/storefront/storefrontRedirectCandidates';

const encoded = (text: string) => encodeURIComponent(text);

describe('legacyPathKey', () => {
  it('reads a pasted link, an encoded Persian path and the decoded path as one key', () => {
    const slug = 'گوشواره-کاشی-آبی';
    const forms = [
      `https://papitalgallery.com/product/${encoded(slug)}/`,
      `/product/${encoded(slug)}`,
      `/product/${slug}/`,
      `product/${slug}`,
      `/Product/${slug}//#reviews`,
    ];
    for (const form of forms) expect(legacyPathKey(form)).toBe(`/product/${slug}`);
  });
  it('reads Arabic «ي» and «ك» as Persian, and upper-case Latin as lower-case', () => {
    expect(legacyPathKey('/product/كاشي-ABC')).toBe('/product/کاشی-abc');
  });
  it('keeps of the query only what WordPress finds a page by', () => {
    expect(legacyPathKey('/?p=123')).toBe('/?p=123');
    expect(legacyPathKey('/?page_id=45&utm_source=ig')).toBe('/?p=45');
    expect(legacyPathKey('/?post_type=product&p=77')).toBe('/?p=77');
    expect(legacyPathKey('/?product=abc')).toBe('/product/abc');
    expect(legacyPathKey(`/?product_cat=${encoded('گردنبند')}`)).toBe('/product-category/گردنبند');
    expect(legacyPathKey('/product/abc/?utm_source=instagram')).toBe('/product/abc');
    expect(legacyPathKey('/?p=abc')).toBeNull();
  });
  it('drops list pages and feeds, and reaches a nested category by its own slug', () => {
    expect(legacyPathKey('/product-category/jewelry/earrings/page/3/')).toBe('/product-category/earrings');
    expect(legacyPathKey('/product/abc/feed/')).toBe('/product/abc');
    expect(legacyPathKey('/index.php/product/abc')).toBe('/product/abc');
  });
  it('has no key for the home page, nothing, or a broken link', () => {
    for (const raw of ['', '/', 'https://papitalgallery.com/', 'https://', '/?utm_source=x']) expect(legacyPathKey(raw)).toBeNull();
    expect(legacyPathError('/')).not.toBeNull();
    expect(legacyPathError('/shop')).toBeNull();
  });
  it('keeps a broken percent sequence as it is instead of failing', () => {
    expect(legacyPathKey('/product/%E0%A4')).toBe('/product/%e0%a4');
  });
});

describe('targets', () => {
  it('sends only to a path of this site', () => {
    for (const safe of ['/products', '/p/earring-1', '/collections/%DB%8C%D9%84%D8%AF%D8%A7', '/products?q=a']) expect(isSafeSitePath(safe)).toBe(true);
    for (const unsafe of ['//evil.example', '/\\evil.example', 'https://evil.example', 'products', '/a b', '/a\nb']) expect(isSafeSitePath(unsafe)).toBe(false);
    expect(redirectTargetError('path', '//evil.example')).not.toBeNull();
    expect(redirectTargetError('collection', '')).not.toBeNull();
    expect(redirectTargetError('collection', 'یلدا')).toBeNull();
    expect(redirectTargetError('product', '')).toBeNull();
  });
  it('guesses a page for a WooCommerce address that no redirect names, and leaves the rest a 404', () => {
    expect(legacyFallback('/shop')).toBe('/products');
    expect(legacyFallback('/product-category/earrings')).toBe('/products');
    expect(legacyFallback('/product/گوشواره-آبی')).toBe(`/products?q=${encoded('گوشواره آبی')}`);
    expect(legacyFallback('/cart')).toBe('/');
    expect(legacyFallback('/wp-admin')).toBeNull();
    expect(legacyFallback('/blog/post')).toBeNull();
  });
  it('carries campaign fields over and nothing else', () => {
    expect(campaignParams('?utm_source=ig&utm_campaign=yalda&p=12&fbclid=x').toString()).toBe('utm_source=ig&utm_campaign=yalda&fbclid=x');
  });
});

describe('search and statistics settings', () => {
  const base: SeoSettingsValues = { googleVerification: '', bingVerification: '', analyticsProvider: 'none', analyticsId: '', analyticsUrl: '', alternateSiteUrl: '' };
  it('is valid empty, and then loads nothing', () => {
    expect(seoSettingsError(base)).toBeNull();
    expect(normalizedSeoSettings({ ...base, analyticsId: 'G-ABC123' })).toMatchObject({ analyticsId: '', analyticsUrl: '' });
  });
  it('takes a GA4 id in any case and saves it in upper case', () => {
    expect(seoSettingsError({ ...base, analyticsProvider: 'ga4', analyticsId: ' g-abc123xyz ' })).toBeNull();
    expect(normalizedSeoSettings({ ...base, analyticsProvider: 'ga4', analyticsId: ' g-abc123xyz ' }).analyticsId).toBe('G-ABC123XYZ');
    expect(seoSettingsError({ ...base, analyticsProvider: 'ga4', analyticsId: 'UA-1234-1' })?.field).toBe('analyticsId');
  });
  it('needs an https Matomo server and a numeric site id', () => {
    expect(seoSettingsError({ ...base, analyticsProvider: 'matomo', analyticsId: '3', analyticsUrl: 'https://stats.example.com/' })).toBeNull();
    expect(normalizedSeoSettings({ ...base, analyticsProvider: 'matomo', analyticsId: '3', analyticsUrl: 'https://stats.example.com/' }).analyticsUrl).toBe('https://stats.example.com');
    expect(seoSettingsError({ ...base, analyticsProvider: 'matomo', analyticsId: '3', analyticsUrl: 'http://stats.example.com' })?.field).toBe('analyticsUrl');
    expect(seoSettingsError({ ...base, analyticsProvider: 'matomo', analyticsId: 'x', analyticsUrl: 'https://stats.example.com' })?.field).toBe('analyticsId');
  });
  it('refuses a verification code that is a whole tag, and a site address that is not plain https', () => {
    expect(seoSettingsError({ ...base, googleVerification: '<meta name="google-site-verification" content="abc">' })?.field).toBe('googleVerification');
    expect(seoSettingsError({ ...base, googleVerification: 'abc_DEF-123' })).toBeNull();
    for (const bad of ['http://papital.gallery', 'https://papital.gallery?x=1', 'https://user@papital.gallery', 'https://localhost', 'papital.gallery']) {
      expect(httpsSiteUrl(bad)).toBeNull();
    }
    expect(httpsSiteUrl('https://papital.gallery/')).toBe('https://papital.gallery');
    expect(seoSettingsError({ ...base, alternateSiteUrl: 'javascript:alert(1)' })?.field).toBe('alternateSiteUrl');
  });
});

describe('a reading of the WooCommerce site', () => {
  const input = {
    products: [
      { id: 10, slug: encoded('گوشواره-آبی'), permalink: `https://papitalgallery.com/product/${encoded('گوشواره-آبی')}/`, name: '' },
      { id: 11, slug: 'draft-item', permalink: 'https://papitalgallery.com/?post_type=product&p=11', name: '' },
      { id: 12, slug: 'not-linked', permalink: 'https://papitalgallery.com/product/not-linked/', name: '' },
    ],
    categories: [{ id: 1, slug: 'earrings', permalink: '', name: 'گوشواره' }, { id: 2, slug: 'misc', permalink: '', name: 'متفرقه' }],
    tags: [{ id: 3, slug: 'yalda', permalink: '', name: 'یلدا &amp; زمستان' }],
    itemByProduct: new Map([[10, 501], [11, 502]]),
    categoryNames: new Map([['گوشواره', 'گوشواره']]),
    collectionNames: new Map([['یلدا & زمستان', 'یلدا & زمستان']]),
  };
  it('makes product, category and tag redirects, and counts what matched nothing', () => {
    const decoded = { ...input, tags: input.tags.map(t => ({ ...t, name: decodeEntities(t.name) })) };
    const { candidates, unmatched } = redirectCandidates(decoded);
    const byKey = Object.fromEntries(candidates.map(c => [c.fromPath, c]));
    expect(byKey['/product/گوشواره-آبی']).toMatchObject({ targetKind: 'product', targetItemId: 501 });
    expect(byKey['/?p=10']).toMatchObject({ targetKind: 'product', targetItemId: 501 });
    expect(byKey['/?p=11']).toMatchObject({ targetKind: 'product', targetItemId: 502 });
    expect(byKey['/product/draft-item']).toMatchObject({ targetItemId: 502 });
    expect(byKey['/product-category/earrings']).toMatchObject({ targetKind: 'category', target: 'گوشواره' });
    expect(byKey['/product-tag/yalda']).toMatchObject({ targetKind: 'collection', target: 'یلدا & زمستان' });
    expect(byKey['/product/not-linked']).toBeUndefined();
    // the unlinked product and the unknown category
    expect(unmatched).toBe(2);
  });
  it('never changes or brings back a row made, edited or removed by hand, and brings its own rows in line', () => {
    const { candidates } = redirectCandidates(input);
    const keyOf = (path: string) => candidates.find(c => c.fromPath === path)!;
    const saved = [
      { id: 1, fromPath: '/?p=10', source: 'manual', isDeleted: 0, targetKind: 'path', targetItemId: null, target: '/about', version: 1 },
      { id: 2, fromPath: '/?p=11', source: 'woocommerce', isDeleted: 1, targetKind: 'product', targetItemId: 502, target: '', version: 2 },
      { id: 3, fromPath: '/product/draft-item', source: 'woocommerce', isDeleted: 0, targetKind: 'product', targetItemId: 999, target: '', version: 1 },
      { id: 4, fromPath: '/product-category/earrings', source: 'woocommerce', isDeleted: 0, targetKind: 'category', targetItemId: null, target: 'گوشواره', version: 1 },
    ];
    const plan = planRedirectImport(candidates, saved);
    expect(plan.kept).toBe(2);
    expect(plan.unchanged).toBe(1);
    expect(plan.updates.map(u => [u.row.id, u.candidate.targetItemId])).toEqual([[3, 502]]);
    expect(plan.inserts).toContainEqual(keyOf('/product/گوشواره-آبی'));
    expect(plan.inserts.some(c => ['/?p=10', '/?p=11', '/product/draft-item', '/product-category/earrings'].includes(c.fromPath))).toBe(false);
  });
});
