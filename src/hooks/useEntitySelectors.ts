import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { usePersonnelListQuery } from './queries/usePersonnelQueries';
import type { Customer } from '../types';

export interface EntitySelectOption<T = string | number> {
  value: T;
  label: string;
  subLabel?: string;
  data?: any;
}

export interface CustomerSelectOptionsConfig {
  onlyActive?: boolean;
  valueField?: 'id' | 'name' | 'code';
}

/**
 * Hook to fetch and format customers for SearchableSelect and form dropdowns.
 * Uses shared React Query cache (staleTime 5m) to prevent duplicate fetch calls.
 */
export function useCustomerSelectOptions(config: CustomerSelectOptionsConfig = {}) {
  const { onlyActive = true, valueField = 'id' } = config;

  const {
    data: customers = [],
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery<Customer[]>({
    queryKey: ['customers', 'selector-list'],
    queryFn: async () => {
      const res = await fetchJson('/customers?limit=1000');
      const raw = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      return raw;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const options = useMemo<EntitySelectOption[]>(() => {
    if (!Array.isArray(customers)) return [];

    return customers
      .filter((c) => {
        if (!c) return false;
        if (onlyActive && ((c as any).isDeleted || (c as any).is_deleted)) return false;
        return true;
      })
      .map((c) => {
        const custCode = (c as any).code || String(c.id);
        const val = valueField === 'name' ? c.name : (valueField === 'code' ? custCode : c.id);
        const codePart = (c as any).code ? ` (${(c as any).code})` : '';
        const phonePart = c.phone ? ` - ${c.phone}` : '';
        return {
          value: val,
          label: `${c.name}${codePart}`,
          subLabel: phonePart,
          data: c,
        };
      });
  }, [customers, onlyActive, valueField]);

  return {
    options,
    customers,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

/**
 * Hook to fetch and format suppliers/customers for purchase and split order modals.
 * Replaces duplicate fetchJson('/customers?limit=1000') across procurement components.
 */
export function useSupplierSelectOptions() {
  const { customers, isLoading, isFetching, error, refetch } = useCustomerSelectOptions();

  const options = useMemo(() => {
    if (!Array.isArray(customers)) return [];
    return customers.map((s) => ({
      value: s.name,
      label: `${s.partyType === 'supplier' ? '🏭 تامین‌کننده' : s.partyType === 'customer' ? '👤 مشتری' : '🤝 طرف‌حساب'}: ${s.name} ${s.supplierCategory ? `(${s.supplierCategory})` : ''} ${s.phone ? `- ${s.phone}` : ''}`.trim(),
      _raw: s,
    }));
  }, [customers]);

  return {
    options,
    suppliers: customers,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}


export interface PersonnelSelectOptionsConfig {
  onlyActive?: boolean;
  valueField?: 'id' | 'fullName' | 'personnelCode';
}

/**
 * Hook to fetch and format personnel for SearchableSelect and form dropdowns.
 * Uses shared React Query cache (staleTime 5m) to eliminate repetitive network roundtrips.
 */
export function usePersonnelSelectOptions(config: PersonnelSelectOptionsConfig = {}) {
  const { onlyActive = true, valueField = 'id' } = config;

  const {
    data: personnelList = [],
    isLoading,
    isFetching,
    error,
    refetch
  } = usePersonnelListQuery();

  const options = useMemo<EntitySelectOption[]>(() => {
    if (!Array.isArray(personnelList)) return [];

    return personnelList
      .filter((p) => {
        if (!p) return false;
        if (onlyActive && p.employmentStatus && p.employmentStatus !== 'فعال') return false;
        return true;
      })
      .map((p) => {
        const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'بدون نام';
        const val = valueField === 'fullName' ? name : (valueField === 'personnelCode' ? (p.personnelCode || String(p.id)) : p.id);
        const codePart = p.personnelCode ? ` (${p.personnelCode})` : '';
        const jobPart = p.jobTitle ? ` - ${p.jobTitle}` : '';

        return {
          value: val,
          label: `${name}${codePart}`,
          subLabel: jobPart,
          data: p,
        };
      });
  }, [personnelList, onlyActive, valueField]);

  return {
    options,
    personnelList,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}
