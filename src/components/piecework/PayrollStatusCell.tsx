import { CheckCircle2, Clock } from 'lucide-react';
import { PieceworkPayroll } from '../../types';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { usePieceworkPermissions } from '../../hooks/usePieceworkPermissions';
import { useViewerIdentity } from '../../contexts/AuthContext';
import { isPayablePayrollStatus } from '../../lib/payroll/payrollPayable';
import { payrollStatusLabel } from '../../lib/payroll/payrollStatusLabels';
import { payrollIssuerDutyRefusal } from '../../lib/payroll/payrollDuties';

interface PayrollStatusCellProps {
  payroll: PieceworkPayroll;
  paidAmount: number;
  remainingAmount: number;
  onApprove: () => void;
  onOpenPayment: () => void;
}

/**
 * The payment-state cell of one payslip row. v10.0.182 (TD-1083 / TD-1084): a draft is approved with «تأیید فیش حقوق»,
 * and the issuer of a payslip sees approve and pay disabled with the reason (the server refuses them too).
 */
export function PayrollStatusCell({ payroll, paidAmount, remainingAmount, onApprove, onOpenPayment }: PayrollStatusCellProps) {
  const rial = useRialDisplay();
  const { canApprovePayroll, canPay } = usePieceworkPermissions();
  const viewer = useViewerIdentity();
  const approveRefusal = payrollIssuerDutyRefusal(payroll, viewer, 'approve');
  const payRefusal = payrollIssuerDutyRefusal(payroll, viewer, 'pay');

  if (payroll.status === 'paid') {
    // v8.0.31 (TD-283): فیش تسویه‌شده هم پنجره پرداخت را باز می‌کند (سابقه و ابطال پرداخت)
    return (
      <button
        onClick={onOpenPayment}
        className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] inline-flex items-center gap-1 font-bold cursor-pointer hover:bg-emerald-100"
        title="مشاهده پرداخت‌ها و ابطال پرداخت"
      >
        <CheckCircle2 size={12} />
        پرداخت‌شده
      </button>
    );
  }
  if (payroll.status === 'partially_paid') {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-[10px] inline-flex items-center gap-1 font-bold font-mono">
          <Clock size={11} className="text-amber-600" />
          جزئی: {rial.amount(paidAmount)}
        </span>
        {canPay && (
          <button
            onClick={onOpenPayment}
            disabled={!!payRefusal}
            className="px-2 py-0.5 bg-amber-600 hover:bg-emerald-600 text-white rounded-md text-[10px] font-bold cursor-pointer transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title={payRefusal ?? `مانده: ${rial.amount(remainingAmount)} — ثبت قسط بعدی`}
          >
            پرداخت مانده
          </button>
        )}
      </div>
    );
  }
  if (!isPayablePayrollStatus(payroll.status)) {
    if (!canApprovePayroll) return <StatusChip label={payrollStatusLabel(payroll.status)} />;
    // v9.0.269 (TD-816): فیش پیش‌نویس پرداخت نمی‌شود؛ نخست تأیید می‌شود
    return (
      <button
        onClick={onApprove}
        disabled={!!approveRefusal}
        className="px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-lg text-[10px] inline-flex items-center gap-1 cursor-pointer transition-all font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        title={approveRefusal ?? 'فیش پیش‌نویس پیش از ثبت پرداخت تأیید می‌شود'}
      >
        <CheckCircle2 size={12} />
        تأیید فیش
      </button>
    );
  }
  if (!canPay) return <StatusChip label={payrollStatusLabel(payroll.status)} />;
  return (
    <button
      onClick={onOpenPayment}
      disabled={!!payRefusal}
      className="px-2.5 py-1 bg-amber-50 hover:bg-emerald-50 text-amber-700 hover:text-emerald-700 border border-amber-200 hover:border-emerald-200 rounded-lg text-[10px] inline-flex items-center gap-1 cursor-pointer transition-all font-bold disabled:opacity-40 disabled:cursor-not-allowed"
      title={payRefusal ?? 'ثبت پرداخت از طریق خزانه‌داری (تراکنش + سند تسویه اتمیک)'}
    >
      <Clock size={12} />
      ثبت پرداخت
    </button>
  );
}

/** وضعیت فیش برای کاربری که دکمه آن کار را ندارد (v9.0.320، TD-805) */
export function StatusChip({ label }: { label: string }) {
  return (
    <span className="px-2.5 py-1 bg-slate-50 text-slate-500 border border-slate-200 rounded-lg text-[10px] inline-flex items-center gap-1 font-bold">
      {label}
    </span>
  );
}
