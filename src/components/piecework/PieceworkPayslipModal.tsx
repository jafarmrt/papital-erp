import { useState } from 'react';
import { X, FileText, Printer } from 'lucide-react';
import { PieceworkPayroll } from '../../types';
import { formatPersianPrice, formatQuantityOrTime, formatPersianDate, formatPersianNumber, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { PayrollPaymentModal } from './PayrollPaymentModal';

interface PieceworkPayslipModalProps {
  viewingPayroll: PieceworkPayroll | null;
  onClose: () => void;
  onUpdateStatus: (id: number, status: 'draft' | 'approved' | 'paid') => void;
  onDeletePayroll: (id: number) => void;
  onReload?: () => void;
  /** مشاهده صرفاً برای پرسنل (بدون دکمه‌های پرداخت/ابطال) */
  readOnly?: boolean;
}

export function PieceworkPayslipModal({
  viewingPayroll,
  onClose,
  onUpdateStatus,
  onDeletePayroll,
  onReload,
  readOnly = false
}: PieceworkPayslipModalProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  // V10-4.4: مودال پرداخت خزانه‌ای
  const [paymentTarget, setPaymentTarget] = useState<{ id: number; payrollNumber: string; netPayable: number | string } | null>(null);
  if (!viewingPayroll) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200 print:m-0 print:border-none print:shadow-none">
        {/* Action Header - Hidden on Print */}
        <div className="p-4 bg-slate-800 text-white flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-sm">فیش حقوقی رسمی پرسنل ({viewingPayroll.payrollNumber})</span>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && viewingPayroll.status !== 'paid' && (
              <button
                onClick={() => {
                  // V10-4.4: پرداخت فقط از مودال خزانه‌ای
                  setPaymentTarget({
                    id: viewingPayroll.id,
                    payrollNumber: viewingPayroll.payrollNumber,
                    netPayable: viewingPayroll.netPayable
                  });
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                ثبت پرداخت (از خزانه)
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>پرینت فیش</span>
            </button>
            {!readOnly && (
              <button
                onClick={() => onDeletePayroll(viewingPayroll.id)}
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                ابطال فیش
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-slate-700 rounded-full text-slate-300 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Payslip Body */}
        <div className="p-8 space-y-6 text-slate-900 font-sans" id="printable-payslip">
          {/* Payslip Top Banner */}
          <div className="border-b-2 border-slate-900 pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900">فیش کارکرد و حقوق پرسنل</h2>
              <p className="text-xs text-slate-600 font-bold mt-1">مجموعه پاپیتال - کارگاه تولید زیورآلات و سفال</p>
            </div>
            <div className="text-left font-mono text-xs space-y-1">
              <div>شماره فیش: <span className="font-bold">{formatPersianNumber(viewingPayroll.payrollNumber)}</span></div>
              <div>تاریخ صدور: <span className="font-bold">{formatPersianDate(viewingPayroll.createdAt)}</span></div>
              <div>بازه کارکرد: <span className="font-bold">{formatPersianDate(viewingPayroll.startDate)} تا {formatPersianDate(viewingPayroll.endDate)}</span></div>
            </div>
          </div>

          {/* Personnel Info Box */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 font-bold block">نام و نام خانوادگی:</span>
              <span className="font-black text-slate-900 text-sm mt-0.5 block">{viewingPayroll.personnelName}</span>
            </div>
            <div>
              <span className="text-slate-500 font-bold block">کد پرسنلی / عنوان شغلی:</span>
              <span className="font-bold text-slate-800 mt-0.5 block">{viewingPayroll.personnelCode || '---'} ({viewingPayroll.jobTitle || 'نامشخص'})</span>
            </div>
            <div>
              <span className="text-slate-500 font-bold block">بانک / شماره کارت:</span>
              <span className="font-bold font-mono text-slate-800 mt-0.5 block">{viewingPayroll.bankName || 'بانک'} - {viewingPayroll.cardNumber || '---'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-bold block">شماره شبا:</span>
              <span className="font-bold font-mono text-slate-800 mt-0.5 block">{viewingPayroll.shebaNumber || '---'}</span>
            </div>
          </div>

          {/* Items Breakdown Table */}
          <div>
            <h3 className="text-xs font-black text-slate-800 mb-2">ریز مبانی محاسبه فیش (کارکرد پرکیسی و حقوق پایه):</h3>
            <table className="w-full text-right border-collapse text-xs border border-slate-300">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-800 font-bold">
                  <th className="p-2.5 border-l border-slate-300">#</th>
                  <th className="p-2.5 border-l border-slate-300">تاریخ</th>
                  <th className="p-2.5 border-l border-slate-300">عنوان کاری</th>
                  <th className="p-2.5 border-l border-slate-300 text-center">تعداد / مقدار</th>
                  <th className="p-2.5 border-l border-slate-300 text-center">{`نرخ واحد (${curLbl})`}</th>
                  <th className="p-2.5 text-center">{`مبلغ کل (${curLbl})`}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                {viewingPayroll.items && viewingPayroll.items.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="p-2 border-l border-slate-200 text-slate-500">{formatPersianNumber(idx + 1)}</td>
                    <td className="p-2 border-l border-slate-200 font-bold">{formatPersianDate(item.date)}</td>
                    <td className="p-2 border-l border-slate-200 font-sans font-bold">{item.taskTitle}</td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold">
                      {formatQuantityOrTime(item.quantity, item.unit)}
                    </td>
                    <td className="p-2 border-l border-slate-200 text-center">{formatPersianPrice(item.unitRate)}</td>
                    <td className="p-2 text-center font-bold">{formatPersianPrice(item.totalAmount)}</td>
                  </tr>
                ))}
                {/* ردیف توضیحی حقوق ثابت: مبنا و بابت مبلغ اضافه‌شده */}
                {(Number(viewingPayroll.totalFixedAmount) || 0) > 0 && (
                  <tr className="bg-indigo-50/60">
                    <td className="p-2 border-l border-slate-200 text-slate-500">{formatPersianNumber((viewingPayroll.items?.length || 0) + 1)}</td>
                    <td className="p-2 border-l border-slate-200 font-bold">
                      {formatPersianDate(viewingPayroll.startDate)} تا {formatPersianDate(viewingPayroll.endDate)}
                    </td>
                    <td className="p-2 border-l border-slate-200 font-sans font-bold text-indigo-800">
                      حقوق ثابت ماهانه — بابت حقوق پایه ثبت‌شده در پرونده پرسنلی
                    </td>
                    <td className="p-2 border-l border-slate-200 text-center font-bold">۱ دوره ماهانه</td>
                    <td className="p-2 border-l border-slate-200 text-center">{formatPersianPrice(viewingPayroll.totalFixedAmount)}</td>
                    <td className="p-2 text-center font-bold text-indigo-800">+{formatPersianPrice(viewingPayroll.totalFixedAmount)}</td>
                  </tr>
                )}
                {(!viewingPayroll.items || viewingPayroll.items.length === 0) && (Number(viewingPayroll.totalFixedAmount) || 0) <= 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-400 font-sans">در این دوره ردیف کارکرد پرکیسی ثبت نشده است.</td>
                  </tr>
                )}
              </tbody>
          </table>
          {/* توضیح مبنای محاسبه برای پرسنل */}
          <p className="text-[10px] text-slate-500 mt-1.5 leading-5">
            {(Number(viewingPayroll.totalFixedAmount) || 0) > 0
              ? `ردیف «حقوق ثابت ماهانه» بابت حقوق پایه ماهانه ثبت‌شده در پرونده پرسنلی (${viewingPayroll.personnelName}) برای دوره فوق اضافه شده است.`
              : 'مبالغ این فیش صرفاً بر اساس ردیف‌های کارکرد پرکیسی (نرخ عناوین کاری) محاسبه شده است.'}
          </p>
        </div>

          {/* Totals Summary Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between font-bold">
                <span>جمع کارکرد:</span>
                <span className="font-mono">{formatPersianPrice(viewingPayroll.totalPieceworkAmount, appCurrency)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-700">
                <span>پاداش و اضافه کار:</span>
                <span className="font-mono">+{formatPersianPrice(viewingPayroll.totalBonuses || 0, appCurrency)}</span>
              </div>
              {/* V10-4.4: تفکیک حقوق ثابت (در فیش‌های monthly_fixed / mixed) */}
              {(Number(viewingPayroll.totalFixedAmount) || 0) > 0 && (
                <div className="flex justify-between font-bold text-indigo-700">
                  <span>سهم حقوق ثابت ماهانه:</span>
                  <span className="font-mono">+{formatPersianPrice(viewingPayroll.totalFixedAmount, appCurrency)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-red-700">
                <span>کسورات و سایر کسورات:</span>
                <span className="font-mono">-{formatPersianPrice(viewingPayroll.totalDeductions || 0, appCurrency)}</span>
              </div>
              {/* V1.9.0: کسر از مساعده/وام پرسنلی */}
              {(Number(viewingPayroll.advanceDeduction) || 0) > 0 && (
                <div className="flex justify-between font-bold text-indigo-700">
                  <span>کسر از مساعده و وام پرسنلی:</span>
                  <span className="font-mono">-{formatPersianPrice(viewingPayroll.advanceDeduction, appCurrency)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-300 flex justify-between font-black text-sm text-slate-900">
                <span>مبلغ خالص قابل پرداخت:</span>
                <span className="font-mono text-blue-800">{formatPersianPrice(viewingPayroll.netPayable, appCurrency)}</span>
              </div>
            </div>

            {/* Signatures */}
            <div className="border border-slate-200 rounded-2xl p-4 grid grid-cols-2 gap-4 h-full text-xs font-bold text-center">
              <div className="flex flex-col justify-between h-28 border-l border-slate-200 pl-2">
                <span>امضاء مدیر کارگاه / حسابداری</span>
                <div className="border-b border-dashed border-slate-400"></div>
              </div>
              <div className="flex flex-col justify-between h-28 pr-2">
                <span>امضاء و تایید پرسنل</span>
                <div className="border-b border-dashed border-slate-400"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* V10-4.4: مودال پرداخت خزانه‌ای */}
      <PayrollPaymentModal
        payroll={paymentTarget}
        onClose={() => setPaymentTarget(null)}
        onPaid={onReload}
      />
    </div>
  );
}
