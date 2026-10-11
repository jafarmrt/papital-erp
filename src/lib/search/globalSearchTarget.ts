/**
 * TD-1155: where a global search result leads. Each record opens its own list searched by its own key (item code,
 * customer name, document number, project code), so the list shows that record, not every match of the typed text.
 * The documents list also reads the number from its address (`?search=`, TD-828).
 */
export type GlobalSearchHit =
  | { kind: 'item'; code: string; type: 'product' | 'raw_material' }
  | { kind: 'customer'; name: string }
  | { kind: 'document'; refNumber: string }
  | { kind: 'project'; code: string };

export function globalSearchTarget(hit: GlobalSearchHit): { path: string; search: string } {
  switch (hit.kind) {
    case 'item':
      return { path: hit.type === 'raw_material' ? '/products?type=raw_material' : '/products', search: hit.code.trim() };
    case 'customer':
      return { path: '/customers', search: hit.name.trim() };
    case 'document': {
      const ref = hit.refNumber.trim();
      return { path: `/invoices?search=${encodeURIComponent(ref)}`, search: ref };
    }
    case 'project':
      return { path: '/projects', search: hit.code.trim() };
  }
}
