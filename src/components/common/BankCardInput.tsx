import React, { useId, useMemo, useRef } from 'react';
import { CreditCard, Check, AlertCircle } from 'lucide-react';
import {
  normalizeBankCard,
  formatBankCard,
  getIranianBankFromCard,
  validateBankCardNumber,
  toEnglishDigits
} from '../../utils';

export interface BankCardInputProps {
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
 * کامپوننت هوشمند ورودی شماره کارت بانکی (الگوبرداری‌شده از وایب‌فارسی - فاز ۲)
 * ویژگی‌ها:
 * - گروه‌بندی خودکار ۴ رقمی ارقام (xxxx - xxxx - xxxx - xxxx)
 * - عدم پرش مکان‌نما (Caret Handling) در حین تایپ و ویرایش
 * - استخراج و نمایش زنده نام و نشانگر رنگی بانک عضو شتاب از روی ۶ رقم اول (BIN)
 * - اعتبارسنجی الگوریتم لان (Luhn Algorithm) روی ۱۶ رقم کامل
 * - بازگشت مقدار خام ۱۶ رقمی به والد (جهت سازگاری کامل با فرم‌ها و دیتابیس)
 */
export const BankCardInput: React.FC<BankCardInputProps> = ({
  value,
  onChange,
  onBlur,
  label,
  placeholder = '---- - ---- - ---- - ----',
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

  // استخراج ارقام خام تا حداکثر ۱۶ رقم
  const rawDigits = useMemo(() => normalizeBankCard(value), [value]);

  // اطلاعات بانک صادرکننده کارت از روی ۶ رقم اول
  const bankInfo = useMemo(() => getIranianBankFromCard(rawDigits), [rawDigits]);

  // نتیجه اعتبارسنجی لان و ساختار
  const validation = useMemo(() => {
    if (!rawDigits) return null;
    return validateBankCardNumber(rawDigits);
  }, [rawDigits]);

  // فرمت نمایشی ۱۶ رقمی در کادر ورودی
  const displayFormatted = useMemo(() => {
    return formatBankCard(rawDigits, ' - ');
  }, [rawDigits]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const currentCursor = input.selectionStart || 0;

    // استخراج ارقام تا قبل از موقعیت مکان‌نما جهت حفظ موقعیت کرسر
    const digitsBeforeCursor = toEnglishDigits(input.value.slice(0, currentCursor)).replace(/\D/g, '').length;

    // استخراج کل ارقام جدید
    const newCleanDigits = toEnglishDigits(input.value).replace(/\D/g, '').slice(0, 16);

    onChange(newCleanDigits);

    // محاسبه و بازنشانی موقعیت مکان‌نما در رندر بعدی
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const newFormatted = formatBankCard(newCleanDigits, ' - ');
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
      if (digitsBeforeCursor >= newCleanDigits.length) newCursor = newFormatted.length;

      inputRef.current.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // جلوگیری از گیر کردن در خط تیره‌ها هنگام فشردن Backspace
    if (e.key === 'Backspace' && inputRef.current) {
      const cursor = inputRef.current.selectionStart || 0;
      const val = inputRef.current.value;
      if (cursor > 0 && (val[cursor - 1] === ' ' || val[cursor - 1] === '-')) {
        e.preventDefault();
        // پیدا کردن رقم قبلی و حذف آن
        const before = val.slice(0, cursor);
        const lastDigitIndex = before.search(/\d(?=[^\d]*$)/);
        if (lastDigitIndex !== -1) {
          const newClean = (val.slice(0, lastDigitIndex) + val.slice(lastDigitIndex + 1))
            .replace(/\D/g, '')
            .slice(0, 16);
          onChange(newClean);
        }
      }
    }
  };

  const hasValue = rawDigits.length > 0;
  const isComplete = rawDigits.length === 16;
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
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all duration-200 ${bankInfo.color}`}
            >
              <CreditCard size={12} className="shrink-0" />
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
        <div className="flex items-center pr-3 pl-1 text-slate-400 dark:text-slate-500">
          <CreditCard size={16} />
        </div>

        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="cc-number"
          dir="ltr"
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={readOnly}
          value={displayFormatted}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`w-full py-2 pl-3 pr-1 text-xs md:text-sm font-mono tracking-widest font-bold bg-transparent text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:tracking-normal outline-none text-left ${inputClassName}`}
        />

        {hasValue && (
          <div className="pl-3 flex items-center shrink-0">
            {isComplete && isValid && (
              <span title="شماره کارت معتبر است" className="text-emerald-500">
                <Check size={16} className="stroke-[2.5]" />
              </span>
            )}
            {isComplete && !isValid && (
              <span title={validation?.error || 'رقم کنترلی نامعتبر است'} className="text-amber-500">
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
