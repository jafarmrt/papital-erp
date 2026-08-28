import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, settingsKeys } from '../../lib/queryKeys';
import { invalidatePreset, invalidateDomain } from '../../lib/queryInvalidation';
import { Category } from '../../types';

export interface SettingItem {
  key: string;
  value: string;
}

export interface WarehouseItem {
  id: number;
  name: string;
  code: string;
  is_active: number;
}

/**
 * Hook to query all system settings with React Query
 */
export function useSettingsQuery() {
  return useQuery<SettingItem[]>({
    queryKey: settingsKeys.all,
    queryFn: async () => {
      const res = await fetchJson('/settings');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to query all categories with React Query
 */
export function useCategoriesQuery(type?: string) {
  return useQuery<Category[]>({
    queryKey: QUERY_KEYS.categories.list(type),
    queryFn: async () => {
      const res = await fetchJson('/categories');
      const data: Category[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      if (type && type !== 'all') {
        return data.filter((c: any) => c.type === type);
      }
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Hook to query all warehouses with React Query
 */
export function useWarehousesQuery() {
  return useQuery<WarehouseItem[]>({
    queryKey: QUERY_KEYS.warehouses.list(),
    queryFn: async () => {
      const res = await fetchJson('/warehouses');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Hook to update system settings
 */
export function useSaveSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { settings: { key: string; value: string }[] } | Record<string, string>) => {
      return fetchJson('/settings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      invalidatePreset(queryClient, 'settingsChange');
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
      // V10-5.3: سایدبار بلافاصله به‌روز شود
      queryClient.invalidateQueries({ queryKey: ['menu_visibility'] });
      toast.success('تنظیمات با موفقیت ذخیره شدند');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ذخیره تنظیمات');
    },
  });
}

export const useUpdateSettings = useSaveSettingsMutation;

/**
 * V10-5.3: نقشه دید منو per-role — endpoint اختصاصی، کش کوتاه و بدون refetch روی focus
 * تا ویرایش در پنل مدیریت با focus تغییر پنجره پاک نشود.
 */
export function useMenuVisibilityQuery() {
  return useQuery<Record<string, string[]>>({
    queryKey: ['menu_visibility'],
    queryFn: async () => {
      const res = await fetchJson('/menu-visibility');
      return res && typeof res === 'object' && !Array.isArray(res) ? res : {};
    },
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Category Mutations
 */
export function useSaveCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id?: number | null; data: any }) => {
      if (id) {
        return fetchJson(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      }
      return fetchJson('/categories', { method: 'POST', body: JSON.stringify(data) });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'categories');
      invalidateDomain(queryClient, 'items');
      toast.success('دسته‌بندی با موفقیت ذخیره شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ذخیره دسته‌بندی');
    },
  });
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/categories/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'categories');
      invalidateDomain(queryClient, 'items');
      toast.success('دسته‌بندی با موفقیت حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف دسته‌بندی');
    },
  });
}

export function useResetDefaultCategoriesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return fetchJson('/categories/reset-defaults', { method: 'POST' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'categories');
      invalidateDomain(queryClient, 'items');
      toast.success('دسته‌بندی‌های پیش‌فرض با موفقیت به‌روزرسانی و همگام شدند.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در بازنشانی دسته‌بندی‌ها');
    },
  });
}

/**
 * Warehouse Mutations
 */
export function useSaveWarehouseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id?: number | null; data: any }) => {
      if (id) {
        return fetchJson(`/warehouses/${id}`, { method: 'PUT', body: JSON.stringify({ name: data.name }) });
      }
      return fetchJson('/warehouses', { method: 'POST', body: JSON.stringify(data) });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'warehouses');
      toast.success('اطلاعات انبار با موفقیت ذخیره شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ثبت انبار');
    },
  });
}

export function useDeleteWarehouseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/warehouses/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'warehouses');
      toast.success('انبار با موفقیت غیرفعال گردید');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف انبار');
    },
  });
}
