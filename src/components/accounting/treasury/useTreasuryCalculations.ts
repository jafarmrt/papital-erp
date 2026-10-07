import { useMemo } from 'react';
import type { BankAccount } from '../../../types';

interface UseTreasuryCalculationsParams {
  bankAccounts: BankAccount[];
}

/**
 * جمع‌بندی سلامت حساب‌های خزانه. v9.0.102 (TD-509): فیلتر، صفحه‌بندی و مانده جاری تراکنش‌ها در سرور حساب می‌شود
 * (`useTreasuryTransactionPageQuery`)، نه روی کل فهرست در مرورگر.
 */
export function useTreasuryCalculations({ bankAccounts }: UseTreasuryCalculationsParams) {
  const safeBankAccounts = useMemo(() => Array.isArray(bankAccounts) ? bankAccounts : [], [bankAccounts]);

  // Dynamic reconciliation & balance health summary memoization
  const summary = useMemo(() => {
    const totalLedger = safeBankAccounts.reduce((sum, b) => sum + (Number(b.ledgerBalance ?? b.currentBalance) || 0), 0);
    const totalTreasury = safeBankAccounts.reduce((sum, b) => sum + (Number(b.treasuryBalance ?? b.currentBalance) || 0), 0);
    const discrepancy = safeBankAccounts.reduce((sum, b) => sum + (Number(b.discrepancy) || 0), 0);
    const syncedCount = safeBankAccounts.filter(b => b.syncStatus === 'synced').length;
    const discrepantCount = safeBankAccounts.filter(b => b.syncStatus === 'discrepant').length;

    return {
      totalLedgerBalance: totalLedger,
      totalTreasuryBalance: totalTreasury,
      totalDiscrepancy: discrepancy,
      syncedAccountsCount: syncedCount,
      discrepantAccountsCount: discrepantCount,
      totalAccountsCount: safeBankAccounts.length,
    };
  }, [safeBankAccounts]);

  return { safeBankAccounts, summary };
}
