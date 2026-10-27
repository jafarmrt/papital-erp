import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { pickListIds, pickListIdsUrl } from '../../lib/permissions/pickListCap';

/** The pick lists a form reads by id when its own list was cut at the cap (v11 phase 6.1ch, C13) */
export type PickListKind = 'customers' | 'items';

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/** Under each list's own key, so a party save or a stock change refreshes the rows read by id too */
export function pickRowsKey(kind: PickListKind, ids: string) {
  return kind === 'customers' ? QUERY_KEYS.customers.options({ ids }) : ([...QUERY_KEYS.items.all, 'options', { ids }] as const);
}

/**
 * v11 phase 6.1ch (C13): the rows of chosen or stored parties or items that a form's pick list lacks (the list reached the
 * cap), read by id. Nothing is read while `ready` is false (the list itself still loads, so it may hold them) or when the
 * list holds every id. `loading` is true while a needed read runs, so a form can wait for it before it decides a row is gone.
 */
export function useMissingPickRows<T extends { id: number | string }>(
  kind: PickListKind,
  list: readonly T[],
  ids: readonly unknown[],
  ready = true,
): { rows: T[]; loading: boolean; failed: boolean } {
  const wanted = pickListIds(ids).join(',');
  const missing = useMemo(() => {
    if (!wanted) return [];
    const held = new Set(list.map(row => Number(row.id)));
    return wanted.split(',').map(Number).filter(id => !held.has(id));
  }, [list, wanted]);
  const key = missing.join(',');
  const enabled = ready && missing.length > 0;
  const query = useQuery<T[]>({
    queryKey: pickRowsKey(kind, key),
    queryFn: async ({ signal }) => rowsOf<T>(await fetchJson<unknown>(pickListIdsUrl(PICK_LIST_URLS[kind], key.split(',').map(Number)), { signal })),
    enabled,
    staleTime: 60 * 1000,
  });
  return {
    rows: enabled ? query.data ?? [] : [],
    loading: enabled && query.isPending,
    failed: enabled && query.isError,
  };
}

/** The same read now, for a step that needs the row at once (a dossier opened from a sales file or a link) */
export async function fetchPickRows<T>(queryClient: QueryClient, kind: PickListKind, ids: readonly unknown[]): Promise<T[]> {
  const key = pickListIds(ids).join(',');
  if (!key) return [];
  return queryClient.fetchQuery({
    queryKey: pickRowsKey(kind, key),
    queryFn: async ({ signal }) => rowsOf<T>(await fetchJson<unknown>(pickListIdsUrl(PICK_LIST_URLS[kind], key.split(',').map(Number)), { signal })),
    staleTime: 60 * 1000,
  });
}

/** The server's matches for a typed name (at most `limit`), read now */
export async function fetchPickMatches<T>(queryClient: QueryClient, kind: PickListKind, search: string, limit: number): Promise<T[]> {
  const text = search.trim();
  if (!text) return [];
  const url = `${PICK_LIST_URLS[kind]}?${new URLSearchParams({ search: text, limit: String(limit) }).toString()}`;
  return queryClient.fetchQuery({
    queryKey: kind === 'customers' ? QUERY_KEYS.customers.options({ search: text, limit }) : [...QUERY_KEYS.items.all, 'options', { search: text, limit }],
    queryFn: async ({ signal }) => rowsOf<T>(await fetchJson<unknown>(url, { signal })),
    staleTime: 60 * 1000,
  });
}

/** The list with the rows read by id or picked from the server's matches, each once (the first row of an id wins) */
export function withPickRows<T extends { id: number | string }>(list: readonly T[], extra: readonly T[]): T[] {
  if (extra.length === 0) return list as T[];
  const held = new Set(list.map(row => String(row.id)));
  const rows = [...list];
  for (const row of extra) {
    if (held.has(String(row.id))) continue;
    held.add(String(row.id));
    rows.push(row);
  }
  return rows;
}
