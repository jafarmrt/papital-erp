import { PREPAYMENT_REASON_MAX } from '../../lib/payroll/payrollPeriod';

export interface PayrollPrepaymentState {
  isPrepayment: boolean;
  setIsPrepayment: (val: boolean) => void;
  reason: string;
  setReason: (val: string) => void;
}

/** فیش پیش‌پرداخت ساخته می‌شود ولی دلیل ندارد؛ دکمه صدور بسته می‌ماند */
export function prepaymentNeedsReason(prepayment: PayrollPrepaymentState | undefined): boolean {
  return !!prepayment?.isPrepayment && !prepayment.reason.trim();
}

/**
 * v10.0.183 (TD-1085، طرح حقوق §۳.۴): فیش دوره‌ای که پایانش پس از امروز است فقط با تیک «فیش پیش‌پرداخت» و دلیل صادر
 * می‌شود؛ پیش‌پرداخت فقط حقوق ثابت را دربر می‌گیرد و کارکردهای دوره در فیش بعدی می‌آیند (همان قاعده سرور).
 */
export function PayrollPrepaymentField({ prepayment, hasFixedSalary }: { prepayment: PayrollPrepaymentState; hasFixedSalary: boolean }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
        <input
          type="checkbox"
          checked={prepayment.isPrepayment}
          onChange={(e) => prepayment.setIsPrepayment(e.target.checked)}
          className="w-4 h-4 accent-amber-600"
        />
        <span>فیش پیش‌پرداخت (پرداخت حقوق ثابت پیش از پایان دوره)</span>
      </label>
      {prepayment.isPrepayment && (
        <>
          <p className="text-[10px] text-amber-800 font-bold leading-5">
            {hasFixedSalary
              ? 'فقط حقوق ثابت این دوره پرداخت می‌شود؛ کارکردهای دوره در فیش بعدی می‌آیند.'
              : 'این پرسنل حقوق ثابت ماهانه ندارد؛ فیش پیش‌پرداخت برای او صادر نمی‌شود.'}
          </p>
          <label htmlFor="payroll-prepayment-reason" className="block text-xs font-bold text-slate-700">دلیل پیش‌پرداخت *</label>
          <input
            id="payroll-prepayment-reason"
            type="text"
            maxLength={PREPAYMENT_REASON_MAX}
            placeholder="مثلاً پرداخت پیش از تعطیلات نوروز"
            value={prepayment.reason}
            onChange={(e) => prepayment.setReason(e.target.value)}
            className="w-full px-3.5 py-2 bg-white border border-amber-200 rounded-xl text-xs font-bold text-slate-800"
          />
        </>
      )}
    </div>
  );
}

/** v10.0.183 (TD-1085): فیش پیش‌پرداخت در نمایش و چاپ فیش با دلیلش دیده می‌شود */
export function PrepaymentNotice({ payroll }: { payroll: { isPrepayment?: number | null; prepaymentReason?: string | null } }) {
  if (payroll.isPrepayment !== 1) return null;
  return (
    <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-xs font-bold text-amber-900">
      فیش پیش‌پرداخت (حقوق ثابت پیش از پایان دوره) — دلیل: {payroll.prepaymentReason || '---'}
    </div>
  );
}
