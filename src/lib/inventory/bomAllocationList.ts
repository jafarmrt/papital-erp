/**
 * OBS-R2-45 (TD-1322): the contract of the paged material allocation list, shared by `GET /inventory/allocations?page=` and the
 * «تخصیص مواد به پروژه‌ها» tab. Without `page` the route still answers every allocation the filter finds (the Excel export).
 */
export const BOM_ALLOCATION_STATUSES = ['allocated', 'consumed', 'released'] as const;
export type BomAllocationStatus = typeof BOM_ALLOCATION_STATUSES[number];

/** Allocations per status under the other filters (project, item, search), and all of them */
export interface BomAllocationStatusCounts {
  all: number;
  allocated: number;
  consumed: number;
  released: number;
}

export const EMPTY_ALLOCATION_STATUS_COUNTS: BomAllocationStatusCounts = { all: 0, allocated: 0, consumed: 0, released: 0 };

export interface BomAllocationListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

export function bomAllocationListUrl({ page, limit, search, status }: BomAllocationListParams): string {
  const params = new URLSearchParams();
  if (page !== undefined) params.set('page', String(page));
  if (limit !== undefined) params.set('limit', String(limit));
  const q = (search ?? '').trim();
  if (q) params.set('search', q);
  if (status && status !== 'all') params.set('status', status);
  const query = params.toString();
  return query ? `/inventory/allocations?${query}` : '/inventory/allocations';
}
