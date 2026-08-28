import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { AppNotification } from '../../types';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain } from '../../lib/queryInvalidation';

export function useUnreadNotificationsCountQuery() {
  return useQuery<number>({
    queryKey: QUERY_KEYS.notifications.unreadCount(),
    queryFn: async () => {
      const res = await fetchJson('/notifications/unread-count');
      return typeof res?.count === 'number' ? res.count : 0;
    },
    refetchInterval: 30000, // Background poll every 30s
    staleTime: 15000,
  });
}

export function useNotificationsQuery(enabled = true) {
  return useQuery<AppNotification[]>({
    queryKey: QUERY_KEYS.notifications.list(),
    queryFn: async () => {
      const res = await fetchJson('/notifications');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    enabled,
    staleTime: 10000,
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/notifications/${id}/read`, { method: 'PUT' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'notifications');
    },
  });
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return fetchJson('/notifications/read-all', { method: 'PUT' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'notifications');
    },
  });
}

export function useDeleteNotificationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/notifications/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'notifications');
    },
  });
}
