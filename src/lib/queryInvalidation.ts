import { QueryClient, InvalidateQueryFilters } from '@tanstack/react-query';
import { QUERY_KEYS, QueryDomain } from './queryKeys';

export interface InvalidateOptions {
  exact?: boolean;
  refetchType?: 'active' | 'all' | 'none';
}

/**
 * Standardized function to invalidate a single domain's query hierarchy.
 */
export async function invalidateDomain(
  queryClient: QueryClient,
  domain: QueryDomain,
  options: InvalidateOptions = {}
): Promise<void> {
  const domainKey = QUERY_KEYS[domain]?.all;
  if (!domainKey) return;

  const filters: InvalidateQueryFilters = {
    queryKey: domainKey,
    exact: options.exact ?? false,
    refetchType: options.refetchType ?? 'active',
  };

  await queryClient.invalidateQueries(filters);
}

/**
 * Standardized function to invalidate multiple query domains simultaneously.
 */
export async function invalidateDomains(
  queryClient: QueryClient,
  domains: QueryDomain[],
  options: InvalidateOptions = {}
): Promise<void> {
  await Promise.all(domains.map((domain) => invalidateDomain(queryClient, domain, options)));
}

/**
 * Predefined cross-domain invalidation presets for common ERP/CRM events.
 */
export const INVALIDATION_PRESETS = {
  // Triggered when raw materials or inventory items change
  inventoryChange: ['items', 'dashboard', 'transfers', 'pendingMaterials'] as QueryDomain[],

  // Triggered when customers or sales leads are modified
  customerChange: ['customers', 'crm', 'dashboard'] as QueryDomain[],

  // Triggered when transfers or designs are updated
  transferChange: ['transfers', 'items', 'dashboard'] as QueryDomain[],

  // Triggered when pending materials are approved or rejected
  pendingMaterialChange: ['pendingMaterials', 'items', 'dashboard'] as QueryDomain[],

  // Triggered when system settings are modified
  settingsChange: ['settings', 'categories', 'warehouses', 'dashboard'] as QueryDomain[],

  // Triggered when notifications are updated
  notificationChange: ['notifications'] as QueryDomain[],

  // Triggered when a workflow state transition is executed. TD-469 (یافته B14-27): اقدام گردش کار سند را قطعی، وضعیت سند
  // حسابداری را عوض، درخواست خرید را دریافت و سند افتتاحیه صادر می‌کند؛ پیش‌تر این فهرست‌ها تا پنج دقیقه کهنه می‌ماندند
  workflowChange: ['workflow', 'dashboard', 'notifications', 'items', 'documents', 'procurement', 'accounting', 'inventory'] as QueryDomain[],

  // v9.0.292 (TD-796، یافته B08-27): ثبت، ویرایش و ابطال هر سند (فاکتور، پیش‌فاکتور، سند انبار): کاردکس، سند حسابداری،
  // کالاها، پیشخوان، رزروها، پروژه (کسر و بازگشت رزرو)، پرونده فروش (آزاد شدن پرونده با ابطال، TD-423) و طرف حساب.
  // پیش‌تر ثبت سند انبار و ابطال فقط بخشی از این‌ها را باطل می‌کردند و بقیه تا پنج دقیقه کهنه می‌ماندند
  documentChange: [
    'documents', 'transactions', 'accounting', 'inventory', 'items', 'dashboard', 'transfers', 'pendingMaterials', 'crm', 'projects', 'customers',
  ] as QueryDomain[],

  // v9.0.292 (TD-796): تسویه فاکتور: حساب‌های بانکی، خزانه و سند حسابداری، مانده و وضعیت سند، کارت حساب طرف حساب و پیشخوان
  settlementChange: ['documents', 'accounting', 'customers', 'dashboard'] as QueryDomain[],
} as const;

/**
 * Standardized function to invalidate queries based on a preset event name.
 */
export async function invalidatePreset(
  queryClient: QueryClient,
  preset: keyof typeof INVALIDATION_PRESETS,
  options: InvalidateOptions = {}
): Promise<void> {
  const domains = INVALIDATION_PRESETS[preset];
  if (domains) {
    await invalidateDomains(queryClient, [...domains], options);
  }
}
