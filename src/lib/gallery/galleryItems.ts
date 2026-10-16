/** v10.1.51 (OBS-R2-62): the gallery's page size; the server pages, filters pictures and the category */
export const GALLERY_PAGE_SIZE = 50;

/** The gallery's item list request: one server page of the items with a picture */
export function galleryItemsUrl(q: { tab: 'product' | 'raw_material'; page: number; search: string; category: string }): string {
  const params = new URLSearchParams({ type: q.tab, image: '1', page: String(q.page), limit: String(GALLERY_PAGE_SIZE) });
  if (q.search.trim()) params.set('search', q.search.trim());
  if (q.category) params.set('category', q.category);
  return `/items?${params.toString()}`;
}
