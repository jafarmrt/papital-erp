import { X } from 'lucide-react';
import { formatPersianCode } from '../../../utils';

interface InvoiceSubmitBarProps {
  isEditing: boolean;
  refNumber: string;
  disabled: boolean;
  isSaving: boolean;
  onCancelEdit: () => void;
}

/** متن دکمه‌ها؛ آزمون‌ها همین را می‌خوانند */
export const INVOICE_SUBMIT_TEXT = {
  saving: 'در حال ثبت...',
  saveEdit: 'ذخیره تغییرات پیش‌فاکتور',
  submit: 'ثبت و صدور فاکتور',
  cancel: 'انصراف',
} as const;

/**
 * v10.2.4 (گزینه «ج»): نوار پایین فرم. دکمه اصلی در آغاز سطر (راست) است و روی گوشی تمام‌عرض؛ در ویرایش پیش‌فاکتور
 * شماره آن و دکمه انصراف کنارش.
 */
export function InvoiceSubmitBar({ isEditing, refNumber, disabled, isSaving, onCancelEdit }: InvoiceSubmitBarProps) {
  return (
    <div className="border-t border-slate-100 pt-4 flex flex-col-reverse sm:flex-row sm:items-center gap-3">
      <button type="submit" disabled={disabled}
        className="w-full sm:w-auto min-h-[44px] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1">
        {isSaving ? INVOICE_SUBMIT_TEXT.saving : isEditing ? INVOICE_SUBMIT_TEXT.saveEdit : INVOICE_SUBMIT_TEXT.submit}
      </button>
      {isEditing && (
        <div className="flex items-center justify-between sm:justify-start gap-2 text-amber-800 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200 text-xs font-bold">
          <span>در حال ویرایش پیش‌فاکتور {formatPersianCode(refNumber)}</span>
          <button type="button" onClick={onCancelEdit}
            className="min-h-[32px] text-slate-700 hover:text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 font-normal">
            <X size={12} aria-hidden="true" /> {INVOICE_SUBMIT_TEXT.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
