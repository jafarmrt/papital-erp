import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { extractDateString } from '../../utils';
import { useSearch } from '../../SearchContext';
import { useDocumentsQuery } from '../queries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { computeInvoiceListSummary, type InvoiceListDocument, type InvoiceListResponse } from '../../lib/invoices/invoiceListDocuments';

/**
 * TD-080 (بخش ۳): جستجو، فیلترها، صفحه‌بندی و کوئری لیست اسناد — منتقل‌شده بدون تغییر از InvoicesListPage.
 * V9 Phase 5.1: React Query (کش، dedupe و حذف loadData/AbortController دستی).
 */
export function useInvoiceListQuery() {
  const { searchQuery: search, debouncedSearchQuery, setSearchQuery: setSearch, clearSearch } = useSearch();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const queryClient = useQueryClient();

  // V4 Phase 6.2 (یافته U-1): تغذیه کوئری سرور با debouncedSearchQuery به جای کی‌استروک‌های خام
  const docsQuery = useDocumentsQuery({
    page,
    limit: pageSize,
    search: debouncedSearchQuery,
    type: filterType,
    status: filterStatus,
    startDate: extractDateString(startDate) || undefined,
    endDate: extractDateString(endDate) || undefined,
  });

  const result = docsQuery.data as InvoiceListResponse | null | undefined;
  const totalPages = result?.totalPages || 1;
  const loading = docsQuery.isFetching;

  // Reset page to 1 on filter or debounced search change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, filterType, filterStatus, startDate, endDate, pageSize]);

  const loadData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.documents.all });
  }, [queryClient]);

  const safeDocs = useMemo<InvoiceListDocument[]>(() => {
    const docs = result?.data ?? [];
    return Array.isArray(docs) ? docs : [];
  }, [result]);
  const totalItems = result?.total || safeDocs.length;

  const summaryMetrics = useMemo(() => computeInvoiceListSummary(safeDocs), [safeDocs]);

  const hasActiveFilters = Boolean(startDate || endDate || search || filterType !== 'all' || filterStatus !== 'all');
  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    clearSearch();
    setFilterType('all');
    setFilterStatus('all');
  };

  return {
    search, setSearch,
    startDate, setStartDate,
    endDate, setEndDate,
    filterType, setFilterType,
    filterStatus, setFilterStatus,
    page, setPage,
    pageSize, setPageSize,
    safeDocs, totalItems, totalPages, loading,
    summaryMetrics,
    hasActiveFilters, clearFilters,
    loadData,
  };
}

export type InvoiceListQueryState = ReturnType<typeof useInvoiceListQuery>;
