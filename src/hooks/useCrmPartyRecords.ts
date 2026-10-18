import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { normalizeLeadStage } from './useCRMFilters';
import { useCrmActivityPage } from './useCrmListPages';
import type { CRMLead } from '../types';
import { CRM_PARTY_RECORDS_QUERY_KEY, CRM_ACTIVITY_PAGE_SIZE, toCrmPage } from '../lib/crm/crmListPages';

/**
 * v10.2 package 7 (OBS-R2-24 / OBS-R2-28): a party's dossier reads its own sales files (`customerId`: the party's files and
 * legacy ones without an id under its exact name, TD-429) and one page of its activities (`partyId`: its own and those of
 * its files) from the server, on the CRM page and on the customers page alike, instead of filtering the lists another page
 * happened to load (cut at 500 files and 200 activities, empty on the customers page).
 */
export function useCrmPartyRecords(customerId: number | null, activityPage: number) {
  const enabled = Boolean(customerId && customerId > 0);
  const url = `/crm/leads?customerId=${customerId ?? 0}`;
  const leads = useQuery({
    queryKey: [...CRM_PARTY_RECORDS_QUERY_KEY, url],
    queryFn: async ({ signal }) => toCrmPage<CRMLead>(await fetchJson(url, { signal }), 1, 500).data
      .map((l) => ({ ...l, stage: normalizeLeadStage(l.stage) })),
    enabled,
    staleTime: 30 * 1000,
  });
  const activities = useCrmActivityPage({ partyId: customerId ?? undefined, page: activityPage, limit: CRM_ACTIVITY_PAGE_SIZE }, enabled);
  return {
    leads: leads.data ?? [],
    leadsLoading: leads.isFetching,
    leadsError: leads.isError ? 'پرونده‌های فروش این طرف حساب دریافت نشد.' : null,
    activities,
  };
}
