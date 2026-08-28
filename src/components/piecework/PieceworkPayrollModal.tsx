import React, { FormEvent } from 'react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { X, FileText } from 'lucide-react';
import { PieceworkLog } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { formatPersianNumber, formatPersianPrice, toEnglishDigits, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkPayrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  personnelSelectOptions: { value: string; label: string }[];
  payrollPersonnelId: number | '';
  setPayrollPersonnelId: (id: number | '') => void;
  payrollStartDate: string;
  setPayrollStartDate: (d: string) => void;
  payrollEndDate: string;
  setPayrollEndDate: (d: string) => void;
  payrollBonuses: number;
  setPayrollBonuses: (val: number) => void;
  payrollDeductions: number;
  setPayrollDeductions: (val: number) => void;
  payrollNotes: string;
  setPayrollNotes: (val: string) => void;
  payrollPreviewLogs: PieceworkLog[];
  // V10-4.4: پرسنل حقوق ثابت/ترکیبی بدون کارکرد هم فیش می‌گیرد
  allowNoLogs?: boolean;
  isSaving?: boolean;
}

export function PieceworkPayrollModal({
  isOpen,
  onClose,
  onSubmit,
  personnelSelectOptions,
  payrollPersonnelId,
  setPayrollPersonnelId,
  payrollStartDate,
  setPayrollStartDate,
  payrollEndDate,
  setPayrollEndDate,
  payrollBonuses,
  setPayrollBonuses,
  payrollDeductions,
  setPayrollDeductions,
  payrollNotes,
  setPayrollNotes,
  payrollPreviewLogs,
  allowNoLogs = false,
  isSaving = false
}: PieceworkPayrollModalProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-600" />
            <span>صدور فیش حقوقی کارکرد پرسنل</span>
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">انتخاب پرسنل *</label>
            <SearchableSelect
              options={personnelSelectOptions}
              value={payrollPersonnelId ? String(payrollPersonnelId) : ''}
              onChange={(val) => setPayrollPersonnelId(val ? Number(val) : '')}
              placeholder="جستجو و انتخاب پرسنل..."
              maxResults={50}
              className="w-full text-xs font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">از تاریخ *</label>
              <DatePicker
                value={payrollStartDate}
                onChange={(dateObj: any) => {
                  setPayrollStartDate(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                placeholder="انتخاب تاریخ شروع"
                inputClass="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none focus:border-emerald-500"
                containerClassName="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تا تاریخ *</label>
              <DatePicker
                value={payrollEndDate}
                onChange={(dateObj: any) => {
                  setPayrollEndDate(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                placeholder="انتخاب تاریخ پایان"
                inputClass="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none focus:border-emerald-500"
                containerClassName="w-full"
              />
            </div>
          </div>

          {/* Preview Logs Box */}
          {payrollPersonnelId && payrollStartDate && payrollEndDate && (
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700">تعداد کارهای معوق پیدا شده:</span>
                <span className="font-mono text-emerald-700">{formatPersianNumber(payrollPreviewLogs.length)} ردیف</span>
              </div>
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700">مجموع کارکرد:</span>
                <span className="font-mono text-blue-700">
                  {formatPersianPrice(payrollPreviewLogs.reduce((sum, l) => sum + (l.totalAmount || 0), 0), appCurrency)}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{`پاداش / اضافه کار (${curLbl})`}</label>
              <input
                type="number"
                value={payrollBonuses}
                onChange={(e) => setPayrollBonuses(Number(e.target.value))}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{`کسورات / مساعده (${curLbl})`}</label>
              <input
                type="number"
                value={payrollDeductions}
                onChange={(e) => setPayrollDeductions(Number(e.target.value))}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات فیش</label>
            <input
              type="text"
              placeholder="توضیحات تکمیلی..."
              value={payrollNotes}
              onChange={(e) => setPayrollNotes(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 cursor-pointer disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              // V10-4.4: برای پرسنل حقوق ثابت/ترکیبی، خالی بودن لیست کارکرد مانع صدور نیست
              disabled={(payrollPreviewLogs.length === 0 && !allowNoLogs) || isSaving}
              className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>در حال صدور فیش...</span>
                </>
              ) : (
                <span>تایید و صدور فیش حقوقی</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
