import type { SiteShop } from './shopInfo';

/**
 * Structured data for search engines (schema.org JSON-LD). Every address in it must be absolute, so nothing is written
 * while the site's public address is unknown (a preview or a test run).
 */
export type JsonLd = Record<string, unknown>;

export const jsonLdHtml = (data: JsonLd) => JSON.stringify(data).replace(/</g, '\\u003c');

/** The trail of a page, from the home page to the page itself; the last step has no link */
export function breadcrumbLd(steps: Array<{ name: string; path?: string }>, siteUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      ...(step.path ? { item: `${siteUrl}${step.path}` } : {}),
    })),
  };
}

/**
 * The shop itself and its search box, on the home page. v12 phase 10a: its name, social pages, address and contact
 * details are the ERP's «اطلاعات فروشگاه»; a detail the owner has not written is left out.
 */
export function homeLd(siteUrl: string, logoUrl: string, shop: SiteShop): JsonLd[] {
  const { address, postalCode, phone, mobile, email } = shop.contact;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: shop.brand.fullName,
      url: `${siteUrl}/`,
      ...(logoUrl ? { logo: `${siteUrl}${logoUrl}` } : {}),
      sameAs: shop.social.map(page => page.href),
      ...(address ? { address: { '@type': 'PostalAddress', streetAddress: address, ...(postalCode ? { postalCode } : {}), addressCountry: 'IR' } } : {}),
      ...(phone || mobile ? { telephone: phone || mobile } : {}),
      ...(email ? { email } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: shop.brand.fullName,
      url: `${siteUrl}/`,
      inLanguage: 'fa-IR',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/products?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}
