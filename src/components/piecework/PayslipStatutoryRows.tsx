import { PieceworkPayroll } from '../../types';
import { useRialDisplay } from '../../hooks/useAppCurrency';

/**
 * v10.0.210 (TD-1087، طرح حقوق §۳.۳ بند ۵): فیش چاپی هر کسر قانونی را جدا نشان می‌دهد؛ بیمه سهم کارفرما هزینه کارفرماست
 * و فقط برای آگاهی همکار چاپ می‌شود، از خالص کم نمی‌شود. فیش پیش از این نسخه این ردیف‌ها را ندارد.
 */
export function PayslipStatutoryRows({ payroll }: { payroll: PieceworkPayroll }) {
  const rial = useRialDisplay();
  const employee = Number(payroll.employeeInsurance || 0);
  const employer = Number(payroll.employerInsurance || 0);
  const tax = Number(payroll.incomeTax || 0);
  if (employee <= 0 && employer <= 0 && tax <= 0) return null;
  return (
    <>
      {employee > 0 && (
        <div className="flex justify-between font-bold text-red-700">
          <span>بیمه سهم کارگر:</span>
          <span className="font-mono">-{rial.amount(employee)}</span>
        </div>
      )}
      {tax > 0 && (
        <div className="flex justify-between font-bold text-red-700">
          <span>مالیات حقوق:</span>
          <span className="font-mono">-{rial.amount(tax)}</span>
        </div>
      )}
      {employer > 0 && (
        <div className="flex justify-between font-bold text-slate-500">
          <span>بیمه سهم کارفرما (از خالص کم نمی‌شود):</span>
          <span className="font-mono">{rial.amount(employer)}</span>
        </div>
      )}
      {payroll.statutoryOverrideReason && (
        <p className="text-[10px] text-slate-500 font-bold">{`شرح تغییر بیمه یا مالیات: ${payroll.statutoryOverrideReason}`}</p>
      )}
    </>
  );
}
