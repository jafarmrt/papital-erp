import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type {
  StorefrontEmailSettingsInput, StorefrontEmailSettingsView, StorefrontEmailTestResult,
} from '../../lib/storefront/storefrontEmailContracts';

/** v12 phase 8e: the reads and writes of the «ایمیل» section of the «فروشگاه سایت» tab */
export const STOREFRONT_EMAIL_SETTINGS_KEY = ['storefront', 'email', 'settings'] as const;

export function useStorefrontEmailSettingsQuery() {
  return useQuery<StorefrontEmailSettingsView>({
    queryKey: STOREFRONT_EMAIL_SETTINGS_KEY,
    queryFn: async ({ signal }) => ((await fetchJson('/storefront/email/settings', { signal })) as { data: StorefrontEmailSettingsView }).data,
    staleTime: 0,
  });
}

export function useSaveStorefrontEmailSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StorefrontEmailSettingsInput) => ((await fetchJson('/storefront/email/settings', {
      method: 'PUT', body: JSON.stringify(input),
    })) as { data: StorefrontEmailSettingsView }).data,
    onSuccess: (view) => { queryClient.setQueryData(STOREFRONT_EMAIL_SETTINGS_KEY, view); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_EMAIL_SETTINGS_KEY }); },
  });
}

export function useSendTestEmailMutation() {
  return useMutation({
    mutationFn: async (input: { to: string }) => ((await fetchJson('/storefront/email/test', {
      method: 'POST', body: JSON.stringify(input),
    })) as { data: StorefrontEmailTestResult }).data,
  });
}
