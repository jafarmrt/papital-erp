import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { PARTIAL_DECIMAL_MESSAGE, decimalTextMatches, decimalTextOf, readDecimalInputText } from '../../lib/decimalInputText';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'min' | 'max' | 'step'>;

export interface DecimalInputProps extends NativeInputProps {
  value: number | string | null | undefined;
  /** متن عدد با ارقام لاتین («۱۲۵» ← «125»، «12٫5» یا «12/5» ← «12.5»)؛ خالی برای کادر خالی و برای متن نامعتبر یا نیمه‌کاره، مثل کادر قدیمی */
  onValueChange: (text: string) => void;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}

/**
 * v10.1.22 (TD-1273، قاعده فرم وایب فارسی): کادر عدد به جای `type=number`.
 * متن تایپ‌شده تا پایان ویرایش می‌ماند («12.» از دست نمی‌رود)، صفحه‌کلید عددی گوشی باز می‌شود، ارقام فارسی و «٫»
 * خوانده می‌شوند و متن نامعتبر یا بیرون از بازه زیر همان کادر پیام می‌دهد و مثل کادر قدیمی ارسال فرم را نگه می‌دارد.
 * متن نامعتبر یا نیمه‌کاره مثل کادر قدیمی مقدار خالی می‌فرستد (هرگز پیشوند معتبر پیشین را نگه نمی‌دارد) و تا اصلاح روی کادر
 * می‌ماند؛ دکمه‌های «افزودن ردیف» که فرم را ارسال نمی‌کنند با `refuseInvalidDecimalInputs` آن را رد می‌کنند.
 */
export function DecimalInput({ value, onValueChange, min, max, step, className, dir = 'ltr', id, ...rest }: DecimalInputProps) {
  const [text, setText] = useState(() => decimalTextOf(value));
  const [error, setError] = useState<string | undefined>();
  const [partial, setPartial] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousValue = useRef(value);
  const ownChange = useRef(false);
  const autoId = useId();
  const errorId = `${id ?? autoId}-error`;

  // مثل کادر کنترل‌شدهٔ قدیمی، متن معتبری که با مقدار بیرونی نمی‌خواند (بارگذاری، «خالی یعنی ۱») جای خود را به آن مقدار
  // می‌دهد؛ متن نامعتبر یا نیمه‌کاره تنها با تغییر مقدار از بیرون (پاک‌کردن فرم پس از افزودن ردیف) جای خود را می‌دهد، نه با
  // مقدار خالی‌ای که خود کادر فرستاده است
  useEffect(() => {
    const external = !Object.is(previousValue.current, value) && !ownChange.current;
    previousValue.current = value;
    ownChange.current = false;
    const valid = readDecimalInputText(text, { min, max, step }).kind === 'value';
    if (valid ? decimalTextMatches(text, value) : !external) return;
    setText(decimalTextOf(value));
    setError(undefined);
    setPartial(false);
  }, [text, value, min, max, step]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? (partial ? PARTIAL_DECIMAL_MESSAGE : ''));
  }, [error, partial]);

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
        data-decimal-input=""
        onChange={e => {
          const raw = e.target.value;
          setText(raw);
          ownChange.current = true;
          const read = readDecimalInputText(raw, { min, max, step });
          setPartial(read.kind === 'partial');
          setError(read.kind === 'invalid' ? read.error : read.kind === 'value' ? read.rangeError : undefined);
          onValueChange(read.kind === 'value' ? read.text : '');
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : rest['aria-describedby']}
        className={className}
      />
      {error && <p id={errorId} role="alert" className="mt-1 text-[11px] font-bold text-rose-600">{error}</p>}
    </>
  );
}

/**
 * دکمه‌ای که فرم را ارسال نمی‌کند (مثل «افزودن ردیف») اعتبار کادرهای عدد ناحیهٔ خود (`data-decimal-scope`) را نمی‌بیند؛
 * اگر کادری نامعتبر یا نیمه‌کاره باشد پیامش را نشان می‌دهد، آن را برمی‌گزیند و true برمی‌گرداند تا کار انجام نشود.
 */
export function refuseInvalidDecimalInputs(from: Element | null): boolean {
  const scope = from?.closest('[data-decimal-scope]');
  if (!scope) return false;
  const invalid = Array.from(scope.querySelectorAll<HTMLInputElement>('input[data-decimal-input]')).find(input => !input.validity.valid);
  if (!invalid) return false;
  invalid.reportValidity();
  invalid.focus();
  return true;
}
