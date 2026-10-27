import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { ACCOUNTING_REPORT_QUERY_OPTIONS } from './accountingQueryConfig';
import { ACCOUNT_CARD_PAGE_SIZE, accountCardHasFilter, accountCardRows, setAccountCardPage, type AccountCardReport, type AccountCardRow } from '../../lib/accounting/accountCard';

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

/** v11 phase 6.1ch (M13): one page of the card, on the shared contract (`src/lib/accounting/accountCard.ts`) */
export type ExplorerLedgerRow = AccountCardRow;
export type ExplorerLedgerData = Pick<AccountCardReport, 'items' | 'totalDebit' | 'totalCredit' | 'finalBalance' | 'total' | 'page' | 'limit'>;

const EMPTY_LEDGER: ExplorerLedgerData = { items: [], totalDebit: 0, totalCredit: 0, finalBalance: 0, total: 0, page: 1, limit: ACCOUNT_CARD_PAGE_SIZE };

/** the card of the selection: one page (`page` above 1 is sent), or every row for the CSV file (`exportAll`) */
export function explorerLedgerUrl(p: ExplorerLedgerParams, page = 1, exportAll = false): string {
  const queryParams = new URLSearchParams();
  if (p.accountId) queryParams.set('accountId', p.accountId.toString());
  if (p.detailedType) queryParams.set('detailedType', p.detailedType);
  if (p.detailedId) queryParams.set('detailedId', p.detailedId.toString());
  if (p.detailedName) queryParams.set('detailedName', p.detailedName);
  if (p.startDate) queryParams.set('startDate', p.startDate);
  if (p.endDate) queryParams.set('endDate', p.endDate);
  return `/accounting/reports/ledger?${setAccountCardPage(queryParams, page, exportAll).toString()}`;
}

function ledgerOf(res: Partial<AccountCardReport> | null): ExplorerLedgerData | null {
  if (!res) return null;
  return {
    items: accountCardRows(res as AccountCardReport),
    totalDebit: res.totalDebit || 0,
    totalCredit: res.totalCredit || 0,
    finalBalance: res.finalBalance || 0,
    total: Number(res.total ?? 0),
    page: Number(res.page ?? 1),
    limit: Number(res.limit ?? ACCOUNT_CARD_PAGE_SIZE),
  };
}

/** every row of the selection for the CSV file (`export=true`); the screen shows one page */
export async function fetchExplorerLedgerRows(params: ExplorerLedgerParams): Promise<ExplorerLedgerRow[]> {
  return ledgerOf(await fetchJson<Partial<AccountCardReport> | null>(explorerLedgerUrl(params, 1, true)))?.items ?? [];
}

export function useExplorerLedgerQuery(params: ExplorerLedgerParams, page = 1) {
  // v9.0.225 (TD-547، ت۵ الف): بی حساب و بی طرف حساب درخواستی نمی‌رود (سرور ۴۲۲ می‌دهد)؛ پیش‌تر باز شدن زبانه کل دفتر را می‌خواند
  const hasFilter = accountCardHasFilter(params);
  const query = useQuery<ExplorerLedgerData | null>({
    enabled: hasFilter,
    queryKey: QUERY_KEYS.accounting.report('explorer-ledger', { ...params, page }),
    queryFn: async ({ signal }) => {
      try {
        return ledgerOf(await fetchJson<Partial<AccountCardReport> | null>(explorerLedgerUrl(params, page), { signal }));
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
    ledger: (hasFilter ? query.data : null) ?? EMPTY_LEDGER,
    loading: hasFilter && query.isFetching,
    hasFilter,
  };
}
