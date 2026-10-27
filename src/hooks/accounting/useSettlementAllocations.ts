import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { safeExtractArray } from '../../utils';
import type { OpenSettlementDocument, SettlementAllocationInput, SourceAllocations } from '../../lib/treasury/settlementAllocation';
import { silentMutationError } from './accountingQueryConfig';
import { invalidateAfterChequeChange } from './accountingInvalidation';

/**
 * v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): the documents a receipt, payment or cheque can settle (oldest first, with
 * what is left on each), the parts of a recorded one, and the change of those parts.
 */

export type SettlementSource = { kind: 'treasury' | 'cheque'; id: number };

/** A recorded receipt or cheque, or the party, side and currency of one being recorded */
export type SettlementOptionsQuery =
  | { source: SettlementSource }
  | { direction: 'receipt' | 'payment'; partyType: string; partyId: number | null; partyName: string; currency: string };

function optionsUrl(query: SettlementOptionsQuery): string {
  const params = new URLSearchParams();
  if ('source' in query) {
    params.set(query.source.kind === 'cheque' ? 'chequeId' : 'treasuryId', String(query.source.id));
  } else {
    params.set('direction', query.direction);
    params.set('partyType', query.partyType);
    if (query.partyId) params.set('partyId', String(query.partyId));
    if (query.partyName.trim()) params.set('partyName', query.partyName.trim());
    params.set('currency', query.currency || 'IRR');
  }
  return `/documents/settlement-options?${params.toString()}`;
}

export function useSettlementOptionsQuery(query: SettlementOptionsQuery | null) {
  return useQuery<OpenSettlementDocument[]>({
    queryKey: QUERY_KEYS.accounting.settlementOptions(query),
    queryFn: async () => safeExtractArray<OpenSettlementDocument>(await fetchJson(optionsUrl(query as SettlementOptionsQuery))),
    enabled: query !== null,
    staleTime: 0,
  });
}

const sourceUrl = (source: SettlementSource) =>
  `/accounting/${source.kind === 'cheque' ? 'cheques' : 'treasury'}/${source.id}/allocations`;

export function useSourceAllocationsQuery(source: SettlementSource | null) {
  return useQuery<SourceAllocations>({
    queryKey: QUERY_KEYS.accounting.sourceAllocations(source?.kind ?? '', source?.id ?? 0),
    queryFn: async () => (await fetchJson(sourceUrl(source as SettlementSource))) as SourceAllocations,
    enabled: source !== null,
    staleTime: 0,
  });
}

/** The new set of parts of a recorded receipt or cheque; an empty set puts it all on account */
export function useReplaceSourceAllocations() {
  const queryClient = useQueryClient();
  return useMutation<SourceAllocations, unknown, { source: SettlementSource; allocations: SettlementAllocationInput[] }>({
    mutationFn: async ({ source, allocations }) =>
      (await fetchJson(sourceUrl(source), { method: 'PUT', body: JSON.stringify({ allocations }) })) as SourceAllocations,
    onSuccess: () => {
      void invalidateAfterChequeChange(queryClient);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.documents.all });
    },
    onError: silentMutationError,
  });
}
