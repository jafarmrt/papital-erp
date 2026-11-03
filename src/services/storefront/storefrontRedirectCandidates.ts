import { normalizeSearchText } from '../../lib/search/searchText.js';
import { legacyPathKey, type RedirectTargetKind } from '../../lib/storefront/storefrontSeoRules.js';

/**
 * v11 phase 8.5: what one reading of the WooCommerce site becomes, without the database or the site (so it is tested on its
 * own): the redirect each product, category and tag asks for, and how each meets the redirects already saved.
 */
export interface WooRow { id: number; slug: string; permalink: string; name: string }

export interface RedirectCandidate { fromPath: string; targetKind: RedirectTargetKind; targetItemId: number | null; target: string }

export interface CandidateInput {
  products: WooRow[];
  categories: WooRow[];
  tags: WooRow[];
  /** the site's item of each WooCommerce product id */
  itemByProduct: ReadonlyMap<number, number>;
  /** the ERP's category and collection names by their folded form (`normalizeSearchText`) */
  categoryNames: ReadonlyMap<string, string>;
  collectionNames: ReadonlyMap<string, string>;
}

/** WooCommerce sends names with HTML entities («&amp;», «&#8211;») */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d{1,6});/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/**
 * A product's address, its `/product/<slug>` form and its `?p=<id>` form go to its item; a category's and a tag's address to
 * the ERP category or collection of the same name (a category looks among categories first, a tag among collections
 * first). The first candidate of an old address wins; a row with no match counts as unmatched.
 */
export function redirectCandidates(input: CandidateInput): { candidates: RedirectCandidate[]; unmatched: number } {
  const byKey = new Map<string, RedirectCandidate>();
  let unmatched = 0;
  const add = (address: string, target: Omit<RedirectCandidate, 'fromPath'>) => {
    const key = legacyPathKey(address);
    if (key && !byKey.has(key)) byKey.set(key, { fromPath: key, ...target });
  };
  for (const product of input.products) {
    const itemId = input.itemByProduct.get(product.id);
    if (!itemId) {
      unmatched++;
      continue;
    }
    const target = { targetKind: 'product' as const, targetItemId: itemId, target: '' };
    if (product.permalink) add(product.permalink, target);
    if (product.slug) add(`/product/${product.slug}`, target);
    add(`/?p=${product.id}`, target);
  }
  const named = (name: string, first: 'category' | 'collection'): Omit<RedirectCandidate, 'fromPath'> | null => {
    const folded = normalizeSearchText(name);
    if (!folded) return null;
    const order = first === 'category' ? (['category', 'collection'] as const) : (['collection', 'category'] as const);
    for (const kind of order) {
      const found = (kind === 'category' ? input.categoryNames : input.collectionNames).get(folded);
      if (found) return { targetKind: kind, targetItemId: null, target: found };
    }
    return null;
  };
  for (const [list, prefix, first] of [[input.categories, 'product-category', 'category'], [input.tags, 'product-tag', 'collection']] as const) {
    for (const term of list) {
      const target = term.slug ? named(term.name, first) : null;
      if (!target) {
        unmatched++;
        continue;
      }
      add(`/${prefix}/${term.slug}`, target);
    }
  }
  return { candidates: [...byKey.values()], unmatched };
}

export interface SavedRedirect {
  id: number;
  fromPath: string;
  source: string;
  isDeleted: number;
  targetKind: string;
  targetItemId: number | null;
  target: string;
  version: number;
}

export interface ImportPlan {
  inserts: RedirectCandidate[];
  updates: Array<{ row: SavedRedirect; candidate: RedirectCandidate }>;
  unchanged: number;
  /** an old address with a row made or edited by hand, or removed: never touched by a reading */
  kept: number;
}

/** How the candidates meet the saved rows of their old addresses (live and removed) */
export function planRedirectImport(candidates: RedirectCandidate[], saved: SavedRedirect[]): ImportPlan {
  const live = new Map(saved.filter(r => r.isDeleted === 0).map(r => [r.fromPath, r]));
  const removed = new Set(saved.filter(r => r.isDeleted === 1).map(r => r.fromPath));
  const plan: ImportPlan = { inserts: [], updates: [], unchanged: 0, kept: 0 };
  for (const candidate of candidates) {
    const row = live.get(candidate.fromPath);
    if (!row) {
      if (removed.has(candidate.fromPath)) plan.kept++;
      else plan.inserts.push(candidate);
    } else if (row.source !== 'woocommerce') {
      plan.kept++;
    } else if (row.targetKind === candidate.targetKind && row.targetItemId === candidate.targetItemId && row.target === candidate.target) {
      plan.unchanged++;
    } else {
      plan.updates.push({ row, candidate });
    }
  }
  return plan;
}
