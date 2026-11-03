import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type {
  SmsMessagePage, SmsTestResult, StorefrontSmsSettingsInput, StorefrontSmsSettingsView,
} from '../../lib/storefront/storefrontSmsContracts';
import type { SmsKind, SmsMessageStatus } from '../../lib/storefront/storefrontSmsRules';

/** v11 phase 8.4a: the reads and writes of the «پیامک» section of the «فروشگاه سایت» tab */
export const STOREFRONT_SMS_KEY = ['storefront', 'sms'] as const;
export const STOREFRONT_SMS_SETTINGS_KEY = [...STOREFRONT_SMS_KEY, 'settings'] as const;
export const STOREFRONT_SMS_LOG_KEY = [...STOREFRONT_SMS_KEY, 'messages'] as const;

export function useStorefrontSmsSettingsQuery() {
  return useQuery<StorefrontSmsSettingsView>({
    queryKey: STOREFRONT_SMS_SETTINGS_KEY,
    queryFn: async () => ((await fetchJson('/storefront/sms/settings')) as { data: StorefrontSmsSettingsView }).data,
    staleTime: 0,
  });
}

export function useSaveStorefrontSmsSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StorefrontSmsSettingsInput) => ((await fetchJson('/storefront/sms/settings', {
      method: 'PUT', body: JSON.stringify(input),
    })) as { data: StorefrontSmsSettingsView }).data,
    onSuccess: (view) => { queryClient.setQueryData(STOREFRONT_SMS_SETTINGS_KEY, view); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SMS_SETTINGS_KEY }); },
  });
}

export function useSendTestSmsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { phone: string; kind: SmsKind }) => ((await fetchJson('/storefront/sms/test', {
      method: 'POST', body: JSON.stringify(input),
    })) as { data: SmsTestResult }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SMS_LOG_KEY }); },
  });
}

export function useStorefrontSmsLogQuery(filter: { page: number; status: SmsMessageStatus | '' }) {
  return useQuery<SmsMessagePage>({
    queryKey: [...STOREFRONT_SMS_LOG_KEY, filter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(filter.page), limit: '20' });
      if (filter.status) params.set('status', filter.status);
      return (await fetchJson(`/storefront/sms/messages?${params.toString()}`, { signal })) as SmsMessagePage;
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}
