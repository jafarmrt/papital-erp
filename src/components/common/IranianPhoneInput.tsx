import React, { useId, useMemo } from 'react';
import { Check, Phone, Smartphone } from 'lucide-react';
import {
  toEnglishDigits,
  normalizePhoneNumber,
  getIranianPhoneOperatorInfo,
  toPersianDigits
} from '../../utils';

export interface IranianPhoneInputProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  showOperatorBadge?: boolean;
  showFeedback?: boolean;
  autoFocus?: boolean;
  name?: string;
  id?: string;
}

/**
 * VibeFarsi Pattern — Phase 1: IranianPhoneInput
 * ورودی هوشمند شماره تلفن همراه و ثابت ایران با:
 * - تصحیح خودکار پیشوندهای بین‌المللی (+98 و 0098)
 * - شناسایی خودکار اپراتورها (همراه اول، ایرانسل، رایتل، شاتل و تلفن‌های استانی)
 * - اعتبارسنجی ۱۱ رقمی بدون مسدودسازی تحمیلی فرم.
 */
export const IranianPhoneInput: React.FC<IranianPhoneInputProps> = ({
  value,
  onChange,
  onBlur,
  label = 'شماره تماس',
  placeholder = '۰۹۱۲۳۴۵۶۷۸۹',
  required = false,
  disabled = false,
  className = '',
  inputClassName = '',
  showOperatorBadge = true,
  showFeedback = true,
  autoFocus = false,
  name,
  id
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  // نرمال‌سازی شماره و تشخیص اپراتور
  const cleanDigits = useMemo(() => {
    return normalizePhoneNumber(value || '').slice(0, 11);
  }, [value]);

  const phoneInfo = useMemo(() => {
    return getIranianPhoneOperatorInfo(cleanDigits);
  }, [cleanDigits]);

  const validationState = useMemo(() => {
    if (!cleanDigits) {
      return { status: 'empty' as const, message: '' };
    }
    if (cleanDigits.length < 11) {
      return {
        status: 'typing' as const,
        message: `${toPersianDigits(11 - cleanDigits.length)} رقم تا تکمیل`
      };
    }
    if (phoneInfo.isValid) {
      return { status: 'valid' as const, message: phoneInfo.operatorName ? `تایید (${phoneInfo.operatorName})` : 'شماره معتبر' };
    }
    return { status: 'invalid' as const, message: phoneInfo.error || 'پیش‌شماره نامعتبر است' };
  }, [cleanDigits, phoneInfo]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = toEnglishDigits(e.target.value);
    // تصحیح پیشوندها در هنگام تایپ یا Paste
    if (raw.startsWith('+98')) raw = '0' + raw.slice(3);
    else if (raw.startsWith('0098')) raw = '0' + raw.slice(4);
    else if (raw.startsWith('98') && raw.length > 10) raw = '0' + raw.slice(2);
    else if (raw.startsWith('9') && raw.length >= 10) raw = '0' + raw;

    const digits = raw.replace(/\D/g, '').slice(0, 11);
    onChange(digits);
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (cleanDigits && cleanDigits.length === 10 && !cleanDigits.startsWith('0')) {
      onChange('0' + cleanDigits);
    }
    if (onBlur) {
      onBlur(e);
    }
  };

  // استایل حاشیه ورودی
  const statusBorderClass = useMemo(() => {
    if (!showFeedback || disabled) {
      return 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white';
    }
    if (validationState.status === 'valid') {
      return 'border-emerald-500 bg-emerald-50/20 focus:border-emerald-600 focus:bg-white focus:ring-1 focus:ring-emerald-400/40 text-slate-900';
    }
    if (validationState.status === 'invalid') {
      return 'border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:bg-white focus:ring-1 focus:ring-rose-400/40 text-slate-900';
    }
    return 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white';
  }, [showFeedback, disabled, validationState.status]);

  // بج نشانگر اپراتور
  const operatorBadge = useMemo(() => {
    if (!showOperatorBadge || !cleanDigits || cleanDigits.length < 4) return null;

    if (phoneInfo.operatorKey === 'mci') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200/80 px-1.5 py-0.5 rounded-md">
          <Smartphone size={10} className="text-sky-600" />
          همراه اول
        </span>
      );
    }
    if (phoneInfo.operatorKey === 'irancell') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-1.5 py-0.5 rounded-md">
          <Smartphone size={10} className="text-amber-600" />
          ایرانسل
        </span>
      );
    }
    if (phoneInfo.operatorKey === 'rightel') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200/80 px-1.5 py-0.5 rounded-md">
          <Smartphone size={10} className="text-purple-600" />
          رایتل
        </span>
      );
    }
    if (phoneInfo.operatorKey === 'shatel') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200/80 px-1.5 py-0.5 rounded-md">
          <Smartphone size={10} className="text-cyan-600" />
          شاتل موبایل
        </span>
      );
    }
    if (phoneInfo.type === 'landline' && phoneInfo.provinceName) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">
          <Phone size={10} className="text-slate-600" />
          ثابت {phoneInfo.provinceName}
        </span>
      );
    }
    return null;
  }, [showOperatorBadge, cleanDigits, phoneInfo]);

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
        )}
        <div className="flex items-center gap-1.5">
          {operatorBadge}
          {showFeedback && validationState.status !== 'empty' && (
            <span
              className={`text-[10px] font-medium flex items-center gap-1 transition-colors ${
                validationState.status === 'valid'
                  ? 'text-emerald-600 font-bold'
                  : validationState.status === 'invalid'
                  ? 'text-rose-500 font-bold'
                  : 'text-slate-400'
              }`}
            >
              {validationState.status === 'valid' && <Check size={11} className="stroke-[2.5]" />}
              {validationState.message}
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <input
          id={inputId}
          name={name}
          type="tel"
          inputMode="numeric"
          maxLength={11}
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

        {showFeedback && validationState.status === 'valid' && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none">
            <Check size={14} className="stroke-[3]" />
          </div>
        )}
      </div>
    </div>
  );
};
