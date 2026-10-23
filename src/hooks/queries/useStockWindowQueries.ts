import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/**
 * 10.3 (ARCH review finding 3): the stock windows and reports (reserved items, transfer between warehouses, item code
 * history, warehouse stock reconciliation) read through the shared cache. Their keys sit under `inventory`, `items` or
 * `documents`, which every stock document, transfer, item save and stock adjustment invalidates, so a window that is
 * open shows the stock as it is now instead of as it was when the window opened.
 */

const listOf = <T,>(res: unknown): T[] => {
  if (Array.isArray(res)) return res as T[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
};

/** the reserved items report (`GET /inventory/reserved-items`); the stock document form reads the same key */
export function useReservedItemsReportQuery<T>() {
  return useQuery<T | null>({
    queryKey: QUERY_KEYS.inventory.reservedItems(),
    queryFn: async ({ signal }) => (await fetchJson<T | null>('/inventory/reserved-items', { signal })) ?? null,
    ...READ_ON_EVERY_OPENING,
  });
}

/** the warehouse stock against the stock ledger (`GET /inventory/warehouse-stock-reconciliation`) */
export function useWarehouseReconciliationQuery<T>() {
  return useQuery<T>({
    queryKey: QUERY_KEYS.inventory.warehouseReconciliation(),
    queryFn: ({ signal }) => fetchJson<T>('/inventory/warehouse-stock-reconciliation', { signal }),
    ...READ_ON_EVERY_OPENING,
  });
}

export interface ItemCodeHistoryRow {
  oldCode: string;
  newCode: string;
  reason: string;
  username: string;
  createdAt: string;
}

/** an item's earlier codes, under the item's key so its code change refreshes them; an unreadable list is empty */
export function useItemCodeHistoryQuery(itemId: number) {
  return useQuery<ItemCodeHistoryRow[]>({
    queryKey: QUERY_KEYS.items.codeHistory(itemId),
    queryFn: async ({ signal }) => {
      try {
        return listOf<ItemCodeHistoryRow>(await fetchJson(`/items/${itemId}/code-history`, { signal }));
      } catch (err) {
        if (signal.aborted) throw err;
        return [];
      }
    },
    ...READ_ON_EVERY_OPENING,
  });
}

/** the next number of a document type (`GET /documents/next-ref`), read again on every opening */
export function useNextDocumentRefQuery(type: string, enabled: boolean) {
  return useQuery<string>({
    queryKey: QUERY_KEYS.documents.nextRef(type),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ nextRef?: unknown } | null>(`/documents/next-ref?type=${type}`, { signal });
      return res?.nextRef ? String(res.nextRef) : '';
    },
    ...READ_ON_EVERY_OPENING,
    enabled,
  });
}

/** one row of the item pick list (`GET /items/options`), with the item's stock in each warehouse */
export interface StockPickItem {
  id: number;
  name: string;
  code: string;
  unit: string;
  current_stock?: number;
  currentStock?: number;
  stocks?: Record<string, number>;
}

/**
 * The picked item's stock as it is now: the pick list row of the item, found by its code. A stock document, transfer
 * or item save elsewhere invalidates `items`, so the stock a window checks against follows. Null when the row is not
 * among the answers (a code many newer codes contain); the window then keeps the row it picked, as before 10.3.
 */
/** codes that contain the picked code, newest first; enough for any real code without reading the whole list */
const PICKED_ITEM_SEARCH_LIMIT = 200;

export function usePickedItemStockQuery(item: Pick<StockPickItem, 'id' | 'code'> | null, enabled: boolean) {
  return useQuery<StockPickItem | null>({
    queryKey: QUERY_KEYS.items.pickedStock(item?.id ?? 0),
    queryFn: async ({ signal }) => {
      const picked = item as Pick<StockPickItem, 'id' | 'code'>;
      const query = new URLSearchParams({ search: picked.code, limit: String(PICKED_ITEM_SEARCH_LIMIT) });
      const rows = listOf<StockPickItem>(await fetchJson(`${PICK_LIST_URLS.items}?${query.toString()}`, { signal }));
      return rows.find(row => row.id === picked.id) ?? null;
    },
    ...READ_ON_EVERY_OPENING,
    enabled: enabled && item !== null,
  });
}
