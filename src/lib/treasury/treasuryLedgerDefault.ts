/**
 * v11 phase 6.3b (U19): the ledger a new bank account, cash box, card reader or petty cash takes by default: the standard
 * chart's subsidiary of its kind and currency (`src/data/standardChartOfAccounts.ts`). Before, the form left it empty and
 * a non-zero opening balance was refused only after saving.
 */
export function defaultTreasuryLedgerCode(type: string, currency: string): string {
  const rial = String(currency || 'IRR').trim().toUpperCase() === 'IRR';
  if (type === 'petty_cash') return '1006';
  if (type === 'pos') return '1005';
  if (type === 'cash') return rial ? '1001' : '1002';
  return rial ? '1003' : '1004';
}

interface LedgerCandidate {
  id: number;
  code: string;
  isActive?: number | null;
  is_active?: number | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
}

/** The live account with that code, or null when the chart has none (a renumbered chart: the user picks) */
export function defaultTreasuryLedger<T extends LedgerCandidate>(accounts: readonly T[], type: string, currency: string): T | null {
  const code = defaultTreasuryLedgerCode(type, currency);
  return accounts.find(a => String(a.code).trim() === code
    && Number(a.isDeleted ?? a.is_deleted ?? 0) === 0
    && Number(a.isActive ?? a.is_active ?? 1) !== 0) ?? null;
}

/** Shown under the ledger field before saving, in place of the server's 422 after it */
export const TREASURY_LEDGER_REQUIRED_MESSAGE = 'برای موجودی اولیه، سرفصل معین حسابداری حساب را انتخاب کنید.';
