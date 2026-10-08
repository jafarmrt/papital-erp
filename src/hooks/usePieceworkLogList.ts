import { useEffect, useMemo, useState } from 'react';
import { toast as hotToast } from 'react-hot-toast';
import { fetchJson } from '../api';
import type { PieceworkLog } from '../types';
import { errorMessageOf, getTodayJalaliDate } from '../utils';
import {
  WORK_LOG_PAGE_SIZE, jalaliMonthRange, workLogListQuery, type WorkLogPage, type WorkLogSummary
} from '../lib/piecework/workLogList';

/**
 * v9.0.325 (TD-811، B12P-08): فهرست کارکرد صفحه کارمزدی از سرور، یک صفحه با فیلترهای SQL، و کارت‌ها و «هزینه پروژه‌ها»
 * از جمع SQL. پیش‌تر صفحه همه کارکردهای عمر سامانه را می‌گرفت و فیلتر و جمع را در مرورگر حساب می‌کرد. صفحه با ماه
 * جلالی جاری باز می‌شود.
 */

const EMPTY_PAGE: WorkLogPage<PieceworkLog> = { data: [], total: 0, page: 1, limit: WORK_LOG_PAGE_SIZE, totalAmount: 0 };
const EMPTY_SUMMARY: WorkLogSummary = { totalAmount: 0, pendingAmount: 0, logCount: 0, projects: [] };
const SEARCH_DELAY_MS = 300;

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

export function usePieceworkLogList(reloadKey: number) {
  const [initialMonth] = useState(() => jalaliMonthRange(getTodayJalaliDate()));
  const [personnelFilter, setPersonnelFilter] = useState<string | number>('all');
  const [projectFilter, setProjectFilter] = useState<string | number>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>(initialMonth?.startDate ?? '');
  const [endDateFilter, setEndDateFilter] = useState<string>(initialMonth?.endDate ?? '');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [logPage, setLogPage] = useState<WorkLogPage<PieceworkLog>>(EMPTY_PAGE);
  const [summary, setSummary] = useState<WorkLogSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState<boolean>(true);

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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchJson<WorkLogPage<PieceworkLog>>(`/piecework/logs?${query}`, { signal: controller.signal })
      .then(res => setLogPage({ ...EMPTY_PAGE, ...res, data: Array.isArray(res?.data) ? res.data : [] }))
      .catch(err => {
        if (controller.signal.aborted || isAbort(err)) return;
        setLogPage(EMPTY_PAGE);
        hotToast.error(errorMessageOf(err) || 'خطا در دریافت کارکردها');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<WorkLogSummary>('/piecework/logs/summary', { signal: controller.signal })
      .then(res => setSummary({ ...EMPTY_SUMMARY, ...res, projects: Array.isArray(res?.projects) ? res.projects : [] }))
      .catch(err => {
        if (controller.signal.aborted || isAbort(err)) return;
        setSummary(EMPTY_SUMMARY);
      });
    return () => controller.abort();
  }, [reloadKey]);

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
 * v9.0.325 (TD-811): پیش‌نمایش صدور فیش، کارکردهای تسویه‌نشده همان پرسنل و بازه از سرور (پیش‌تر از فهرست کامل
 * کارکردهای مرورگر فیلتر می‌شد).
 */
export function usePayrollPreviewLogs(open: boolean, personnelId: number | '', startDate: string, endDate: string, reloadKey: number): PieceworkLog[] {
  const [logs, setLogs] = useState<PieceworkLog[]>([]);
  useEffect(() => {
    if (!open || !personnelId || !startDate || !endDate) {
      setLogs([]);
      return;
    }
    const controller = new AbortController();
    const query = workLogListQuery({ personnelId, status: 'pending', startDate, endDate });
    fetchJson<PieceworkLog[]>(`/piecework/logs?${query}`, { signal: controller.signal })
      .then(res => setLogs(Array.isArray(res) ? res : []))
      .catch(err => {
        if (controller.signal.aborted || isAbort(err)) return;
        setLogs([]);
      });
    return () => controller.abort();
  }, [open, personnelId, startDate, endDate, reloadKey]);
  return logs;
}
