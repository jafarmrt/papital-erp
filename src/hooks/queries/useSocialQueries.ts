import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { BirthdayReaction, BirthdaysAnswer } from '../../lib/social/birthdays';
import type { PresenceColleague, SocialPreferences, WhatsNewAnswer } from '../../lib/social/presence';

/** v10.2 package 9: the group dashboard («پیشخوان گروهی»): birthdays, greetings, presence and the whats-new card */
export const SOCIAL_KEYS = {
  birthdays: ['social', 'birthdays'] as const,
  presence: ['social', 'presence'] as const,
  preferences: ['social', 'preferences'] as const,
  whatsNew: ['social', 'whats-new'] as const,
};

/** the presence card refreshes every minute, only while the page is visible (React Query pauses in the background) */
const PRESENCE_REFRESH_MS = 60 * 1000;

const emptyBirthdays: BirthdaysAnswer = { myBirthdayToday: false, birthdays: [] };

function birthdaysOf(res: unknown): BirthdaysAnswer {
  const answer = res as Partial<BirthdaysAnswer> | null;
  return {
    myBirthdayToday: answer?.myBirthdayToday === true,
    birthdays: Array.isArray(answer?.birthdays) ? answer.birthdays : [],
  };
}

export function useBirthdaysQuery() {
  return useQuery<BirthdaysAnswer>({
    queryKey: SOCIAL_KEYS.birthdays,
    queryFn: async () => birthdaysOf(await fetchJson('/social/birthdays')),
    placeholderData: emptyBirthdays,
  });
}

export interface GreetingInput {
  personnelId: number;
  reaction: BirthdayReaction | null;
  message: string;
}

export function useSaveGreetingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ personnelId, reaction, message }: GreetingInput) => birthdaysOf(await fetchJson(
      `/social/birthdays/${personnelId}/greeting`,
      { method: 'PUT', body: JSON.stringify({ reaction, message }) },
    )),
    onSuccess: (answer) => { queryClient.setQueryData(SOCIAL_KEYS.birthdays, answer); },
  });
}

export function useDeleteGreetingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (personnelId: number) => birthdaysOf(await fetchJson(`/social/birthdays/${personnelId}/greeting`, { method: 'DELETE' })),
    onSuccess: (answer) => { queryClient.setQueryData(SOCIAL_KEYS.birthdays, answer); },
  });
}

export function usePresenceQuery() {
  return useQuery<PresenceColleague[]>({
    queryKey: SOCIAL_KEYS.presence,
    queryFn: async () => {
      const data = (await fetchJson('/social/presence') as { data?: unknown } | null)?.data;
      return Array.isArray(data) ? data as PresenceColleague[] : [];
    },
    refetchInterval: PRESENCE_REFRESH_MS,
    staleTime: 0,
  });
}

export function useSocialPreferencesQuery(enabled = true) {
  return useQuery<SocialPreferences>({
    queryKey: SOCIAL_KEYS.preferences,
    queryFn: async () => fetchJson('/social/preferences') as Promise<SocialPreferences>,
    enabled,
    staleTime: 0,
  });
}

export function useSaveSocialPreferencesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Pick<SocialPreferences, 'showPresence'>> & { showBirthday?: boolean }) =>
      fetchJson('/social/preferences', { method: 'PUT', body: JSON.stringify(input) }) as Promise<SocialPreferences>,
    onSuccess: (answer) => {
      queryClient.setQueryData(SOCIAL_KEYS.preferences, answer);
      void queryClient.invalidateQueries({ queryKey: SOCIAL_KEYS.birthdays });
    },
  });
}

export function useWhatsNewQuery() {
  return useQuery<WhatsNewAnswer | null>({
    queryKey: SOCIAL_KEYS.whatsNew,
    queryFn: async () => ((await fetchJson('/social/whats-new') as { data?: WhatsNewAnswer | null } | null)?.data) ?? null,
  });
}

export function useDismissWhatsNewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: string) =>
      ((await fetchJson('/social/whats-new/dismiss', { method: 'POST', body: JSON.stringify({ version }) }) as { data?: WhatsNewAnswer | null } | null)?.data) ?? null,
    onSuccess: (answer) => { queryClient.setQueryData(SOCIAL_KEYS.whatsNew, answer); },
  });
}
