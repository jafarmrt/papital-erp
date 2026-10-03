import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { errorMessageOf, safeExtractArray } from '../../utils';
import type { DetailedPartyLedgerResult, PartyOption } from '../../types';
import { ACCOUNTING_REPORT_QUERY_OPTIONS } from './accountingQueryConfig';
import { reportFromResponse, useOnDemandReport, type OnDemandReportSpec } from './useOnDemandReport';

/**
 * زیرتب‌های «صورت‌حساب طرف‌حساب» و «گزارش پروژه‌ها» با React Query. پارامترها (طرف‌حساب، بازه تاریخ، ارز، پروژه)
 * بخشی از کلیدند، پس با تغییر انتخاب درخواست قبلی لغو می‌شود و پاسخ دیررس آن جای نتیجه تازه را نمی‌گیرد؛ بستن
 * زیرتب درخواست‌های در جریان را لغو می‌کند. همان آدرس‌ها و پیام‌های خطای صفحه پیشین.
 */

const REPORT_OPTIONS = { ...ACCOUNTING_REPORT_QUERY_OPTIONS, refetchOnMount: 'always' } as const;

/** فهرست طرف‌های حساب صورت‌حساب (GET /accounting/reports/parties) */
export function usePartiesQuery() {
  return useQuery<PartyOption[]>({
    queryKey: QUERY_KEYS.accounting.report('parties'),
    queryFn: async ({ signal }) => {
      try {
        return safeExtractArray<PartyOption>(await fetchJson<unknown>('/accounting/reports/parties', { signal }));
      } catch (err: unknown) {
        if (!signal.aborted) toast.error(errorMessageOf(err) || 'خطا در بارگذاری لیست طرف‌های حساب');
        throw err;
      }
    },
    ...REPORT_OPTIONS,
  });
}

export interface PartyLedgerParams {
  partyId?: number;
  partyType?: string;
  partyName?: string;
  startDate?: string;
  endDate?: string;
  currency?: string;
  includeDrafts?: boolean;
}

const PARTY_LEDGER_REPORT: OnDemandReportSpec<PartyLedgerParams, DetailedPartyLedgerResult | null> = {
  key: (p) => QUERY_KEYS.accounting.report('party-ledger', p),
  idleKey: QUERY_KEYS.accounting.report('party-ledger', { idle: true }),
  url: (p) => {
    const params = new URLSearchParams();
    if (p.partyId) params.append('partyId', String(p.partyId));
    if (p.partyType) params.append('partyType', p.partyType);
    if (p.partyName) params.append('partyName', p.partyName);
    if (p.startDate) params.append('startDate', p.startDate);
    if (p.endDate) params.append('endDate', p.endDate);
    if (p.currency) params.append('currency', p.currency);
    if (p.includeDrafts) params.append('includeDrafts', 'true');
    return `/accounting/reports/party-ledger?${params.toString()}`;
  },
  parse: reportFromResponse<DetailedPartyLedgerResult>,
  errorText: 'خطا در دریافت صورت‌حساب طرف‌حساب',
};

export function usePartyLedgerReport() {
  return useOnDemandReport(PARTY_LEDGER_REPORT);
}

export interface ProjectSummaryRow {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  entriesCount: number;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export interface ProjectDetailRow {
  voucherNumber: string;
  voucherDate: string;
  voucherDescription: string;
  accountCode: string;
  accountName: string;
  lineDescription: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export function useProjectSummaryQuery() {
  return useQuery<ProjectSummaryRow[]>({
    queryKey: QUERY_KEYS.accounting.report('project-summary'),
    queryFn: async ({ signal }) => safeExtractArray<ProjectSummaryRow>(
      await fetchJson<unknown>('/accounting/reports/project-summary', { signal }),
    ),
    ...REPORT_OPTIONS,
  });
}

/** ریز گردش یک پروژه؛ فقط وقتی پروژه‌ای انتخاب شده است */
export function useProjectDetailQuery(projectId: number | null) {
  return useQuery<ProjectDetailRow[]>({
    queryKey: projectId === null
      ? QUERY_KEYS.accounting.report('project-detail', { idle: true })
      : QUERY_KEYS.accounting.report('project-detail', { projectId }),
    queryFn: projectId === null ? skipToken : async ({ signal }) => {
      const res = await fetchJson<{ detail?: unknown } | null>(`/accounting/reports/project-detail?projectId=${projectId}`, { signal });
      return Array.isArray(res?.detail) ? (res.detail as ProjectDetailRow[]) : [];
    },
    ...REPORT_OPTIONS,
    placeholderData: keepPreviousData,
  });
}
