import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { LinkCodeIssued, Messenger, MessengerBotView, MessengerLinkAdminRow, MyMessengerLink } from '../../lib/messenger/messengerLinks';
import type { MessengerPreference, NotificationCategory } from '../../lib/notifications/notificationCategories';

/** v10.1.38 (messenger plan part 1): the user's own links to the staff bots and, for the system admin, the bots */
const MESSENGER_KEYS = {
  mine: ['messenger', 'links', 'mine'] as const,
  bots: ['messenger', 'bots'] as const,
  adminLinks: ['messenger', 'links', 'all'] as const,
  preferences: ['messenger', 'preferences', 'mine'] as const,
};

const listOf = <T,>(res: unknown): T[] => {
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
};

export function useMyMessengerLinksQuery(enabled = true) {
  return useQuery<MyMessengerLink[]>({
    queryKey: MESSENGER_KEYS.mine,
    queryFn: async () => listOf<MyMessengerLink>(await fetchJson('/messenger/links/mine')),
    enabled,
    staleTime: 0,
  });
}

export function useIssueLinkCodeMutation() {
  return useMutation({
    mutationFn: async (messenger: Messenger) => fetchJson(`/messenger/links/${messenger}/code`, { method: 'POST' }) as Promise<LinkCodeIssued>,
  });
}

export function useSendTestMessageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messenger: Messenger) => fetchJson(`/messenger/links/${messenger}/test`, { method: 'POST' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: MESSENGER_KEYS.mine }); },
  });
}

export function useUnlinkMessengerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messenger: Messenger) => fetchJson(`/messenger/links/${messenger}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: MESSENGER_KEYS.mine }); },
  });
}

export function useRefreshMyMessengerLinks() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: MESSENGER_KEYS.mine }), [queryClient]);
}

export function useMessengerBotsQuery() {
  return useQuery<MessengerBotView[]>({
    queryKey: MESSENGER_KEYS.bots,
    queryFn: async () => listOf<MessengerBotView>(await fetchJson('/messenger/bots')),
  });
}

export function useMessengerAdminLinksQuery() {
  return useQuery<MessengerLinkAdminRow[]>({
    queryKey: MESSENGER_KEYS.adminLinks,
    queryFn: async () => listOf<MessengerLinkAdminRow>(await fetchJson('/messenger/links')),
  });
}

export function useSaveBotTokenMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messenger, token }: { messenger: Messenger; token: string }) =>
      fetchJson(`/messenger/bots/${messenger}`, { method: 'PUT', body: JSON.stringify({ token }) }) as Promise<MessengerBotView>,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MESSENGER_KEYS.bots });
      void queryClient.invalidateQueries({ queryKey: MESSENGER_KEYS.adminLinks });
    },
  });
}

/** v10.1.39 (plan part 2): «در پیام‌رسان هم بفرست» per notification category, for the user's own account */
export function useMyMessengerPreferencesQuery(enabled = true) {
  return useQuery<MessengerPreference[]>({
    queryKey: MESSENGER_KEYS.preferences,
    queryFn: async () => listOf<MessengerPreference>(await fetchJson('/messenger/preferences/mine')),
    enabled,
  });
}

export function useSetMessengerPreferenceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { category: NotificationCategory; sendToMessenger: boolean }) =>
      listOf<MessengerPreference>(await fetchJson('/messenger/preferences/mine', { method: 'PUT', body: JSON.stringify(body) })),
    onSuccess: (rows) => { queryClient.setQueryData(MESSENGER_KEYS.preferences, rows); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: MESSENGER_KEYS.preferences }); },
  });
}
