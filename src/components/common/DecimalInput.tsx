import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { decimalTextMatches, decimalTextOf, readDecimalInputText } from '../../lib/decimalInputText';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'min' | 'max' | 'step'>;

export interface DecimalInputProps extends NativeInputProps {
  value: number | string | null | undefined;
  /** متن عدد با ارقام لاتین («۱۲۵» ← «125»، «12٫5» ← «12.5»)، خالی برای کادر خالی؛ متن نامعتبر فراخوانی نمی‌شود */
  onValueChange: (text: string) => void;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}

/**
 * v10.1.20 (TD-1273، قاعده فرم وایب فارسی): کادر عدد به جای `type=number`.
 * متن تایپ‌شده تا پایان ویرایش می‌ماند («12.» از دست نمی‌رود)، صفحه‌کلید عددی گوشی باز می‌شود، ارقام فارسی و «٫»
 * خوانده می‌شوند و متن نامعتبر یا بیرون از بازه زیر همان کادر پیام می‌دهد و مثل کادر قدیمی ارسال فرم را نگه می‌دارد.
 * متن نامعتبر مقدار پیشین را نگه می‌دارد و هرگز صفر نمی‌شود.
 */
export function DecimalInput({ value, onValueChange, min, max, step, className, dir = 'ltr', id, ...rest }: DecimalInputProps) {
  const [text, setText] = useState(() => decimalTextOf(value));
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const errorId = `${id ?? autoId}-error`;

  // مثل کادر کنترل‌شدهٔ قدیمی، متن معتبری که با مقدار بیرونی نمی‌خواند (بارگذاری، پاک‌کردن فرم، «خالی یعنی ۱») جای خود
  // را به آن مقدار می‌دهد؛ متن نامعتبر یا نیمه‌کاره می‌ماند تا کاربر اصلاحش کند
  useEffect(() => {
    if (readDecimalInputText(text, { min, max, step }).kind !== 'value' || decimalTextMatches(text, value)) return;
    setText(decimalTextOf(value));
    setError(undefined);
  }, [text, value, min, max, step]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? '');
  }, [error]);

  return (
    <>
      <input
        {...rest}
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        dir={dir}
        value={text}
        onChange={e => {
          const raw = e.target.value;
          setText(raw);
          const read = readDecimalInputText(raw, { min, max, step });
          if (read.kind === 'invalid') {
            setError(read.error);
            return;
          }
          if (read.kind === 'partial') {
            setError(undefined);
            return;
          }
          setError(read.rangeError);
          onValueChange(read.text);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : rest['aria-describedby']}
        className={className}
      />
      {error && <p id={errorId} role="alert" className="mt-1 text-[11px] font-bold text-rose-600">{error}</p>}
    </>
  );
}
