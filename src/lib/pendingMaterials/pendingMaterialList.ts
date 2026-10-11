/**
 * v10.0.171 (OBS-R1-90): one page of «مواد اولیه در انتظار تأیید». The server filters, counts and pages in SQL
 * (`PendingMaterialsService.listRequests`) and the page reads only this shape; before, the route sent every request.
 */
export const PENDING_MATERIAL_PAGE_SIZE = 50;
export const PENDING_MATERIAL_MAX_PAGE_SIZE = 200;
export const PENDING_MATERIAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PendingMaterialStatus = typeof PENDING_MATERIAL_STATUSES[number];
export type PendingMaterialStatusFilter = PendingMaterialStatus | 'all';

export interface PendingMaterialListFilters {
  status?: PendingMaterialStatusFilter;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PendingMaterialPage<Row> {
  data: Row[];
  total: number;
  page: number;
  limit: number;
  /** Requests per status under the category and search filters, whatever status is shown */
  statusCounts: Record<PendingMaterialStatus, number>;
}

/** The list URL for these filters; «همه» and an empty category or search are left out */
export function pendingMaterialListUrl(filters: PendingMaterialListFilters): string {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  const search = filters.search?.trim();
  if (search) params.set('search', search);
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? PENDING_MATERIAL_PAGE_SIZE));
  return `/pending-materials?${params.toString()}`;
}
