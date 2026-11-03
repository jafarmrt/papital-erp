import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type {
  BuyerAccountDetail, BuyerAccountPage, BuyerGroupInput, BuyerGroupRow, BuyerGroupsView, PasswordLinkAnswer,
} from '../../lib/storefront/storefrontBuyerContracts';
import type { BuyerListFilter } from '../../lib/storefront/storefrontBuyerRules';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v11 phase 8.2b: the buyer groups of the «فروشگاه سایت» tab and the «خریداران عمده» page */
export const BUYER_GROUPS_KEY = [...STOREFRONT_KEY, 'buyer-groups'] as const;
export const BUYERS_KEY = [...STOREFRONT_KEY, 'buyers'] as const;
export const BUYERS_PAGE_SIZE = 30;

export function useBuyerGroupsQuery(enabled = true) {
  return useQuery<BuyerGroupsView>({
    queryKey: BUYER_GROUPS_KEY,
    queryFn: async () => ((await fetchJson('/storefront/buyer-groups')) as { data: BuyerGroupsView }).data,
    staleTime: 0,
    enabled,
  });
}

export function useSaveBuyerGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, input }: { id: number | null; version: number; input: BuyerGroupInput }) => (
      (await fetchJson(id === null ? '/storefront/buyer-groups' : `/storefront/buyer-groups/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        body: JSON.stringify(id === null ? input : { ...input, version }),
      })) as { data: BuyerGroupRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: BUYER_GROUPS_KEY }); },
  });
}

export function useDeleteBuyerGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/buyer-groups/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: BUYER_GROUPS_KEY }); },
  });
}

export interface BuyerFilter {
  page: number;
  q: string;
  filter: BuyerListFilter;
}

export function useBuyersQuery(filter: BuyerFilter) {
  return useQuery<BuyerAccountPage>({
    queryKey: [...BUYERS_KEY, 'list', filter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(filter.page), limit: String(BUYERS_PAGE_SIZE), filter: filter.filter });
      if (filter.q.trim()) params.set('q', filter.q.trim());
      return (await fetchJson(`/storefront/buyers?${params.toString()}`)) as BuyerAccountPage;
    },
    placeholderData: previous => previous,
    staleTime: 0,
  });
}

export function useBuyerQuery(id: number | null) {
  return useQuery<BuyerAccountDetail>({
    queryKey: [...BUYERS_KEY, 'detail', id],
    queryFn: async () => ((await fetchJson(`/storefront/buyers/${id}`)) as { data: BuyerAccountDetail }).data,
    enabled: id !== null,
    staleTime: 0,
  });
}

export type BuyerAction =
  | { kind: 'approve' | 'group'; groupId: number; customerId: number }
  | { kind: 'decline' | 'suspend' | 'reactivate' | 'password-link' };

/** An action on one account; approve and password-link answer the one-time link with the account */
export function useBuyerActionMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, version }: { action: BuyerAction; version: number }) => {
      const { kind, ...rest } = action;
      const answer = (await fetchJson(`/storefront/buyers/${id}/${kind}`, { method: 'POST', body: JSON.stringify({ ...rest, version }) })) as {
        data: BuyerAccountDetail | PasswordLinkAnswer;
      };
      return answer.data;
    },
    onSuccess: (data) => {
      const account = 'token' in data ? data.account : data;
      queryClient.setQueryData([...BUYERS_KEY, 'detail', id], account);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: BUYERS_KEY });
      void queryClient.invalidateQueries({ queryKey: BUYER_GROUPS_KEY });
    },
  });
}
