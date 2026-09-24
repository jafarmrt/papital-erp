import React, { useId, useMemo, useRef } from 'react';
import { Building2, Check, AlertCircle } from 'lucide-react';
import {
  normalizeSheba,
  getIranianBankFromSheba,
  validateIranianSheba,
  toEnglishDigits
} from '../../utils';

export interface ShebaInputProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  name?: string;
  showBankBadge?: boolean;
  showValidationHint?: boolean;
  autoFocus?: boolean;
}

/**
 * فرمت‌بندی ۲۴ رقم عددی شبا به دسته‌های استاندارد بانکی:
 * ۲ رقم چک + پنج دسته ۴ رقمی + ۲ رقم آخر
 * مثال: 65 0120 0000 0000 1234 5678 90
 */
function formatShebaDigits(digits: string): string {
  if (!digits) return '';
  const clean = digits.replace(/\D/g, '').slice(0, 24);
  const parts: string[] = [];

  let idx = 0;
  // ۲ رقم اول (کد کنترل)
  if (clean.length > 0) {
    parts.push(clean.substring(0, Math.min(2, clean.length)));
    idx = 2;
  }
  // دسته‌های ۴ رقمی
  while (idx < clean.length) {
    const chunk = clean.substring(idx, Math.min(idx + 4, clean.length));
    parts.push(chunk);
    idx += 4;
  }

  return parts.join(' ');
}

/**
 * کامپوننت هوشمند ورودی شماره شبا (الگوبرداری‌شده از وایب‌فارسی - فاز ۲)
 * ویژگی‌ها:
 * - پیشوند ثابت و تفکیک‌شده IR در کانتینر LTR
 * - فرمت‌بندی خودکار ۲۴ رقم شبا به دسته‌های خوانا
 * - استخراج و نمایش بلادرنگ نام بانک از روی کد ۳ رقمی شناسه بانک در شبا
 * - اعتبارسنجی ریاضی رسمی استاندارد ISO 7064 Mod 97-10
 * - دریافت هوشمند مقدار در حالت Paste (چه با IR و چه بدون IR)
 * - بازگشت شماره شبای استاندارد ۲۶ کاراکتری کامل (IR...) به فرم والد
 */
