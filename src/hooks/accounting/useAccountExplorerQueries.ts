import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { ACCOUNTING_REPORT_QUERY_OPTIONS } from './accountingQueryConfig';

/**
 * تب «مرور حساب‌ها»: گردش حساب/تفصیلی انتخاب‌شده (GET /accounting/reports/ledger) با React Query.
 * همه فیلترها (حساب، نوع و شناسه تفصیلی، نام، بازه تاریخ) بخشی از کلیدند: با هر تغییر انتخاب درخواست قبلی لغو
 * می‌شود و پاسخ دیررس انتخاب قبلی هرگز جای گردش انتخاب تازه را نمی‌گیرد (پیش‌تر می‌گرفت). تا رسیدن نتیجه تازه،
 * ردیف‌های قبلی نمایش داده می‌شوند؛ خطا مثل قبل فقط در کنسول ثبت می‌شود.
 */

export interface ExplorerLedgerParams {
  accountId?: number;
  detailedType?: string;
  detailedId?: number;
  detailedName?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExplorerLedgerRow {
  voucherId: number;
  voucherNumber: number;
  date: string;
  description: string;
  accountName: string;
  accountCode: string;
  detailedName?: string;
  detailedType?: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface ExplorerLedgerData {
  items: ExplorerLedgerRow[];
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
}

interface ExplorerLedgerResponse {
  items?: unknown;
  totalDebit?: number;
  totalCredit?: number;
  finalBalance?: number;
}

const EMPTY_LEDGER: ExplorerLedgerData = { items: [], totalDebit: 0, totalCredit: 0, finalBalance: 0 };

export function explorerLedgerUrl(p: ExplorerLedgerParams): string {
  const queryParams = new URLSearchParams();
  if (p.accountId) queryParams.set('accountId', p.accountId.toString());
  if (p.detailedType) queryParams.set('detailedType', p.detailedType);
  if (p.detailedId) queryParams.set('detailedId', p.detailedId.toString());
  if (p.detailedName) queryParams.set('detailedName', p.detailedName);
  if (p.startDate) queryParams.set('startDate', p.startDate);
  if (p.endDate) queryParams.set('endDate', p.endDate);
  return `/accounting/reports/ledger?${queryParams.toString()}`;
}

export function useExplorerLedgerQuery(params: ExplorerLedgerParams) {
  const query = useQuery<ExplorerLedgerData | null>({
    queryKey: QUERY_KEYS.accounting.report('explorer-ledger', params),
    queryFn: async ({ signal }) => {
      try {
        const res = await fetchJson<ExplorerLedgerResponse | null>(explorerLedgerUrl(params), { signal });
        if (!res) return null;
        return {
          items: Array.isArray(res.items) ? (res.items as ExplorerLedgerRow[]) : [],
          totalDebit: res.totalDebit || 0,
          totalCredit: res.totalCredit || 0,
          finalBalance: res.finalBalance || 0,
        };
      } catch (err: unknown) {
        if (!signal.aborted) console.error('Error fetching explorer transactions:', err);
        throw err;
      }
    },
    ...ACCOUNTING_REPORT_QUERY_OPTIONS,
    // مثل قبل هر بار باز شدن تب گردش از سرور خوانده می‌شود
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });

  return {
    ledger: query.data ?? EMPTY_LEDGER,
    loading: query.isFetching,
  };
}
