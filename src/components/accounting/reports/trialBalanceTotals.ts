/**
 * جمع ستون‌های تراز آزمایشی در مرورگر (OBS-R1-53، بخش رابط کاربری). پیش‌تر هر ستون با `Number` و `+=` جمع می‌شد و جمع
 * ریال‌های بزرگ و مبالغ ارزی اعشاری خطای ممیز شناور می‌گرفت؛ اکنون جمع با FinancialDecimal است (AGENTS.md §1.8) و تعادل
 * با همان رواداری اسناد حسابداری سنجیده می‌شود. در نمای «همه سطح‌ها» فقط ردیف‌های گروه جمع می‌شوند تا هر مبلغ یک بار شمرده شود.
 */
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal';
import { VOUCHER_BALANCE_TOLERANCE } from '../../../lib/voucherBalance';
import type { TrialBalanceRow } from '../../../types';

export interface TrialBalanceTotals {
  initialDebit: number;
  initialCredit: number;
  debitTurnover: number;
  creditTurnover: number;
  totalDebit: number;
  totalCredit: number;
  debitBalance: number;
  creditBalance: number;
  isBalanced: boolean;
  diff: number;
}

const TOTAL_KEYS = [
  'initialDebit', 'initialCredit', 'debitTurnover', 'creditTurnover',
  'totalDebit', 'totalCredit', 'debitBalance', 'creditBalance',
] as const;

type TotalKey = typeof TOTAL_KEYS[number];

export function trialBalanceTotals(rows: readonly TrialBalanceRow[], level: string): TrialBalanceTotals {
  const rowsToSum = level === 'all' ? rows.filter(r => r.level === 'group') : rows;
  const sums = Object.fromEntries(TOTAL_KEYS.map(k => [k, fin(0)])) as Record<TotalKey, FinancialDecimal>;
  for (const r of rowsToSum) {
    for (const k of TOTAL_KEYS) sums[k] = sums[k].add(r[k] || 0);
  }
  const diff = sums.debitBalance.subtract(sums.creditBalance).abs();
  const totals = Object.fromEntries(TOTAL_KEYS.map(k => [k, sums[k].toNumber()])) as Record<TotalKey, number>;
  return { ...totals, isBalanced: diff.lessThan(VOUCHER_BALANCE_TOLERANCE), diff: diff.toNumber() };
}
