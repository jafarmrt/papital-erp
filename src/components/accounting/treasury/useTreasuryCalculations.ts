import { useMemo } from 'react';
import type { BankAccount, TreasuryTransaction, Customer } from '../../../types';

interface UseTreasuryCalculationsParams {
  bankAccounts: BankAccount[];
  transactions: TreasuryTransaction[];
  customers: Customer[];
  searchQuery: string;
  selectedTypeFilter: string;
  selectedMethodFilter: string;
  dateFromFilter: string;
  dateToFilter: string;
  txAccountFilter: string;
}

export function useTreasuryCalculations({
  bankAccounts,
  transactions,
  customers,
  searchQuery,
  selectedTypeFilter,
  selectedMethodFilter,
  dateFromFilter,
  dateToFilter,
  txAccountFilter,
}: UseTreasuryCalculationsParams) {
  const safeBankAccounts = useMemo(() => Array.isArray(bankAccounts) ? bankAccounts : [], [bankAccounts]);
  const safeTransactions = useMemo(() => Array.isArray(transactions) ? transactions : [], [transactions]);
  const safeCustomers = useMemo(() => Array.isArray(customers) ? customers : [], [customers]);

  // Parties memoization
  const customerList = useMemo(() => {
    return safeCustomers.filter(c => {
      const pt = c.partyType || (c as any).party_type || 'customer';
      return pt === 'customer' || pt === 'both';
    });
  }, [safeCustomers]);

  const supplierList = useMemo(() => {
    const list = safeCustomers.filter(c => {
      const pt = c.partyType || (c as any).party_type;
      return pt === 'supplier' || pt === 'both';
    });
    return list.length > 0 ? list : safeCustomers;
  }, [safeCustomers]);

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

  // Filtered transactions memoization
  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return safeTransactions.filter(t => {
      const matchSearch = !query ||
        t.partyName.toLowerCase().includes(query) ||
        t.transactionNumber.includes(searchQuery.trim()) ||
        (t.trackingNumber && t.trackingNumber.includes(searchQuery.trim())) ||
        (t.description && t.description.toLowerCase().includes(query));

      const matchType = selectedTypeFilter === 'all' || t.type === selectedTypeFilter;
      const matchMethod = selectedMethodFilter === 'all' || t.method === selectedMethodFilter;
      const matchDate = (!dateFromFilter || String(t.date || '') >= dateFromFilter) && (!dateToFilter || String(t.date || '').slice(0, 10) <= dateToFilter);
      const matchAccount = txAccountFilter === 'all' || Number(t.bankAccountId) === Number(txAccountFilter);

      return matchSearch && matchType && matchMethod && matchDate && matchAccount;
    });
  }, [safeTransactions, searchQuery, selectedTypeFilter, selectedMethodFilter, dateFromFilter, dateToFilter, txAccountFilter]);

  // Running balance memoization (calculated only for single filtered account)
  const runningBalanceMap = useMemo<Map<number, number>>(() => {
    const map = new Map<number, number>();
    if (txAccountFilter === 'all') return map;
    const accId = Number(txAccountFilter);
    const asc = [...safeTransactions]
      .filter(t => Number(t.bankAccountId) === accId && t.status !== 'voided')
      .sort((a, b) => (a.date === b.date ? (a.id - b.id) : String(a.date).localeCompare(String(b.date))));

    let bal = Number(safeBankAccounts.find(b => b.id === accId)?.initialBalance ?? 0) || 0;
    for (const t of asc) {
      bal = t.type === 'receipt' ? bal + (Number(t.amount) || 0) : bal - (Number(t.amount) || 0);
      map.set(t.id, bal);
    }
    return map;
  }, [txAccountFilter, safeTransactions, safeBankAccounts]);

  return {
    safeBankAccounts,
    safeTransactions,
    customerList,
    supplierList,
    summary,
    filteredTransactions,
    runningBalanceMap,
  };
}
