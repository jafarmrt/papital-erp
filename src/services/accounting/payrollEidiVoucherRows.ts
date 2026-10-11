import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import type { DbExecutor } from '../../db/drizzle.js';
import type { pieceworkPayrolls } from '../../db/schema.js';
import { AccountMappingService } from './accountMapping.service.js';

/**
 * v10.0.212 (TD-1089، طرح حقوق §۳.۸، ت۱۵ الف): ردیف‌های عیدی سند فیش حقوق.
 *   فیش عادی با سهم عیدی: بدهکار «هزینه عیدی و پاداش» (۷۰۱۴) / بستانکار «عیدی پرداختنی» (۳۲۰۷)، تفصیلی پرسنل؛ از خالص کم نمی‌شود.
 *   فیش عیدی: بدهکار «عیدی پرداختنی» به اندازه بخش انباشته و بدهکار «هزینه عیدی و پاداش» برای مازاد؛ بستانکار آن خالص فیش
 *   در «حقوق و دستمزد پرداختنی» است که سازنده سند می‌نویسد.
 */

type PayrollRow = typeof pieceworkPayrolls.$inferSelect;

export interface EidiVoucherRow {
  accountId: number;
  debit: DecimalValue;
  credit: DecimalValue;
  description: string;
}

/** مبلغ عیدی که ناخالص فیش عیدی است (فیش عادی صفر) */
export function eidiPayslipGross(pay: PayrollRow): FinancialDecimal {
  const amount = fin(pay.eidiAmount ?? 0);
  return pay.isEidi === 1 && amount.isPositive() ? amount : fin(0);
}

/**
 * ردیف‌های عیدی فیش؛ `missing` نام حساب نگاشت‌نشده است (سازنده سند آن را رد می‌کند و ردیفی نمی‌نویسد).
 */
export async function payrollEidiVoucherRows(pay: PayrollRow, personName: string, tx?: DbExecutor): Promise<{ rows: EidiVoucherRow[]; missing: string | null }> {
  const amount = fin(pay.eidiAmount ?? 0);
  if (!amount.isPositive()) return { rows: [], missing: null };
  const fromAccrualRaw = pay.isEidi === 1 ? fin(pay.eidiFromAccrual ?? 0) : amount;
  const fromAccrual = fromAccrualRaw.isPositive() ? (fromAccrualRaw.greaterThan(amount) ? amount : fromAccrualRaw) : fin(0);
  const expensePart = pay.isEidi === 1 ? amount.subtract(fromAccrual) : amount;
  const payableAcc = fromAccrual.isPositive() ? await AccountMappingService.getEidiPayableAccount(tx) : null;
  const expenseAcc = expensePart.isPositive() ? await AccountMappingService.getEidiExpenseAccount(tx) : null;
  if (fromAccrual.isPositive() && !payableAcc) return { rows: [], missing: 'عیدی پرداختنی' };
  if (expensePart.isPositive() && !expenseAcc) return { rows: [], missing: 'هزینه عیدی و پاداش' };
  const year = pay.eidiYear ?? '';
  const rows: EidiVoucherRow[] = [];
  if (pay.isEidi === 1) {
    if (payableAcc && fromAccrual.isPositive()) rows.push({ accountId: payableAcc.id, debit: fromAccrual, credit: 0, description: `پرداخت عیدی انباشته سال ${year} با فیش عیدی ${pay.payrollNumber} (${personName})` });
    if (expenseAcc && expensePart.isPositive()) rows.push({ accountId: expenseAcc.id, debit: expensePart, credit: 0, description: `هزینه عیدی سال ${year} فیش عیدی ${pay.payrollNumber}` });
    return { rows, missing: null };
  }
  if (expenseAcc && payableAcc) {
    rows.push({ accountId: expenseAcc.id, debit: amount, credit: 0, description: `سهم عیدی سال ${year} فیش ${pay.payrollNumber}` });
    rows.push({ accountId: payableAcc.id, debit: 0, credit: amount, description: `سهم عیدی سال ${year} فیش ${pay.payrollNumber} (${personName})` });
  }
  return { rows, missing: null };
}
