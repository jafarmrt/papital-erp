import { jalaliMonthLabel } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { FixedSalaryMonthShare } from './fixedSalaryProration.js';

/**
 * v9.0.328 (TD-815، B12P-12): ردیف‌های حقوق ثابت فیش چاپی، به تفکیک ماه شمسی. پیش‌تر هر حقوق ثابت یک ردیف «۱ دوره ماهانه»
 * می‌گرفت، حتی سهم چند ماه یا سهم چند روز از یک ماه (TD-284). فیش پیش از v8.0.30 تفکیک ماهانه ندارد و یک ماه کامل حساب
 * شده است (`priorFixedGrantsOf`)، پس یک ردیف «۱ ماه کامل» می‌گیرد.
 */
export interface PayslipFixedSalaryRow {
  /** ماه شمسی («مهر ۱۴۰۵») یا، در فیش قدیمی، تهی تا بازه خود فیش نشان داده شود */
  month: string;
  /** «۱۵ روز از ۳۰ روز» یا «۱ ماه کامل» */
  share: string;
  amount: number;
}

interface PayslipFixedSalarySource {
  totalFixedAmount?: number | string | null;
  fixedSalaryMonths?: FixedSalaryMonthShare[] | null;
}

export function payslipFixedSalaryRows(payroll: PayslipFixedSalarySource): PayslipFixedSalaryRow[] {
  const total = Number(payroll.totalFixedAmount) || 0;
  if (total <= 0) return [];
  const months = Array.isArray(payroll.fixedSalaryMonths) ? payroll.fixedSalaryMonths : [];
  if (months.length === 0) return [{ month: '', share: '۱ ماه کامل', amount: total }];
  return months
    .filter(m => Number(m.amount) > 0)
    .map(m => ({
      month: jalaliMonthLabel(m.month),
      share: `${toPersianDigits(String(m.days))} روز از ${toPersianDigits(String(m.monthDays))} روز`,
      amount: Number(m.amount),
    }));
}
