/** Catalog constants the pages and the server share (the sort names are the Storefront API's) */
export const CATALOG_SORTS = ['default', 'newest', 'price_asc', 'price_desc'] as const;
export type CatalogSort = typeof CATALOG_SORTS[number];
export const CATALOG_PAGE_SIZE = 24;

export function parseSort(value: string | null): CatalogSort {
  return (CATALOG_SORTS as readonly string[]).includes(value ?? '') ? value as CatalogSort : 'default';
}

export function parsePage(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}
