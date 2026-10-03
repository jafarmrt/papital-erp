import React, { useId, useMemo, useRef } from 'react';
import { CreditCard } from 'lucide-react';
import {
  normalizeBankCard,
  formatBankCard,
  getIranianBankFromCard,
  validateBankCardNumber,
  toEnglishDigits
} from '../../utils';
import {
  GroupedDigitsField,
  digitsAfterSeparatorBackspace,
  digitsBeforeCaret,
  restoreCaretAfterDigits,
  type GroupedDigitsInputProps,
} from './groupedDigitsField';

export type BankCardInputProps = GroupedDigitsInputProps;

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
  const validation = useMemo(() => (rawDigits ? validateBankCardNumber(rawDigits) : null), [rawDigits]);
  // فرمت نمایشی ۱۶ رقمی در کادر ورودی
  const displayFormatted = useMemo(() => formatBankCard(rawDigits, ' - '), [rawDigits]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsBefore = digitsBeforeCaret(e.target);
    const newCleanDigits = toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 16);
    onChange(newCleanDigits);
    restoreCaretAfterDigits(inputRef, formatBankCard(newCleanDigits, ' - '), digitsBefore, newCleanDigits.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // جلوگیری از گیر کردن در خط تیره‌ها هنگام فشردن Backspace
    const digits = digitsAfterSeparatorBackspace(e, inputRef.current, ' -', 16);
    if (digits !== null) onChange(digits);
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
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all duration-200 ${bankInfo.color}`}
        >
          <CreditCard size={12} className="shrink-0" />
          <span>{bankInfo.name}</span>
        </span>
      ) : null}
      prefix={(
        <div className="flex items-center pr-3 pl-1 text-slate-400 dark:text-slate-500">
          <CreditCard size={16} />
        </div>
      )}
      hasValue={rawDigits.length > 0}
      isComplete={rawDigits.length === 16}
      isValid={validation?.isValid ?? false}
      validationError={validation?.error}
      validTitle="شماره کارت معتبر است"
      invalidTitle="رقم کنترلی نامعتبر است"
      showValidationHint={showValidationHint}
    >
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
    </GroupedDigitsField>
  );
};
