import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { MessageDetail, MessageList, MessageStatusInput } from '../../lib/storefront/storefrontMessageContracts';
import type { MessageStatus } from '../../lib/storefront/storefrontMessageRules';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 10f: «پیام‌های سایت» of the sidebar's «فروشگاه سایت» */
export const MESSAGES_KEY = [...STOREFRONT_KEY, 'messages'] as const;

export function useMessageListQuery(page: number, status: MessageStatus | null) {
  return useQuery<MessageList>({
    queryKey: [...MESSAGES_KEY, 'list', page, status],
    queryFn: async () => (await fetchJson(`/storefront/messages?page=${page}${status ? `&status=${status}` : ''}`)) as MessageList,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useMessageQuery(id: number | null) {
  return useQuery<MessageDetail>({
    queryKey: [...MESSAGES_KEY, 'detail', id],
    queryFn: async () => ((await fetchJson(`/storefront/messages/${id}`)) as { data: MessageDetail }).data,
    enabled: id !== null,
    staleTime: 0,
  });
}

/** «دیده‌شده», «پاسخ داده شد» or back to «تازه»: the state to take, under the message's version */
export function useMessageStatusMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MessageStatusInput) => ((await fetchJson(`/storefront/messages/${id}/status`, { method: 'PUT', body: JSON.stringify(input) })) as { data: MessageDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...MESSAGES_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }); },
  });
}

export function useDeleteMessageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/messages/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }); },
  });
}
