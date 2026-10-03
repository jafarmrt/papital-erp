import React, { useId, useMemo, useRef } from 'react';
import { Building2 } from 'lucide-react';
import {
  normalizeSheba,
  getIranianBankFromSheba,
  validateIranianSheba,
  toEnglishDigits
} from '../../utils';
import {
  GroupedDigitsField,
  digitsAfterSeparatorBackspace,
  digitsBeforeCaret,
  restoreCaretAfterDigits,
  type GroupedDigitsInputProps,
} from './groupedDigitsField';

export type ShebaInputProps = GroupedDigitsInputProps;

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
    parts.push(clean.substring(idx, Math.min(idx + 4, clean.length)));
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
  const numericDigits = useMemo(
    () => (fullCanonicalSheba.startsWith('IR') ? fullCanonicalSheba.slice(2) : ''),
    [fullCanonicalSheba]
  );
  // اطلاعات بانک صادرکننده شبا
  const bankInfo = useMemo(() => getIranianBankFromSheba(fullCanonicalSheba), [fullCanonicalSheba]);
  // اعتبارسنجی ISO 7064 Mod 97-10
  const validation = useMemo(() => (fullCanonicalSheba ? validateIranianSheba(fullCanonicalSheba) : null), [fullCanonicalSheba]);
  // فرمت نمایشی ۲۴ رقم
  const displayFormatted = useMemo(() => formatShebaDigits(numericDigits), [numericDigits]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsBefore = digitsBeforeCaret(e.target);
    // پاکسازی ورودی کاربر و تبدیل ارقام فارسی به لاتین؛ IR تایپ یا پیست‌شده جدا می‌شود
    let raw = toEnglishDigits(e.target.value).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (raw.startsWith('IR')) raw = raw.slice(2);
    const cleanDigits = raw.replace(/\D/g, '').slice(0, 24);
    // شماره شبای استاندارد با پیشوند IR برای ارسال به والد
    onChange(cleanDigits.length > 0 ? `IR${cleanDigits}` : '');
    restoreCaretAfterDigits(inputRef, formatShebaDigits(cleanDigits), digitsBefore, cleanDigits.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const digits = digitsAfterSeparatorBackspace(e, inputRef.current, ' ', 24);
    if (digits !== null) onChange(digits ? `IR${digits}` : '');
  };

  return (
    <GroupedDigitsField
      inputId={inputId}
      label={label}
      required={required}
      className={className}
      disabled={disabled}
      badge={showBankBadge && bankInfo ? (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300 transition-all duration-200"
        >
          <Building2 size={12} className="shrink-0" />
          <span>{bankInfo.name}</span>
        </span>
      ) : null}
      prefix={(
        /* پیشوند ثابت و استاندارد IR */
        <div className="flex items-center gap-1 px-2.5 py-2 bg-slate-100 dark:bg-slate-700/60 border-l border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-mono font-black text-xs md:text-sm select-none rounded-r-[11px]">
          <span>IR</span>
        </div>
      )}
      hasValue={numericDigits.length > 0}
      isComplete={numericDigits.length === 24}
      isValid={validation?.isValid ?? false}
      validationError={validation?.error}
      validTitle="شماره شبا معتبر است (تایید ISO 7064)"
      invalidTitle="رقم‌های کنترلی شبا نامعتبر است"
      showValidationHint={showValidationHint}
    >
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
    </GroupedDigitsField>
  );
};
