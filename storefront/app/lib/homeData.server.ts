import { catalog, facets } from './api.server';
import { homeNeeds, type SiteHomeSection } from './home';
import type { HomeCategory } from '../components/home/HomeParts';
import type { StorefrontFacet, StorefrontProductCard } from '@erp/storefront/storefrontContracts';

/**
 * v12 phase 10e: what the parts of a home page read from the catalog, and only what the parts on the page ask for (a
 * home page without «تازه‌های کارگاه» does not read the newest products). The published home page and a preview of its
 * draft read the same way.
 */
export interface HomeCatalog {
  /** the product beside the opening words, when the page has them */
  lead: StorefrontProductCard | null;
  /** the row of «برگزیده‌ها»: it starts after the product beside the opening words, or from the first when the page has none */
  featured: StorefrontProductCard[];
  newest: StorefrontProductCard[];
  categories: HomeCategory[];
  collections: StorefrontFacet[];
}

/** `written` is the page before a campaign's banner took its top part: the row of products does not change with a campaign */
export async function homeCatalog(sections: readonly SiteHomeSection[], written: readonly SiteHomeSection[] = sections): Promise<HomeCatalog> {
  const needs = homeNeeds(sections);
  const none = { data: [] as StorefrontProductCard[] };
  const [f, featured, newest] = await Promise.all([
    needs.categories || needs.collections ? facets() : Promise.resolve({ collections: [], categories: [] }),
    // the owner's order (sort order in «فروشگاه سایت») picks what the home page leads with
    needs.featured ? catalog({ limit: 9 }) : none,
    needs.newest ? catalog({ sort: 'newest', limit: 8 }) : none,
  ]);
  const first = needs.categories ? f.categories.slice(0, 4) : [];
  const covers = await Promise.all(first.map(c => catalog({ category: c.name, limit: 1 })));
  const opens = written.some(part => part.kind === 'homeIntro');
  return {
    lead: opens ? featured.data[0] ?? null : null,
    featured: opens ? featured.data.slice(1, 9) : featured.data.slice(0, 8),
    newest: newest.data,
    categories: first.map((c, i) => ({ ...c, cover: covers[i]?.data[0]?.cover ?? null })),
    collections: needs.collections ? f.collections : [],
  };
}
