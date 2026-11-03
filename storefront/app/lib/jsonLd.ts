import { BRAND } from './brand';

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

/** The shop itself and its search box, on the home page */
export function homeLd(siteUrl: string, logoUrl: string): JsonLd[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: BRAND.fullName,
      url: `${siteUrl}/`,
      ...(logoUrl ? { logo: `${siteUrl}${logoUrl}` } : {}),
      sameAs: [BRAND.instagram],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: BRAND.fullName,
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
