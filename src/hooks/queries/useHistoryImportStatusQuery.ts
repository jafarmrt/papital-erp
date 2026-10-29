import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { OPEN_HISTORY_IMPORT, type HistoryImportStatus } from '../../lib/historyImport/historyImportClose';
import { QUERY_KEYS } from '../../lib/queryKeys';

/**
 * v11 history import, tool 9: whether «پایان ورود سابقه» closed the Excel imports. The menus show an import window only
 * while this answers open; until it answers they show nothing, so a closed import never flashes in.
 */
export function useHistoryImportStatusQuery(enabled = true) {
  return useQuery<HistoryImportStatus>({
    queryKey: QUERY_KEYS.historyImport.status(),
    queryFn: async ({ signal }) => ({ ...OPEN_HISTORY_IMPORT, ...(await fetchJson<HistoryImportStatus>('/history-import/status', { signal })) }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** The import windows may be offered: the status answered and the imports are not closed. */
export function useHistoryImportOpen(enabled = true): boolean {
  const { data } = useHistoryImportStatusQuery(enabled);
  return enabled && data !== undefined && !data.closed;
}
