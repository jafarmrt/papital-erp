import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { FormCreateInput, FormDetail, FormList, FormSaveInput, FormSwitchInput } from '../../lib/storefront/storefrontFormContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 10f: «فرم‌های سایت» of the sidebar's «فروشگاه سایت» */
export const FORMS_KEY = [...STOREFRONT_KEY, 'forms'] as const;

export function useFormListQuery() {
  return useQuery<FormList>({
    queryKey: [...FORMS_KEY, 'list'],
    queryFn: async () => (await fetchJson('/storefront/forms')) as FormList,
    staleTime: 0,
  });
}

export function useFormQuery(id: number | null) {
  return useQuery<FormDetail>({
    queryKey: [...FORMS_KEY, 'detail', id],
    queryFn: async () => ((await fetchJson(`/storefront/forms/${id}`)) as { data: FormDetail }).data,
    enabled: id !== null,
    staleTime: 0,
  });
}

export function useCreateFormMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FormCreateInput) => ((await fetchJson('/storefront/forms', { method: 'POST', body: JSON.stringify(input) })) as { data: FormDetail }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}

export function useSaveFormMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FormSaveInput) => ((await fetchJson(`/storefront/forms/${id}`, { method: 'PUT', body: JSON.stringify(input) })) as { data: FormDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...FORMS_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}

/** «این فرم روی سایت باشد»: the switch is sent the state it should take, under the form's version */
export function useFormEnabledMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FormSwitchInput) => ((await fetchJson(`/storefront/forms/${id}/enabled`, { method: 'PUT', body: JSON.stringify(input) })) as { data: FormDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...FORMS_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}

/** «پروندهٔ فروش هم بساز»: the switch is sent the state it should take, under the form's version */
export function useFormMakesLeadMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FormSwitchInput) => ((await fetchJson(`/storefront/forms/${id}/makes-lead`, { method: 'PUT', body: JSON.stringify(input) })) as { data: FormDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...FORMS_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}

export function useDeleteFormMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/forms/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}
