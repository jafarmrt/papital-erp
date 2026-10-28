import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Item, Customer } from '../../types';
import {
  useWarehousesQuery,
  usePersonnelListQuery,
  useCategoriesQuery
} from '../queries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { ReservedItemsResponse, StockDocProject } from '../../lib/documents/stockReservations';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { cappedPickListUrl, takePickList } from '../../lib/permissions/pickListCap';

/**
 * TD-080 (بخش ۳): لیست‌های مرجع فرم رسید/حواله انبار با React Query — منتقل‌شده بدون تغییر از DocumentsPage.
 * V9 Phase 5.1: کش مشترک بین صفحات و حذف fetch دستی.
 */
export function useStockDocumentReferenceData() {
  const whsQuery = useWarehousesQuery();
  const personnelQuery = usePersonnelListQuery();
  const projectsQuery = useQuery<StockDocProject[]>({
    queryKey: QUERY_KEYS.projects.options(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson(PICK_LIST_URLS.projects, { signal });
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  // v11 phase 6.1ch (C13): the party and item lists hold at most the cap; the pickers over a cut list also search on the
  // server, and the reserved or returned items they lack are read by id (useStockDocumentForm)
  const suppliersQuery = useQuery<Customer[]>({
    queryKey: QUERY_KEYS.customers.options({ scope: 'doc-suppliers' }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson(cappedPickListUrl(PICK_LIST_URLS.customers), { signal });
      return takePickList<Customer>(Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []));
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const itemsQuery = useQuery<Item[]>({
    queryKey: QUERY_KEYS.items.list({ scope: 'doc-items-all' }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson(cappedPickListUrl(PICK_LIST_URLS.items), { signal });
      return takePickList<Item>(Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []));
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const reservedStockQuery = useQuery<ReservedItemsResponse>({
    queryKey: QUERY_KEYS.inventory.reservedItems(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/inventory/reserved-items', { signal });
      return res;
    },
    staleTime: 30 * 1000,
  });

  const categoriesQuery = useCategoriesQuery();

  const warehouses = whsQuery.data ?? [];
  const personnelList = personnelQuery.data ?? [];
  const projectsList = projectsQuery.data ?? [];
  const suppliersList = suppliersQuery.data ?? [];
  const itemsList = itemsQuery.data ?? [];

  return {
    warehouses,
    personnelList,
    projectsList,
    suppliersList,
    itemsList,
    /** the item list has arrived, so the rows it lacks may be read by id */
    itemsReady: itemsQuery.isSuccess,
    reservedItemsData: reservedStockQuery.data,
    categories: categoriesQuery.data,
  };
}

export type StockDocumentReferenceData = ReturnType<typeof useStockDocumentReferenceData>;
