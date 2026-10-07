import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { toEnglishDigits } from '../../utils';

/**
 * v7.0.140: بخش مشترک ورودی‌های عددی گروه‌بندی‌شده (کارت بانکی و شبا) — پیش‌تر در BankCardInput و ShebaInput تکرار شده بود.
 * شامل: ویژگی‌های مشترک، حفظ مکان‌نما پس از گروه‌بندی، Backspace روی جداکننده، رنگ کادر و چیدمان برچسب/نشان بانک/وضعیت.
 */
export interface GroupedDigitsInputProps {
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

/** تعداد رقم‌های پیش از مکان‌نما (ارقام فارسی هم شمرده می‌شوند) */
export function digitsBeforeCaret(input: HTMLInputElement): number {
  const caret = input.selectionStart || 0;
  return toEnglishDigits(input.value.slice(0, caret)).replace(/\D/g, '').length;
}

/** پس از گروه‌بندی تازه، مکان‌نما را دوباره پس از همان تعداد رقم می‌گذارد (در رندر بعدی) */
export function restoreCaretAfterDigits(
  inputRef: React.RefObject<HTMLInputElement | null>,
  formatted: string,
  digitsBefore: number,
  totalDigits: number
): void {
  requestAnimationFrame(() => {
    if (!inputRef.current) return;
    let caret = 0;
    let count = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) count++;
      if (count === digitsBefore) {
        caret = i + 1;
        break;
      }
    }
    if (digitsBefore === 0) caret = 0;
    if (digitsBefore >= totalDigits) caret = formatted.length;
    inputRef.current.setSelectionRange(caret, caret);
  });
}

/**
 * Backspace درست پس از جداکننده: به‌جای گیر کردن روی جداکننده، رقم قبلی را حذف می‌کند.
 * رقم‌های تازه (حداکثر maxDigits) و شمار رقم‌های پیش از مکان‌نما را برمی‌گرداند؛ null یعنی رویداد به حالت عادی رها شود.
 * v9.0.299 (TD-682، B16-18): فراخواننده مکان‌نما را با `caretDigits` سر جای رقم حذف‌شده برمی‌گرداند؛ پیش‌تر به آخر کادر می‌رفت.
 */
export function digitsAfterSeparatorBackspace(
  e: React.KeyboardEvent<HTMLInputElement>,
  input: HTMLInputElement | null,
  separators: string,
  maxDigits: number
): { digits: string; caretDigits: number } | null {
  if (e.key !== 'Backspace' || !input) return null;
  const caret = input.selectionStart || 0;
  const val = input.value;
  if (caret === 0 || !separators.includes(val[caret - 1])) return null;
  e.preventDefault();
  const lastDigitIndex = val.slice(0, caret).search(/\d(?=[^\d]*$)/);
  if (lastDigitIndex === -1) return null;
  const digits = (val.slice(0, lastDigitIndex) + val.slice(lastDigitIndex + 1)).replace(/\D/g, '').slice(0, maxDigits);
  return { digits, caretDigits: val.slice(0, lastDigitIndex).replace(/\D/g, '').length };
}

interface GroupedDigitsFieldProps {
  inputId: string;
  label?: string;
  required: boolean;
  className: string;
  disabled: boolean;
  /** نشان بانک (یا null) */
  badge: React.ReactNode;
  /** آیکن یا پیشوند سمت راست کادر */
  prefix: React.ReactNode;
  hasValue: boolean;
  isComplete: boolean;
  isValid: boolean;
  validationError?: string;
  validTitle: string;
  invalidTitle: string;
  showValidationHint: boolean;
  /** خود عنصر input */
  children: React.ReactNode;
}

/** چیدمان مشترک: برچسب و نشان بانک، کادر با رنگ وضعیت، آیکن معتبر/نامعتبر و پیام خطا */
export const GroupedDigitsField: React.FC<GroupedDigitsFieldProps> = ({
  inputId, label, required, className, disabled, badge, prefix,
  hasValue, isComplete, isValid, validationError, validTitle, invalidTitle, showValidationHint, children,
}) => {
  let borderClasses = 'border-slate-200 dark:border-slate-700 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30';
  if (hasValue && isComplete) {
    borderClasses = isValid
      ? 'border-emerald-500/80 ring-2 ring-emerald-100 dark:ring-emerald-950/40 focus-within:border-emerald-600'
      : 'border-amber-500/80 ring-2 ring-amber-100 dark:ring-amber-950/40 focus-within:border-amber-600';
  }

  return (
    <div className={`flex flex-col gap-1 text-right ${className}`}>
      {(label || badge) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <label htmlFor={inputId} className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <span>{label}</span>
              {required && <span className="text-rose-500">*</span>}
            </label>
          )}
          {badge}
        </div>
      )}

      <div
        className={`relative flex items-center bg-white dark:bg-slate-800 border rounded-xl transition-all duration-150 ${borderClasses} ${
          disabled ? 'opacity-60 bg-slate-50 dark:bg-slate-900 cursor-not-allowed' : ''
        }`}
      >
        {prefix}
        {children}
        {hasValue && (
          <div className="pl-3 flex items-center shrink-0">
            {isComplete && isValid && (
              <span title={validTitle} className="text-emerald-500">
                <Check size={16} className="stroke-[2.5]" />
              </span>
            )}
            {isComplete && !isValid && (
              <span title={validationError || invalidTitle} className="text-amber-500">
                <AlertCircle size={16} />
              </span>
            )}
          </div>
        )}
      </div>

      {showValidationHint && hasValue && !isValid && isComplete && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
          {validationError}
        </p>
      )}
    </div>
  );
};
