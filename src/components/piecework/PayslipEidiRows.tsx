import { PieceworkPayroll } from '../../types';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸): فیش چاپی سهم عیدی همین فیش و جمع عیدی انباشته سال را برای آگاهی کارگر نشان می‌دهد؛
 * سهم عیدی از خالص کم نمی‌شود. فیش عیدی مبلغ عیدی سال را نشان می‌دهد.
 */
export function PayslipEidiRows({ payroll }: { payroll: PieceworkPayroll }) {
  const rial = useRialDisplay();
  const amount = Number(payroll.eidiAmount || 0);
  const year = payroll.eidiYear ? toPersianDigits(String(payroll.eidiYear)) : '';
  if (payroll.isEidi === 1) {
    return (
      <div className="flex justify-between font-bold text-emerald-700">
        <span>{`عیدی و پاداش سال ${year}:`}</span>
        <span className="font-mono">+{rial.amount(amount)}</span>
      </div>
    );
  }
  if (amount <= 0) return null;
  return (
    <>
      <div className="flex justify-between font-bold text-slate-500">
        <span>سهم عیدی این فیش (از خالص کم نمی‌شود):</span>
        <span className="font-mono">{rial.amount(amount)}</span>
      </div>
      <div className="flex justify-between font-bold text-slate-500">
        <span>{`عیدی انباشته سال ${year} (فیش‌های تأییدشده):`}</span>
        <span className="font-mono">{rial.amount(Number(payroll.eidiYearAccrued || 0))}</span>
      </div>
    </>
  );
}
