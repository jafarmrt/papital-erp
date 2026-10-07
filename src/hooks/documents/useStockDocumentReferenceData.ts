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

/**
 * TD-080 (بخش ۳): لیست‌های مرجع فرم رسید/حواله انبار با React Query — منتقل‌شده بدون تغییر از DocumentsPage.
 * V9 Phase 5.1: کش مشترک بین صفحات و حذف fetch دستی.
 */
export function useStockDocumentReferenceData() {
  const whsQuery = useWarehousesQuery();
  const personnelQuery = usePersonnelListQuery();
  const projectsQuery = useQuery<StockDocProject[]>({
    queryKey: QUERY_KEYS.projects.options(),
    queryFn: async () => {
      const res = await fetchJson(PICK_LIST_URLS.projects);
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  const suppliersQuery = useQuery<Customer[]>({
    queryKey: QUERY_KEYS.customers.options({ scope: 'doc-suppliers' }),
    queryFn: async () => {
      const res = await fetchJson(PICK_LIST_URLS.customers);
      return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const itemsQuery = useQuery<Item[]>({
    queryKey: QUERY_KEYS.items.list({ scope: 'doc-items-all' }),
    queryFn: async () => {
      const res = await fetchJson(PICK_LIST_URLS.items);
      return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const reservedStockQuery = useQuery<ReservedItemsResponse>({
    queryKey: ['inventory', 'reserved-items'],
    queryFn: async () => {
      const res = await fetchJson('/inventory/reserved-items');
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
    reservedItemsData: reservedStockQuery.data,
    categories: categoriesQuery.data,
  };
}

export type StockDocumentReferenceData = ReturnType<typeof useStockDocumentReferenceData>;
