import { useEffect, useState } from 'react';
import { readDecimalText } from '../../lib/procurement/procurementNumbers';

interface RequisitionDecimalInputProps {
  value: number;
  onChange: (value: number) => void;
  /** حداکثر رقم اعشار */
  scale: number;
  /** نام فیلد در پیام خطا («مقدار»، «برآورد قیمت») */
  noun: string;
  ariaLabel: string;
  placeholder?: string;
  className: string;
  /** پیام خطای فرم یا سرور برای همین فیلد */
  externalError?: string;
  errorId: string;
}

/**
 * OBS-R2-39 (TD-992): کادر عدد فرم درخواست خرید؛ متن خام تا پایان ویرایش می‌ماند («1.» از دست نمی‌رود)، ارقام فارسی و
 * «٫» خوانده می‌شوند و متن نامعتبر زیر همان کادر پیام می‌دهد و مقدار پیشین را نگه می‌دارد.
 */
export function RequisitionDecimalInput({ value, onChange, scale, noun, ariaLabel, placeholder, className, externalError, errorId }: RequisitionDecimalInputProps) {
  const [text, setText] = useState(value === 0 ? '' : String(value));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    setText(current => {
      const read = readDecimalText(current, scale, noun);
      return read.ok && read.value === value ? current : (value === 0 ? '' : String(value));
    });
  }, [value, scale, noun]);
  const shownError = error ?? externalError;
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        onChange={e => {
          const raw = e.target.value;
          setText(raw);
          const read = readDecimalText(raw, scale, noun);
          if (read.ok) {
            setError(undefined);
            onChange(read.value);
          } else {
            setError(read.error);
          }
        }}
        placeholder={placeholder}
        aria-invalid={Boolean(shownError)}
        aria-describedby={shownError ? errorId : undefined}
        className={className}
        dir="ltr"
      />
      {shownError && <p id={errorId} role="alert" className="mt-1 text-[11px] font-bold text-rose-600">{shownError}</p>}
    </>
  );
}