export const ShebaInput: React.FC<ShebaInputProps> = ({
  value,
  onChange,
  onBlur,
  label,
  placeholder = '-- ---- ---- ---- ---- ---- --',
  required = false,
  disabled = false,
  readOnly = false,
  className = '',
  inputClassName = '',
  id,
  name,
  showBankBadge = true,
  showValidationHint = true,
  autoFocus = false
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const inputRef = useRef<HTMLInputElement>(null);

  // استانداردسازی مقدار کامل شبا
  const fullCanonicalSheba = useMemo(() => normalizeSheba(value), [value]);

  // ۲۴ رقم بعد از IR
  const numericDigits = useMemo(() => {
    if (!fullCanonicalSheba.startsWith('IR')) return '';
    return fullCanonicalSheba.slice(2);
  }, [fullCanonicalSheba]);

  // اطلاعات بانک صادرکننده شبا
  const bankInfo = useMemo(() => getIranianBankFromSheba(fullCanonicalSheba), [fullCanonicalSheba]);

  // اعتبارسنجی ISO 7064 Mod 97-10
  const validation = useMemo(() => {
    if (!fullCanonicalSheba) return null;
    return validateIranianSheba(fullCanonicalSheba);
  }, [fullCanonicalSheba]);

  // فرمت نمایشی ۲۴ رقم
  const displayFormatted = useMemo(() => {
    return formatShebaDigits(numericDigits);
  }, [numericDigits]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const currentCursor = input.selectionStart || 0;

    // استخراج ارقام پیش از مکان‌نما جهت حفظ موقعیت کرسر
    const digitsBeforeCursor = toEnglishDigits(input.value.slice(0, currentCursor)).replace(/\D/g, '').length;

    // پاکسازی ورودی کاربر و تبدیل ارقام فارسی به لاتین
    let raw = toEnglishDigits(input.value).toUpperCase().replace(/[^0-9A-Z]/g, '');

    // اگر کاربر به اشتباه IR را در اینپوت تایپ یا پیست کرده باشد، آن را جدا می‌کنیم
    if (raw.startsWith('IR')) {
      raw = raw.slice(2);
    }
    const cleanDigits = raw.replace(/\D/g, '').slice(0, 24);

    // شماره شبای استاندارد با پیشوند IR برای ارسال به والد
    const newFullSheba = cleanDigits.length > 0 ? `IR${cleanDigits}` : '';
    onChange(newFullSheba);

    // حفظ مکان‌نما
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const newFormatted = formatShebaDigits(cleanDigits);
      let newCursor = 0;
      let digitsCount = 0;

      for (let i = 0; i < newFormatted.length; i++) {
        if (/\d/.test(newFormatted[i])) {
          digitsCount++;
        }
        if (digitsCount === digitsBeforeCursor) {
          newCursor = i + 1;
          break;
        }
      }
      if (digitsBeforeCursor === 0) newCursor = 0;
      if (digitsBeforeCursor >= cleanDigits.length) newCursor = newFormatted.length;

      inputRef.current.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && inputRef.current) {
      const cursor = inputRef.current.selectionStart || 0;
      const val = inputRef.current.value;
      if (cursor > 0 && val[cursor - 1] === ' ') {
        e.preventDefault();
        const before = val.slice(0, cursor);
        const lastDigitIndex = before.search(/\d(?=[^\d]*$)/);
        if (lastDigitIndex !== -1) {
          const newClean = (val.slice(0, lastDigitIndex) + val.slice(lastDigitIndex + 1))
            .replace(/\D/g, '')
            .slice(0, 24);
          onChange(newClean ? `IR${newClean}` : '');
        }
      }
    }
  };

  const hasValue = numericDigits.length > 0;
  const isComplete = numericDigits.length === 24;
  const isValid = validation?.isValid ?? false;

  let borderClasses = 'border-slate-200 dark:border-slate-700 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30';
  if (hasValue && isComplete) {
    if (isValid) {
      borderClasses = 'border-emerald-500/80 ring-2 ring-emerald-100 dark:ring-emerald-950/40 focus-within:border-emerald-600';
    } else {
      borderClasses = 'border-amber-500/80 ring-2 ring-amber-100 dark:ring-amber-950/40 focus-within:border-amber-600';
    }
  }

  return (
    <div className={`flex flex-col gap-1 text-right ${className}`}>
      {(label || (showBankBadge && bankInfo)) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <label htmlFor={inputId} className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <span>{label}</span>
              {required && <span className="text-rose-500">*</span>}
            </label>
          )}

          {showBankBadge && bankInfo && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300 transition-all duration-200"
            >
              <Building2 size={12} className="shrink-0" />
              <span>{bankInfo.name}</span>
            </span>
          )}
        </div>
      )}

      <div
        className={`relative flex items-center bg-white dark:bg-slate-800 border rounded-xl transition-all duration-150 ${borderClasses} ${
          disabled ? 'opacity-60 bg-slate-50 dark:bg-slate-900 cursor-not-allowed' : ''
        }`}
      >
        {/* پیشوند ثابت و استاندارد IR */}
        <div className="flex items-center gap-1 px-2.5 py-2 bg-slate-100 dark:bg-slate-700/60 border-l border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-mono font-black text-xs md:text-sm select-none rounded-r-[11px]">
          <span>IR</span>
        </div>

        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          dir="ltr"
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={readOnly}
          value={displayFormatted}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`w-full py-2 px-3 text-xs md:text-sm font-mono tracking-wider font-bold bg-transparent text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:tracking-normal outline-none text-left ${inputClassName}`}
        />

        {hasValue && (
          <div className="pl-3 flex items-center shrink-0">
            {isComplete && isValid && (
              <span title="شماره شبا معتبر است (تایید ISO 7064)" className="text-emerald-500">
                <Check size={16} className="stroke-[2.5]" />
              </span>
            )}
            {isComplete && !isValid && (
              <span title={validation?.error || 'رقم‌های کنترلی شبا نامعتبر است'} className="text-amber-500">
                <AlertCircle size={16} />
              </span>
            )}
          </div>
        )}
      </div>

      {showValidationHint && hasValue && !isValid && isComplete && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
          {validation?.error}
        </p>
      )}
    </div>
  );
};
