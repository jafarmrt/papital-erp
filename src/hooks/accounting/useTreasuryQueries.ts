import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { errorMessageOf } from '../../utils';
import type { BankAccount, BankAccountOption, BankReconciliationReport, TreasuryTransaction } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList, silentMutationError } from './accountingQueryConfig';
import { invalidateAfterReconciliation, invalidateAfterTreasuryChange } from './accountingInvalidation';
import { useOnDemandReport, type OnDemandReportSpec } from './useOnDemandReport';

/**
 * خزانه‌داری: حساب‌های بانکی و تراکنش‌های خزانه با useQuery؛ حساب بانکی، دریافت/پرداخت، ابطال، انتقال بین‌بانکی،
 * آشتی‌سنجی و همگام‌سازی مانده‌ها با useMutation (همان آدرس‌ها، بدنه‌ها و پیام‌های صفحه پیشین).
 */

/** بدنه فرم‌های خزانه (همان داده مودال‌های حساب بانکی، تراکنش و انتقال) */
export type TreasuryPayload = object;

export function useBankAccountsQuery() {
  return useQuery<BankAccount[]>({
    queryKey: QUERY_KEYS.accounting.bankAccounts(),
    queryFn: ({ signal }) => fetchAccountingList<BankAccount>('/accounting/bank-accounts', signal, 'bank accounts'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

/** v9.0.86 (TD-505، ت۷): فهرست انتخاب حساب‌های خزانه (بی شماره حساب و مانده) برای دفتر چک */
export function useBankAccountOptionsQuery() {
  return useQuery<BankAccountOption[]>({
    queryKey: QUERY_KEYS.accounting.bankAccountOptions(),
    queryFn: ({ signal }) => fetchAccountingList<BankAccountOption>('/accounting/bank-accounts/options', signal, 'bank account options'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

export function useTreasuryTransactionsQuery() {
  return useQuery<TreasuryTransaction[]>({
    queryKey: QUERY_KEYS.accounting.treasuryTransactions(),
    queryFn: ({ signal }) => fetchAccountingList<TreasuryTransaction>('/accounting/treasury', signal, 'treasury transactions'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

/** v9.0.82 (TD-507): سرفصل‌های مجاز طرف مقابل «متفرقه» و «سایر» پرسنل؛ فقط وقتی فرم آن را لازم دارد خوانده می‌شود */
export interface ContraAccountOption {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

export function useContraAccountsQuery(enabled: boolean) {
  return useQuery<ContraAccountOption[]>({
    queryKey: QUERY_KEYS.accounting.contraAccounts(),
    queryFn: ({ signal }) => fetchAccountingList<ContraAccountOption>('/accounting/treasury/contra-accounts', signal, 'contra accounts'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    enabled,
  });
}

export interface ReconcileVariables {
  bankAccountId: number;
  txIds: number[];
  batch: string;
  reconciled: boolean;
}

// v8.0.74 (TD-340، تصمیم مالک محصول): مانده از تراکنش‌ها ساخته می‌شود و اختلاف با دفتر کل فقط گزارش می‌شود
function notifyBankSync(report: BankReconciliationReport): void {
  const { syncedCount, discrepantCount } = report;
  if (discrepantCount === 0) {
    toast.success(`مانده ${syncedCount} حساب بانکی و صندوق از تراکنش‌ها ساخته شد و با دفتر کل یکی است.`);
  } else {
    toast(`مانده حساب‌ها از تراکنش‌ها ساخته شد: ${syncedCount} حساب با دفتر کل یکی است و ${discrepantCount} حساب با دفتر کل اختلاف دارد (فقط گزارش شد).`, {
      icon: '⚠️',
      duration: 5000,
    });
  }
}

export function useTreasuryMutations() {
  const queryClient = useQueryClient();
  const onSuccess = () => { void invalidateAfterTreasuryChange(queryClient); };
  const common = { onSuccess, onError: silentMutationError };

  const createBankAccount = useMutation<unknown, unknown, TreasuryPayload>({
    mutationFn: (data) => fetchJson('/accounting/bank-accounts', { method: 'POST', body: JSON.stringify(data) }),
    ...common,
  });

  const updateBankAccount = useMutation<unknown, unknown, { id: number; data: TreasuryPayload }>({
    mutationFn: ({ id, data }) => fetchJson(`/accounting/bank-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    ...common,
  });

  const deleteBankAccount = useMutation<unknown, unknown, number>({
    mutationFn: (id) => fetchJson(`/accounting/bank-accounts/${id}`, { method: 'DELETE' }),
    ...common,
  });

  const createTransaction = useMutation<unknown, unknown, TreasuryPayload>({
    mutationFn: (data) => fetchJson('/accounting/treasury', { method: 'POST', body: JSON.stringify(data) }),
    ...common,
  });

  // V1.4.0: ابطال تراکنش خزانه با سند معکوس
  const voidTransaction = useMutation<unknown, unknown, { id: number; reason: string }>({
    mutationFn: ({ id, reason }) => fetchJson(`/accounting/treasury/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    ...common,
  });

  // V1.5.0: انتقال بین‌بانکی
  const createTransfer = useMutation<unknown, unknown, TreasuryPayload>({
    mutationFn: (data) => fetchJson('/accounting/treasury/transfer', { method: 'POST', body: JSON.stringify(data) }),
    ...common,
  });

  // V1.6.0: ثبت گروهی آشتی‌سنجی بانکی
  const reconcileTransactions = useMutation<unknown, unknown, ReconcileVariables>({
    mutationFn: ({ bankAccountId, txIds, batch, reconciled }) => fetchJson('/accounting/treasury/reconcile', {
      method: 'POST',
      body: JSON.stringify({ bankAccountId, txIds, batch, reconciled }),
    }),
    onSuccess: () => { void invalidateAfterReconciliation(queryClient); },
    onError: silentMutationError,
  });

  // همگام‌سازی مانده حساب‌های بانکی با دفاتر؛ پیام نتیجه/خطا همین‌جا اعلام می‌شود (مثل قبل)
  const syncAndReconcileBanks = useMutation<{ report?: BankReconciliationReport } | null, unknown, void>({
    mutationFn: () => fetchJson<{ report?: BankReconciliationReport } | null>('/accounting/bank-accounts/sync-reconcile', {
      method: 'POST',
    }),
    onSuccess: (res) => {
      if (res?.report) notifyBankSync(res.report);
      onSuccess();
    },
    onError: (err: unknown) => {
      console.error('Error syncing banks:', err);
      toast.error(errorMessageOf(err) || 'خطا در همگام‌سازی مانده حساب‌های بانکی');
    },
  });

  return {
    createBankAccount,
    updateBankAccount,
    deleteBankAccount,
    createTransaction,
    voidTransaction,
    createTransfer,
    reconcileTransactions,
    syncAndReconcileBanks,
  };
}

export interface CashFlowParams {
  startDate?: string;
  endDate?: string;
}

export interface CashFlowMonth {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface CashFlowReport {
  summary?: { totalInflow?: number; totalOutflow?: number; netCashFlow?: number };
  monthly?: CashFlowMonth[];
}

// V1.6.0: گزارش جریان نقدی (مودال خزانه)؛ مثل قبل خطا پیام جداگانه ندارد
const CASH_FLOW_REPORT: OnDemandReportSpec<CashFlowParams, CashFlowReport | null> = {
  key: (p) => QUERY_KEYS.accounting.report('cash-flow', p),
  idleKey: QUERY_KEYS.accounting.report('cash-flow', { idle: true }),
  url: ({ startDate, endDate }) => {
    const q = new URLSearchParams();
    if (startDate) q.append('startDate', startDate);
    if (endDate) q.append('endDate', endDate);
    return `/accounting/reports/cash-flow?${q.toString()}`;
  },
  parse: (res) => (res ?? null) as CashFlowReport | null,
};

export function useCashFlowReport() {
  return useOnDemandReport(CASH_FLOW_REPORT);
}

