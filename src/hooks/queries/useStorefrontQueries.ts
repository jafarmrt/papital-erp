import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { BrandImageKind } from '../../lib/storefront/storefrontRules';
import type {
  ShippingMethodInput, ShippingMethodRow, StorefrontProductAdminPage, StorefrontProductAdminRow, StorefrontProductInput,
  StorefrontBrandView, StorefrontSettingsInput, StorefrontSettingsView,
} from '../../lib/storefront/storefrontContracts';
import type { AdminOrderDetail, AdminOrderPage } from '../../lib/storefront/storefrontOrderContracts';
import type { OrderStatus } from '../../lib/storefront/storefrontOrderRules';

/** v11 phase 8.1: the reads of the «فروشگاه سایت» settings tab; a write refreshes the part it changed */
export const STOREFRONT_KEY = ['storefront'] as const;
export const STOREFRONT_SETTINGS_KEY = [...STOREFRONT_KEY, 'settings'] as const;
export const STOREFRONT_SHIPPING_KEY = [...STOREFRONT_KEY, 'shipping'] as const;
export const STOREFRONT_PRODUCTS_KEY = [...STOREFRONT_KEY, 'products'] as const;

export function useStorefrontSettingsQuery() {
  return useQuery<StorefrontSettingsView>({
    queryKey: STOREFRONT_SETTINGS_KEY,
    queryFn: async () => ((await fetchJson('/storefront/settings')) as { data: StorefrontSettingsView }).data,
    staleTime: 0,
  });
}

export function useSaveStorefrontSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StorefrontSettingsInput) => ((await fetchJson('/storefront/settings', {
      method: 'PUT', body: JSON.stringify(input),
    })) as { data: StorefrontSettingsView }).data,
    onSuccess: (view) => { queryClient.setQueryData(STOREFRONT_SETTINGS_KEY, view); },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: STOREFRONT_SETTINGS_KEY });
      // the retail list and the warehouse change what the product list shows
      void queryClient.invalidateQueries({ queryKey: STOREFRONT_PRODUCTS_KEY });
    },
  });
}

export function useRotateStorefrontKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => ((await fetchJson('/storefront/api-key', { method: 'POST', body: JSON.stringify({}) })) as {
      data: { apiKey: string; hint: string; createdAt: string };
    }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SETTINGS_KEY }); },
  });
}

export function useShippingMethodsQuery() {
  return useQuery<ShippingMethodRow[]>({
    queryKey: STOREFRONT_SHIPPING_KEY,
    queryFn: async () => ((await fetchJson('/storefront/shipping-methods')) as { data: ShippingMethodRow[] }).data,
    staleTime: 0,
  });
}

export function useSaveShippingMethodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, input }: { id: number | null; version: number; input: ShippingMethodInput }) => (
      (await fetchJson(id === null ? '/storefront/shipping-methods' : `/storefront/shipping-methods/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        body: JSON.stringify(id === null ? input : { ...input, version }),
      })) as { data: ShippingMethodRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SHIPPING_KEY }); },
  });
}

export function useDeleteShippingMethodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/shipping-methods/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SHIPPING_KEY }); },
  });
}

export interface StorefrontProductFilter {
  page: number;
  q: string;
  published: 'all' | 'published' | 'unpublished';
}

export const STOREFRONT_PRODUCTS_PAGE_SIZE = 50;

export function useStorefrontProductsQuery(filter: StorefrontProductFilter) {
  return useQuery<StorefrontProductAdminPage>({
    queryKey: [...STOREFRONT_PRODUCTS_KEY, filter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(filter.page), limit: String(STOREFRONT_PRODUCTS_PAGE_SIZE), published: filter.published });
      if (filter.q.trim()) params.set('q', filter.q.trim());
      return (await fetchJson(`/storefront/products?${params.toString()}`)) as StorefrontProductAdminPage;
    },
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useSaveStorefrontProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, input }: { itemId: number; input: StorefrontProductInput }) => ((await fetchJson(`/storefront/products/${itemId}`, {
      method: 'PUT', body: JSON.stringify(input),
    })) as { data: StorefrontProductAdminRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_PRODUCTS_KEY }); },
  });
}

/** v11 phase 8.3: saves or removes the site's logo or browser icon */
export function useSaveStorefrontBrandMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, image, version }: { kind: BrandImageKind; image: string; version: number }) => ((await fetchJson(`/storefront/brand/${kind}`, {
      method: 'PUT', body: JSON.stringify({ image, version }),
    })) as { data: StorefrontBrandView }).data,
    // the logo and the icon share one version: the new one goes in at once, so a second save right after is not stale
    onSuccess: (brand) => {
      queryClient.setQueryData<StorefrontSettingsView>(STOREFRONT_SETTINGS_KEY, view => (view ? { ...view, brand } : view));
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SETTINGS_KEY }); },
  });
}

/**
 * v11 phase 8.2a: the «سفارش‌های سایت» page. A list page and one order's detail; every action answers the order again,
 * so the detail is replaced in place and the list is refreshed.
 */
export const STOREFRONT_ORDERS_KEY = [...STOREFRONT_KEY, 'orders'] as const;
export const STOREFRONT_ORDERS_PAGE_SIZE = 30;

export interface StorefrontOrderFilter {
  page: number;
  q: string;
  status: OrderStatus | 'open' | '';
}

export function useStorefrontOrdersQuery(filter: StorefrontOrderFilter) {
  return useQuery<AdminOrderPage>({
    queryKey: [...STOREFRONT_ORDERS_KEY, 'list', filter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(filter.page), limit: String(STOREFRONT_ORDERS_PAGE_SIZE) });
      if (filter.q.trim()) params.set('q', filter.q.trim());
      if (filter.status) params.set('status', filter.status);
      return (await fetchJson(`/storefront/orders?${params.toString()}`)) as AdminOrderPage;
    },
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useStorefrontOrderQuery(id: number | null) {
  return useQuery<AdminOrderDetail>({
    queryKey: [...STOREFRONT_ORDERS_KEY, 'detail', id],
    queryFn: async () => ((await fetchJson(`/storefront/orders/${id}`)) as { data: AdminOrderDetail }).data,
    enabled: id !== null,
    staleTime: 0,
  });
}

export type StorefrontOrderAction =
  | { kind: 'confirm'; receiptId: number }
  | { kind: 'reject-receipt'; receiptId: number; reason: string }
  | { kind: 'cancel' }
  | { kind: 'fulfil'; status: 'shipped' | 'delivered'; trackingCode: string };

export function useStorefrontOrderActionMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, version }: { action: StorefrontOrderAction; version: number }) => {
      const { kind, ...rest } = action;
      return ((await fetchJson(`/storefront/orders/${id}/${kind}`, {
        method: 'POST', body: JSON.stringify({ ...rest, version }),
      })) as { data: AdminOrderDetail }).data;
    },
    onSuccess: (order) => { queryClient.setQueryData([...STOREFRONT_ORDERS_KEY, 'detail', id], order); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_ORDERS_KEY }); },
  });
}
