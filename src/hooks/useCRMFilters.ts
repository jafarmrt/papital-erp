import { useState } from 'react';
import { getPastJalaliDate, getTodayJalaliDate } from '../utils';

export type CrmDatePreset = '1m' | '7d' | 'today' | 'all' | 'custom';

export function normalizeLeadStage(stage?: string): string {
  let s = stage || '';
  if (s === 'contacted') s = 'lead';
  if (s === 'negotiation') s = 'proposal';
  return s;
}

export function buildLeadQueryParams(filters: {
  searchTerm?: string;
  filterSeller?: string;
  filterStage?: string;
  filterCustomer?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.searchTerm) params.append('search', filters.searchTerm);
  if (filters.filterSeller) params.append('assignedPersonnelId', filters.filterSeller);
  if (filters.filterStage) params.append('stage', filters.filterStage);
  if (filters.filterCustomer) params.append('customerName', filters.filterCustomer);
  return params;
}

export function buildActivityQueryParams(fromDate?: string, toDate?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (fromDate) params.append('fromDate', fromDate);
  if (toDate) params.append('toDate', toDate);
  return params;
}

export function useCRMFilters() {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterSeller, setFilterSeller] = useState<string>('');
  const [filterStage, setFilterStage] = useState<string>('');
  const [filterCustomer, setFilterCustomer] = useState<string>('');

  const [datePreset, setDatePreset] = useState<CrmDatePreset>('1m');
  const [fromDate, setFromDate] = useState<string>(getPastJalaliDate(30));
  const [toDate, setToDate] = useState<string>(getTodayJalaliDate());

  const handleApplyPreset = (preset: CrmDatePreset) => {
    setDatePreset(preset);
    if (preset === '1m') {
      setFromDate(getPastJalaliDate(30));
      setToDate(getTodayJalaliDate());
    } else if (preset === '7d') {
      setFromDate(getPastJalaliDate(7));
      setToDate(getTodayJalaliDate());
    } else if (preset === 'today') {
      setFromDate(getTodayJalaliDate());
      setToDate(getTodayJalaliDate());
    } else if (preset === 'all') {
      setFromDate('');
      setToDate('');
    }
  };

  return {
    searchTerm,
    setSearchTerm,
    filterSeller,
    setFilterSeller,
    filterStage,
    setFilterStage,
    filterCustomer,
    setFilterCustomer,
    datePreset,
    setDatePreset,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    handleApplyPreset
  };
}
