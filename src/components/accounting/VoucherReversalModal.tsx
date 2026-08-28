import React, { useState } from 'react';
import { RotateCcw, X, AlertTriangle, ArrowRightLeft, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, getTodayJalaliDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { JournalVoucher } from '../../types';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import toast from 'react-hot-toast';

interface VoucherReversalModalProps {
  isOpen: boolean;
  onClose: () => void;
  voucher: JournalVoucher | null;
  onConfirm: (voucherId: number, reason: string, date: string) => Promise<void>;
}

export function VoucherReversalModal({
  isOpen,
  onClose,
  voucher,
  onConfirm,
}: VoucherReversalModalProps) {
  const appCurrency = useAppCurrency();
  const [date, setDate] = useState(() => getTodayJalaliDate());
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !voucher) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('لطفاً دلیل برگشت سند را وارد نمایید');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(voucher.id, reason.trim(), date.trim());
      onClose();
    } catch (err) {
      toast.error(err.message || 'خطا در صدور سند معکوس');
    } finally {
      setIsSubmitting(false);
    }
  };

  const safeItems = Array.isArray(voucher.items) ? voucher.items : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-850 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>صدور سند معکوس (عطف / برگشت)</span>
                <span className="text-xs font-mono bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">
                  سند شماره #{formatPersianNumber(voucher.voucherNumber)}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                ترازنامه و دفاتر مالی بدون دستکاری سند اصلی و مطابق با اصول استاندارد حسابداری خنثی می‌شوند.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Warning Banner */}
          <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold">اصل عدم تغییرناپذیری اسناد (No-Direct-Edit):</span> با تایید این فرم، یک سند جدید با معکوس شدن تمام ردیف‌های بدهکار و بستانکار (بدهکار به بستانکار و بستانکار به بدهکار) ثبت شده و اثر مالی سند اصلی به طور کامل خنثی می‌گردد.
            </div>
          </div>

          {/* Details & Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                <span>تاریخ ثبت سند معکوس</span>
              </label>
              <DatePicker
                value={date}
                onChange={(dateObj: any) => {
                  setDate(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                containerClassName="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                مبلغ کل مورد برگشت
              </label>
              <div className="w-full px-3 py-2 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatPersianPrice(voucher.totalDebit, voucher.currency || appCurrency)}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              <span>علت و دلیل صدور سند معکوس (الزامی)</span>
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: اشتباه در کدینگ حساب طرف حساب یا صدور فاکتور برگشتی..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
          </div>

          {/* Inverted Rows Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
                <span>پیش‌نمایش معکوس‌سازی آرتیکل‌ها:</span>
              </span>
              <span className="text-[11px] text-slate-400 font-normal">
                ({formatPersianNumber(safeItems.length)} ردیف)
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[11px] border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 px-2.5">حساب</th>
                    <th className="py-2 px-2.5 text-left text-rose-600 dark:text-rose-400">بدهکار قبلی → بستانکار جدید</th>
                    <th className="py-2 px-2.5 text-left text-emerald-600 dark:text-emerald-400">بستانکار قبلی → بدهکار جدید</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {safeItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-2.5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {item.accountName || item.accountCode}
                        </div>
                        {item.detailedName && (
                          <div className="text-[10px] text-slate-400">{item.detailedName}</div>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-left font-mono text-slate-600 dark:text-slate-300">
                        {item.debit > 0 ? (
                          <span className="font-bold text-amber-600 dark:text-amber-400">
                            {formatPersianPrice(item.debit)} (بستانکار)
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2 px-2.5 text-left font-mono text-slate-600 dark:text-slate-300">
                        {item.credit > 0 ? (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatPersianPrice(item.credit)} (بدهکار)
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-md shadow-amber-900/20 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'در حال ثبت سند معکوس...' : 'ثبت و صدور سند معکوس'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
