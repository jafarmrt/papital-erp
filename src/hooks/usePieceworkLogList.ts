import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast as hotToast } from 'react-hot-toast';
import { fetchJson } from '../api';
import type { PieceworkLog } from '../types';
import { QUERY_KEYS } from '../lib/queryKeys';
import { errorMessageOf, getTodayJalaliDate } from '../utils';
import {
  WORK_LOG_PAGE_SIZE, jalaliMonthRange, workLogListQuery, type WorkLogPage, type WorkLogSummary
} from '../lib/piecework/workLogList';

/**
 * v9.0.330 (TD-811، B12P-08): فهرست کارکرد صفحه کارمزدی از سرور، یک صفحه با فیلترهای SQL، و کارت‌ها و «هزینه پروژه‌ها»
 * از جمع SQL. پیش‌تر صفحه همه کارکردهای عمر سامانه را می‌گرفت و فیلتر و جمع را در مرورگر حساب می‌کرد. صفحه با ماه
 * جلالی جاری باز می‌شود.
 *
 * v10.2 package 11 part 5c (TD-1361, OBS-R2-102): the page, the summary and the payslip preview are React Query reads
 * under `piecework`, so a write anywhere that invalidates that domain refreshes them; each opening reads them again.
 */

const EMPTY_PAGE: WorkLogPage<PieceworkLog> = { data: [], total: 0, page: 1, limit: WORK_LOG_PAGE_SIZE, totalAmount: 0 };
const EMPTY_SUMMARY: WorkLogSummary = { totalAmount: 0, pendingAmount: 0, logCount: 0, projects: [] };
const SEARCH_DELAY_MS = 300;

const NO_LOGS: PieceworkLog[] = [];

export function usePieceworkLogList() {
  const [initialMonth] = useState(() => jalaliMonthRange(getTodayJalaliDate()));
  const [personnelFilter, setPersonnelFilter] = useState<string | number>('all');
  const [projectFilter, setProjectFilter] = useState<string | number>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>(initialMonth?.startDate ?? '');
  const [endDateFilter, setEndDateFilter] = useState<string>(initialMonth?.endDate ?? '');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // جستجو پس از مکث تایپ فرستاده می‌شود و فهرست را به صفحه نخست می‌برد
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(searchQuery);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const query = useMemo(() => workLogListQuery({
    personnelId: personnelFilter, projectId: projectFilter, status: statusFilter,
    startDate: startDateFilter, endDate: endDateFilter, search: appliedSearch,
  }, page, WORK_LOG_PAGE_SIZE), [personnelFilter, projectFilter, statusFilter, startDateFilter, endDateFilter, appliedSearch, page]);

  const listQuery = useQuery<WorkLogPage<PieceworkLog>>({
    queryKey: QUERY_KEYS.piecework.logs({ list: query }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<WorkLogPage<PieceworkLog>>(`/piecework/logs?${query}`, { signal });
      return { ...EMPTY_PAGE, ...res, data: Array.isArray(res?.data) ? res.data : [] };
    },
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
  useEffect(() => {
    if (listQuery.error) hotToast.error(errorMessageOf(listQuery.error) || 'خطا در دریافت کارکردها');
  }, [listQuery.error]);
  const logPage = listQuery.isError ? EMPTY_PAGE : (listQuery.data ?? EMPTY_PAGE);
  const loading = listQuery.isPending || listQuery.isPlaceholderData;

  const summaryQuery = useQuery<WorkLogSummary>({
    queryKey: QUERY_KEYS.piecework.logSummary(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<WorkLogSummary>('/piecework/logs/summary', { signal });
      return { ...EMPTY_SUMMARY, ...res, projects: Array.isArray(res?.projects) ? res.projects : [] };
    },
    refetchOnMount: 'always',
  });
  const summary = summaryQuery.isError ? EMPTY_SUMMARY : (summaryQuery.data ?? EMPTY_SUMMARY);

  /** هر فیلتر تازه فهرست را از صفحه نخست نشان می‌دهد */
  const resettingPage = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  return {
    logs: logPage.data,
    logsTotal: logPage.total,
    logsFilteredAmount: logPage.totalAmount,
    logsPage: page,
    logsPageCount: Math.max(1, Math.ceil(logPage.total / (logPage.limit || WORK_LOG_PAGE_SIZE))),
    setLogsPage: setPage,
    logsLoading: loading,
    logSummary: summary,
    selectedPersonnelFilter: personnelFilter,
    setSelectedPersonnelFilter: resettingPage(setPersonnelFilter),
    selectedProjectFilter: projectFilter,
    setSelectedProjectFilter: resettingPage(setProjectFilter),
    statusFilter,
    setStatusFilter: resettingPage(setStatusFilter),
    startDateFilter,
    setStartDateFilter: resettingPage(setStartDateFilter),
    endDateFilter,
    setEndDateFilter: resettingPage(setEndDateFilter),
    logSearchQuery: searchQuery,
    setLogSearchQuery: setSearchQuery,
  };
}

/**
 * v9.0.330 (TD-811): پیش‌نمایش صدور فیش، کارکردهای تسویه‌نشده همان پرسنل و بازه از سرور (پیش‌تر از فهرست کامل
 * کارکردهای مرورگر فیلتر می‌شد).
 */
export function usePayrollPreviewLogs(open: boolean, personnelId: number | '', startDate: string, endDate: string): PieceworkLog[] {
  const enabled = open && Boolean(personnelId) && Boolean(startDate) && Boolean(endDate);
  const query = workLogListQuery({ personnelId, status: 'pending', startDate, endDate });
  const preview = useQuery<PieceworkLog[]>({
    queryKey: QUERY_KEYS.piecework.logs({ preview: query }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<PieceworkLog[]>(`/piecework/logs?${query}`, { signal });
      return Array.isArray(res) ? res : [];
    },
    enabled,
    // the payslip form always reads the pending logs again when it asks for them
    staleTime: 0,
  });
  return enabled && !preview.isError ? (preview.data ?? NO_LOGS) : NO_LOGS;
}
