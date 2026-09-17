import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Printer, Trash2, CheckCircle2, Clock, BookOpen, RefreshCw, Wallet, Info } from 'lucide-react';
import { PieceworkPayroll } from '../../types';
import { formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { fetchJson } from '../../api';
import { PayrollPaymentModal } from './PayrollPaymentModal';

interface PieceworkPayrollsTabProps {
  payrollsList: PieceworkPayroll[];
  onOpenPayrollModal: () => void;
  onViewPayslip: (id: number) => void;
  onUpdateStatus: (id: number, status: 'draft' | 'approved' | 'paid') => void;
  onDeletePayroll: (id: number) => void;
  onReload?: () => void;
}

export function PieceworkPayrollsTab({
  payrollsList,
  onOpenPayrollModal,
  onViewPayslip,
  onUpdateStatus,
  onDeletePayroll,
  onReload
}: PieceworkPayrollsTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  // V10-4.4: پرداخت فقط از مودال خزانه‌ای
  const [paymentTarget, setPaymentTarget] = useState<PieceworkPayroll | null>(null);

  const handleSyncVoucher = async (payrollId: number) => {
    try {
      setSyncingId(payrollId);
      const res = await fetchJson(`/piecework/payrolls/${payrollId}/sync-voucher`, {
        method: 'POST'
      });
      if (res && res.voucher) {
        toast.success(`سند دوبل حسابداری به شماره ${res.voucher.voucherNumber} با موفقیت ثبت/همگام شد.`);
        window.location.reload();
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت سند حسابداری فیش');
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-slate-900">لیست فیش‌های حقوقی و تسویه‌های دوره‌ای</h3>
          <p className="text-[11px] text-slate-500">
            فیش‌های رسمی صادرشده بر اساس تجمیع ردیف‌های کارکرد پرسنل و صدور خودکار سند حسابداری دوبل
          </p>
        </div>

        <button
          onClick={onOpenPayrollModal}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus size={16} />
          <span>صدور فیش حقوقی جدید</span>
        </button>
      </div>

      {/* Payrolls Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black">
                <th className="p-3">شماره فیش</th>
                <th className="p-3">نام پرسنل</th>
                <th className="p-3">بازه زمانی</th>
                <th className="p-3 text-center">{`مبلغ کارکرد (${curLbl})`}</th>
                <th className="p-3 text-center">{`پاداش / مزایا (${curLbl})`}</th>
                <th className="p-3 text-center">{`کسورات (${curLbl})`}</th>
                <th className="p-3 text-center">{`خالص پرداختی (${curLbl})`}</th>
                <th className="p-3 text-center">وضعیت پرداخت</th>
                <th className="p-3 text-center">سند حسابداری دوبل</th>
                <th className="p-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {payrollsList.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    هنوز فیش حقوقی صادر نشده است.
                  </td>
                </tr>
              ) : (
                payrollsList.map((payroll) => {
                  const isPaid = payroll.status === 'paid';
                  const isSyncing = syncingId === payroll.id;
                  // V1.3.4: ردیف توضیحی حقوق ثابت در خود لیست
                  const fixedAmount = Number((payroll as any).totalFixedAmount || 0);
                  const dedupNote = (payroll.notes || '')
                    .split(' | ')
                    .find((seg: string) => seg.includes('سهم حقوق ثابت')) || '';
                  const hasFixedRow = fixedAmount > 0 || dedupNote !== '';

                  return (
                    <React.Fragment key={payroll.id}>
                    <tr className="hover:bg-slate-50/80 transition-all text-slate-700">
                      <td className="p-3 font-mono font-black text-slate-900">{payroll.payrollNumber}</td>
                      <td className="p-3 font-black text-slate-900">{payroll.personnelName}</td>
                      <td className="p-3 font-mono text-slate-600">
                        {payroll.startDate} تا {payroll.endDate}
                      </td>
                      <td className="p-3 text-center font-mono text-slate-700">
                        {formatPersianPrice(payroll.totalPieceworkAmount)}
                      </td>
                      <td className="p-3 text-center font-mono text-emerald-600">
                        +{formatPersianPrice(payroll.totalBonuses || 0)}
                      </td>
                      <td className="p-3 text-center font-mono text-rose-600">
                        -{formatPersianPrice(payroll.totalDeductions || 0)}
                      </td>
                      <td className="p-3 text-center font-mono text-blue-700 font-black text-sm">
                        {formatPersianPrice(payroll.netPayable)}
                      </td>
                      <td className="p-3 text-center">
                        {isPaid ? (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] inline-flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            پرداخت‌شده
                          </span>
                        ) : (
                          <button
                            onClick={() => setPaymentTarget(payroll)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-emerald-50 text-amber-700 hover:text-emerald-700 border border-amber-200 hover:border-emerald-200 rounded-lg text-[10px] inline-flex items-center gap-1 cursor-pointer transition-all"
                            title="ثبت پرداخت از طریق خزانه‌داری (تراکنش + سند تسویه اتمیک)"
                          >
                            <Clock size={12} />
                            ثبت پرداخت
                          </button>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {payroll.voucherNumber ? (
                          <span
                            className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] inline-flex items-center gap-1 font-mono font-bold"
                            title={`سند شماره ${payroll.voucherNumber}`}
                          >
                            <BookOpen size={12} />
                            سند #{payroll.voucherNumber}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSyncVoucher(payroll.id)}
                            disabled={isSyncing}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-lg text-[10px] inline-flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                            title="صدور یا همگام‌سازی سند حسابداری"
                          >
                            <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
                            <span>{isSyncing ? 'در حال ثبت...' : 'ثبت سند دوبل'}</span>
                          </button>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onViewPayslip(payroll.id)}
                            title="مشاهده فیش و پرینت"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                          >
                            <Printer size={16} />
                          </button>
                          <button
                            onClick={() => onDeletePayroll(payroll.id)}
                            title="ابطال فیش"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {hasFixedRow && (
                      <tr className="bg-indigo-50/40">
                        <td colSpan={10} className="p-2.5 border-b border-indigo-100">
                          <div className="flex flex-col gap-0.5">
                            {fixedAmount > 0 && (
                              <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-800">
                                <Wallet size={12} className="shrink-0" />
                                <span>
                                  سهم حقوق ثابت ماهانه این فیش: <span className="font-mono">+{formatPersianPrice(fixedAmount)}</span> — بابت حقوق پایه ثبت‌شده در پرونده پرسنلی
                                </span>
                              </div>
                            )}
                            {dedupNote && (
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700">
                                <Info size={11} className="shrink-0" />
                                <span>{dedupNote}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* V10-4.4: مودال پرداخت خزانه‌ای */}
      <PayrollPaymentModal
        payroll={paymentTarget ? {
          id: paymentTarget.id,
          payrollNumber: paymentTarget.payrollNumber,
          netPayable: paymentTarget.netPayable
        } : null}
        onClose={() => setPaymentTarget(null)}
        onPaid={() => onReload?.()}
      />
    </div>
  );
}
