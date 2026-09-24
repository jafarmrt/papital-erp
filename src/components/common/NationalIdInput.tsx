import React, { useId, useMemo } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import {
  toEnglishDigits,
  normalizeNationalId,
  validateIranianNationalId,
  toPersianDigits
} from '../../utils';

export interface NationalIdInputProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  showFeedback?: boolean;
  autoFocus?: boolean;
  name?: string;
  id?: string;
}

/**
 * VibeFarsi Pattern — Phase 1: NationalIdInput
 * ورودی استاندارد و هوشمند کد ملی ۱۰ رقمی با اعتبارسنجی الگوریتمی Mod 11
 * و پد خودکار صفرهای سمت چپ در onBlur بدون مسدودسازی تحمیلی فرم.
 */
export const NationalIdInput: React.FC<NationalIdInputProps> = ({
  value,
  onChange,
  onBlur,
  label = 'کد ملی',
  placeholder = '۱۰ رقم عددی',
  required = false,
  disabled = false,
  className = '',
  inputClassName = '',
  showFeedback = true,
  autoFocus = false,
  name,
  id
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  // پاک‌سازی ارقام و محاسبه وضعیت اعتبارسنجی
  const cleanDigits = useMemo(() => {
    return toEnglishDigits(value || '').replace(/\D/g, '').slice(0, 10);
  }, [value]);

  const validation = useMemo(() => {
    if (!cleanDigits) {
      return { status: 'empty' as const, message: '' };
    }
    if (cleanDigits.length < 10) {
      return {
        status: 'typing' as const,
        message: `${toPersianDigits(10 - cleanDigits.length)} رقم تا تکمیل`
      };
    }
    const res = validateIranianNationalId(cleanDigits);
    if (res.isValid) {
      return { status: 'valid' as const, message: 'کد ملی معتبر' };
    }
    return { status: 'invalid' as const, message: res.error || 'کد ملی نامعتبر است' };
  }, [cleanDigits]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 10);
    onChange(digits);
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (cleanDigits && cleanDigits.length > 0 && cleanDigits.length < 10) {
      const padded = normalizeNationalId(cleanDigits);
      onChange(padded);
    }
    if (onBlur) {
      onBlur(e);
    }
  };

  // استایل حاشیه و پس‌زمینه بر اساس وضعیت
  const statusBorderClass = useMemo(() => {
    if (!showFeedback || disabled) {
      return 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white';
    }
    if (validation.status === 'valid') {
      return 'border-emerald-500 bg-emerald-50/20 focus:border-emerald-600 focus:bg-white focus:ring-1 focus:ring-emerald-400/40 text-slate-900';
    }
    if (validation.status === 'invalid') {
      return 'border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:bg-white focus:ring-1 focus:ring-rose-400/40 text-slate-900';
    }
    return 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white';
  }, [showFeedback, disabled, validation.status]);

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
          {showFeedback && validation.status !== 'empty' && (
            <span
              className={`text-[10px] font-medium flex items-center gap-1 transition-colors ${
                validation.status === 'valid'
                  ? 'text-emerald-600 font-bold'
                  : validation.status === 'invalid'
                  ? 'text-rose-500 font-bold'
                  : 'text-slate-400'
              }`}
            >
              {validation.status === 'valid' && <Check size={11} className="stroke-[2.5]" />}
              {validation.status === 'invalid' && <AlertCircle size={11} className="stroke-[2]" />}
              {validation.message}
            </span>
          )}
        </div>
      )}

      <div className="relative">
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          maxLength={10}
          autoComplete="off"
          disabled={disabled}
          autoFocus={autoFocus}
          value={value}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          dir="ltr"
          className={`w-full px-3 py-2 border rounded-xl text-xs font-bold font-mono tracking-widest text-left outline-none transition-all ${statusBorderClass} ${inputClassName}`}
        />

        {showFeedback && validation.status === 'valid' && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none">
            <Check size={14} className="stroke-[3]" />
          </div>
        )}
      </div>
    </div>
  );
};
