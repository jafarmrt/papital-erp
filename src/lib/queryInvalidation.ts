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

  // Triggered when a workflow state transition is executed
  workflowChange: ['workflow', 'dashboard', 'notifications', 'items'] as QueryDomain[],
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
