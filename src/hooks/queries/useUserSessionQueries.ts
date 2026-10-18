import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { UserSessionList, UserSessionView } from '../../lib/auth/userSessions';

/**
 * 10.2 package 8 (D-07): the signed-in devices of the user (`userId` null) or of another user (users page, `users.manage`),
 * and closing one or all of them.
 */
const sessionKeys = (userId: number | null) => ['user-sessions', userId ?? 'mine'] as const;

const sessionsBase = (userId: number | null) => (userId === null ? '/auth/sessions' : `/users/${userId}/sessions`);

export function useUserSessionsQuery(userId: number | null, enabled = true) {
  return useQuery<UserSessionView[]>({
    queryKey: sessionKeys(userId),
    queryFn: async () => {
      const res = await fetchJson(sessionsBase(userId)) as UserSessionList | null;
      return Array.isArray(res?.sessions) ? res.sessions : [];
    },
    enabled,
    staleTime: 0,
  });
}

export function useCloseSessionMutation(userId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: number) => fetchJson(`${sessionsBase(userId)}/${sessionId}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: sessionKeys(userId) }); },
  });
}

/** own account: every other device; another user: every device */
export function useCloseManySessionsMutation(userId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => fetchJson(
      userId === null ? '/auth/sessions/close-others' : `/users/${userId}/sessions/close-all`, { method: 'POST' },
    ) as Promise<{ closedCount?: number }>,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: sessionKeys(userId) }); },
  });
}
