import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { PieceworkPayroll, PieceworkTaskRateHistory } from '../../types';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { EidiReport } from '../../lib/payroll/eidiReport';
import type { StatutoryReport } from '../../lib/payroll/statutoryReport';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/**
 * 10.3 (ARCH review finding 3): the payroll windows (payment and its history, advance balance, eidi and statutory previews
 * and reports, rate history, «my payslips») read through the shared cache under `piecework`. A payment, void, approval,
 * draft edit or any treasury or voucher change invalidates that domain, so a window that is open shows the new figures
 * instead of the ones it read when it opened; each window still reads again every time it opens (READ_ON_EVERY_OPENING).
 */
const PAYROLL_WINDOW_READ = READ_ON_EVERY_OPENING;

const arrayOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? res as T[] : []);

export interface PayrollPaymentRowData {
  id: number;
  transactionNumber?: string;
  amount: number;
  status?: string;
  bankAccountTitle?: string | null;
  trackingNumber?: string | null;
  date?: string;
}

/** the payments of a payslip (`GET /piecework/payrolls/:id/payments`); none while no payslip is open */
export function usePayrollPaymentsQuery(payrollId: number | null) {
  return useQuery<PayrollPaymentRowData[]>({
    queryKey: QUERY_KEYS.piecework.payrollPayments(payrollId ?? 0),
    queryFn: async ({ signal }) => arrayOf<PayrollPaymentRowData>(await fetchJson(`/piecework/payrolls/${payrollId}/payments`, { signal })),
    ...PAYROLL_WINDOW_READ,
    enabled: payrollId !== null,
  });
}

/** the signed-in user's own payslips; an empty answer means no linked personnel or no payslip */
export function useMyPayrollsQuery() {
  return useQuery<PieceworkPayroll[]>({
    queryKey: QUERY_KEYS.piecework.myPayrolls(),
    queryFn: async ({ signal }) => arrayOf<PieceworkPayroll>(await fetchJson('/piecework/payrolls/mine', { signal })),
    ...PAYROLL_WINDOW_READ,
  });
}

export interface AdvanceBalance {
  outstandingAdvance: number;
  totalAdvances: number;
  totalDeducted: number;
}

/** what a personnel still owes from advances (`GET /piecework/personnel/:id/advance-balance`) */
export function useAdvanceBalanceQuery(personnelId: number | null) {
  return useQuery<AdvanceBalance | null>({
    queryKey: QUERY_KEYS.piecework.advanceBalance(personnelId ?? 0),
    queryFn: async ({ signal }) => {
      const data = await fetchJson<Partial<AdvanceBalance> | null>(`/piecework/personnel/${personnelId}/advance-balance`, { signal });
      if (!data) return null;
      return {
        outstandingAdvance: Number(data.outstandingAdvance || 0),
        totalAdvances: Number(data.totalAdvances || 0),
        totalDeducted: Number(data.totalDeducted || 0),
      };
    },
    ...PAYROLL_WINDOW_READ,
    enabled: personnelId !== null,
  });
}

/** the suggested eidi of a personnel for a Jalali year (`GET /piecework/eidi-preview`) */
export function useEidiPreviewQuery<T>(personnelId: number | null, year: number) {
  return useQuery<T>({
    queryKey: QUERY_KEYS.piecework.eidiPreview(personnelId ?? 0, year),
    queryFn: ({ signal }) => fetchJson<T>(`/piecework/eidi-preview?personnelId=${personnelId}&year=${year}`, { signal }),
    ...PAYROLL_WINDOW_READ,
    enabled: personnelId !== null,
  });
}

export interface StatutoryPreviewParams {
  personnelId: number;
  startDate: string;
  endDate: string;
  gross: number;
}

/** the suggested insurance and tax of a payslip form (`GET /piecework/statutory-preview`); null without a full period */
export function useStatutoryPreviewQuery<T>(params: StatutoryPreviewParams | null) {
  return useQuery<T>({
    queryKey: QUERY_KEYS.piecework.statutoryPreview(params ?? {}),
    queryFn: ({ signal }) => {
      const p = params as StatutoryPreviewParams;
      const query = new URLSearchParams({ personnelId: String(p.personnelId), startDate: p.startDate, endDate: p.endDate, gross: String(Math.max(0, p.gross || 0)) });
      return fetchJson<T>(`/piecework/statutory-preview?${query.toString()}`, { signal });
    },
    ...PAYROLL_WINDOW_READ,
    enabled: params !== null,
  });
}

/** the monthly insurance and tax list (`GET /piecework/reports/statutory`) */
export function useStatutoryReportQuery(year: number, month: number) {
  return useQuery<StatutoryReport>({
    queryKey: QUERY_KEYS.piecework.statutoryReport(year, month),
    queryFn: ({ signal }) => fetchJson<StatutoryReport>(`/piecework/reports/statutory?year=${year}&month=${month}`, { signal }),
    ...PAYROLL_WINDOW_READ,
  });
}

/** the yearly eidi list (`GET /piecework/reports/eidi`) */
export function useEidiReportQuery(year: number) {
  return useQuery<EidiReport>({
    queryKey: QUERY_KEYS.piecework.eidiReport(year),
    queryFn: ({ signal }) => fetchJson<EidiReport>(`/piecework/reports/eidi?year=${year}`, { signal }),
    ...PAYROLL_WINDOW_READ,
  });
}

/** the rate history of one title, or of every title when `taskId` is null; read only while the window is open */
export function useTaskRateHistoryQuery(taskId: number | null, open: boolean) {
  return useQuery<PieceworkTaskRateHistory[]>({
    queryKey: QUERY_KEYS.piecework.taskRateHistory(taskId),
    queryFn: async ({ signal }) => arrayOf<PieceworkTaskRateHistory>(
      await fetchJson(taskId !== null ? `/piecework/tasks/${taskId}/history` : '/piecework/tasks-history', { signal }),
    ),
    ...PAYROLL_WINDOW_READ,
    enabled: open,
  });
}
