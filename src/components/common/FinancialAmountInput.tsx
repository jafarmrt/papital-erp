import React, { useId, useMemo, useRef } from 'react';
import { Coins, Copy, Check } from 'lucide-react';
import {
  toEnglishDigits,
  formatCurrencyLabel,
  financialAmountToPersianWords
} from '../../utils';

export interface FinancialAmountInputProps {
  /** مقدار عددی مبلغ به واحد پولی مشخص‌شده (مثلاً ریال یا دلار) */
  value: number | string | null | undefined;
  /** تابع بازخورد تغییرات با مقدار عددی پاکسازی‌شده */
  onChange: (val: number) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** واحد پولی (پیش‌فرض IRR) */
  currency?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  name?: string;
  /** نمایش معادل روان به حروف در زیر اینپوت */
  showWordsBadge?: boolean;
  /** نمایش معادل تومان در صورت ریالی بودن واحد پول */
  showTomanEquivalent?: boolean;
  /** امکان کپی سریع مبلغ حروفی یا عددی */
  allowCopyWords?: boolean;
  /** حداقل و حداکثر مجاز */
  min?: number;
  max?: number;
  autoFocus?: boolean;
  /** راهنما یا هشدار سفارشی اضافی */
  helperText?: React.ReactNode;
}

/**
 * کامپوننت ارگونومیک ورودی مبالغ مالی (وایب‌فارسی - فاز ۳)
 * ویژگی‌ها:
 * - جداسازی خودکار ۳ رقمی ارقام (1,000,000) در زمان تایپ زنده
 * - کنترل دقیق مکان‌نما (Caret Tracking) و عدم پرش کرسر هنگام درج جداکننده‌ها
 * - تبدیل همگام مبلغ به حروف سلیس فارسی (پشتیبانی تا کوادریلیون)
 * - تفکیک هوشمند ریال و تومان (نمایش معادل تومانی زیر مبلغ ریالی)
 * - بازگرداندن عدد تمیز (Clean Number) به فرم والد
 */
export const FinancialAmountInput: React.FC<FinancialAmountInputProps> = ({
  value,
  onChange,
  onBlur,
  currency = 'IRR',
  label,
  placeholder = '0',
  required = false,
  disabled = false,
  readOnly = false,
  className = '',
  inputClassName = '',
  id,
  name,
  showWordsBadge = true,
  showTomanEquivalent = true,
  allowCopyWords = true,
  min,
  max,
  autoFocus = false,
  helperText
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = React.useState(false);

  // پاکسازی ورودی و استخراج عدد صحیح
  const numericValue = useMemo(() => {
    if (value === null || value === undefined || value === '') return 0;
    const clean = toEnglishDigits(String(value)).replace(/[,\s]/g, '');
    const parsed = Number(clean);
    return isNaN(parsed) ? 0 : parsed;
  }, [value]);

  // رشته نمایشی فرمت‌شده با کامای انگلیسی
  const displayFormatted = useMemo(() => {
    if (value === null || value === undefined || value === '') return '';
    const clean = toEnglishDigits(String(value)).replace(/[,\s]/g, '');
    if (clean === '' || clean === '0') return clean;
    // جداسازی ارقام با کاما
    const isNegative = clean.startsWith('-');
    const digits = isNegative ? clean.slice(1) : clean;
    const parts = digits.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (isNegative ? '-' : '') + parts.join('.');
  }, [value]);

  // تبدیل مبلغ به حروف فارسی
  const wordsResult = useMemo(() => {
    if (!numericValue || numericValue === 0) return null;
    return financialAmountToPersianWords(numericValue, currency);
  }, [numericValue, currency]);

  const curLabel = useMemo(() => formatCurrencyLabel(currency), [currency]);
  const isRial = (currency?.toUpperCase() === 'IRR' || currency === 'ریال');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const currentCursor = input.selectionStart || 0;

    // شمارش تعداد ارقام تا قبل از مکان‌نما
    const rawBeforeCursor = input.value.slice(0, currentCursor);
    const digitsBeforeCursor = toEnglishDigits(rawBeforeCursor).replace(/[^\d.-]/g, '').length;

    // استخراج رقم تمیز
    const cleanStr = toEnglishDigits(input.value).replace(/,/g, '').trim();
    if (cleanStr === '' || cleanStr === '-') {
      onChange(0);
      return;
    }

    const parsed = parseFloat(cleanStr);
    const safeNum = isNaN(parsed) ? 0 : parsed;
    onChange(safeNum);

    // تنظیم مجدد موقعیت مکان‌نما پس از درج کاماها
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const newDisplay = inputRef.current.value;
      let newCursor = 0;
      let digitsCount = 0;

      for (let i = 0; i < newDisplay.length; i++) {
        if (/[\d.-]/.test(newDisplay[i])) {
          digitsCount++;
        }
        if (digitsCount === digitsBeforeCursor) {
          newCursor = i + 1;
          break;
        }
      }
      if (digitsBeforeCursor === 0) newCursor = 0;
      if (digitsBeforeCursor >= cleanStr.length) newCursor = newDisplay.length;

      inputRef.current.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleCopyWords = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!wordsResult?.words) return;
    const textToCopy = isRial && showTomanEquivalent && wordsResult.tomanEquivalent
      ? wordsResult.fullDescription
      : wordsResult.words;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            {label}
            {required && <span className="text-rose-500 mr-1">*</span>}
          </label>
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            {curLabel}
          </span>
        </div>
      )}

      {/* Input container */}
      <div className="relative rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 transition-all focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent flex items-center shadow-xs">
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          dir="ltr"
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          value={displayFormatted}
          onChange={handleChange}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`w-full py-2 px-3 text-xs font-mono font-bold text-left bg-transparent border-0 outline-none text-slate-900 dark:text-white placeholder:text-slate-400 ${inputClassName}`}
        />
        <div className="px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 rounded-l-lg select-none shrink-0">
          {curLabel}
        </div>
      </div>

      {/* Words Preview Badge (Persian words + Toman equivalent) */}
      {showWordsBadge && wordsResult && (
        <div className="flex items-start justify-between gap-2 p-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-950 dark:text-indigo-200 animate-fadeIn">
          <div className="flex items-start gap-1.5 flex-1 min-w-0">
            <Coins className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-5">
              <span className="font-bold text-indigo-900 dark:text-indigo-200">
                {wordsResult.words}
              </span>
              {isRial && showTomanEquivalent && wordsResult.tomanEquivalent && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  معادل: <strong className="text-emerald-700 dark:text-emerald-400">{wordsResult.tomanEquivalent}</strong>
                </div>
              )}
            </div>
          </div>
          {allowCopyWords && (
            <button
              type="button"
              onClick={handleCopyWords}
              title="کپی مبلغ به حروف"
              className="p-1 rounded text-indigo-500 hover:text-indigo-800 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition cursor-pointer shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      )}

      {helperText && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {helperText}
        </div>
      )}
    </div>
  );
};
export default FinancialAmountInput;
