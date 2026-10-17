import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type InputHTMLAttributes } from 'react';
import {
  PARTIAL_DECIMAL_MESSAGE, decimalDisplayText, decimalTextIsRebuilt, decimalTextMatches, decimalTextOf, readDecimalInputText
} from '../../lib/decimalInputText';
import {
  caretAfterSignificant, editWithoutFieldSeparators, significantCharsBefore, stepOverGroupSeparator
} from '../../lib/numberFieldDisplay';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'min' | 'max' | 'step'>;

export interface DecimalInputProps extends NativeInputProps {
  value: number | string | null | undefined;
  /** متن عدد با ارقام لاتین («۱۲۵» ← «125»، «12٫5» یا «12/5» ← «12.5»)؛ خالی برای کادر خالی و برای متن نامعتبر یا نیمه‌کاره، مثل کادر قدیمی */
  onValueChange: (text: string) => void;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  /**
   * v10.1.72 (TD-1288): «٬» میان دسته‌های سه‌رقمی هنگام تایپ (پیش‌فرض)؛ کادری که شناسه می‌گیرد (مثل شماره سفارش) false
   * می‌دهد. ارقام در هر حال فارسی دیده می‌شوند.
   */
  grouped?: boolean;
}

/**
 * v10.1.22 (TD-1273، قاعده فرم وایب فارسی): کادر عدد به جای `type=number`.
 * v10.1.72 (TD-1288): کادر با ارقام فارسی، «٫» و «٬» میان دسته‌های سه‌رقمی دیده می‌شود (`grouped`، پیش‌فرض)، با هر صفحه‌کلید.
 * متن تایپ‌شده تا پایان ویرایش می‌ماند («12.» از دست نمی‌رود)، صفحه‌کلید عددی گوشی باز می‌شود، ارقام فارسی و «٫»
 * خوانده می‌شوند و متن نامعتبر یا بیرون از بازه زیر همان کادر پیام می‌دهد و مثل کادر قدیمی ارسال فرم را نگه می‌دارد.
 * متن نامعتبر یا نیمه‌کاره مثل کادر قدیمی مقدار خالی می‌فرستد (هرگز پیشوند معتبر پیشین را نگه نمی‌دارد) و تا اصلاح روی کادر
 * می‌ماند؛ دکمه‌های «افزودن ردیف» که فرم را ارسال نمی‌کنند با `refuseInvalidDecimalInputs` آن را رد می‌کنند.
 */
export function DecimalInput({ value, onValueChange, min, max, step, grouped = true, className, dir = 'ltr', id, onKeyDown, ...rest }: DecimalInputProps) {
  const [text, setText] = useState(() => decimalTextOf(value));
  const [error, setError] = useState<string | undefined>();
  const [partial, setPartial] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousValue = useRef(value);
  const ownChange = useRef(false);
  /**
   * جای مکان‌نما پس از آخرین تایپ: در متنی که کادر از نو می‌سازد شمار نویسه‌های معنادار پیش از آن، و در متنی که همان‌طور
   * که تایپ شده دیده می‌شود (هر نویسه سر جای خود) جای آن در همان متن
   */
  const pendingCaret = useRef<{ significant: number } | { index: number } | null>(null);
  // تایپی که متن کادر را دگرگون نمی‌کند (پاک‌کردن «٬» خود کادر) هم باید کادر را بسازد تا مکان‌نما سر جای خود بماند
  const [, rerender] = useReducer((n: number) => n + 1, 0);
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

  const shown = decimalDisplayText(text, grouped);

  // v10.1.72 (TD-1288): متن نمایشی (ارقام فارسی و «٬») با متن تایپ‌شده یک‌اندازه نیست؛ مکان‌نما پس از همان رقم می‌ماند،
  // و پس از «٬»ی که کاربر زده است، نه پیش از آن
  useLayoutEffect(() => {
    const input = inputRef.current;
    const pending = pendingCaret.current;
    pendingCaret.current = null;
    if (!input || pending === null || input.ownerDocument.activeElement !== input) return;
    // React کادری را که مقدارش دگرگون نشده دوباره نمی‌نویسد؛ متن نمایشی پیش از نهادن مکان‌نما برمی‌گردد
    if (input.value !== shown) input.value = shown;
    const caret = 'index' in pending ? Math.min(pending.index, input.value.length) : caretAfterSignificant(input.value, pending.significant);
    input.setSelectionRange(caret, caret);
  });

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
        value={shown}
        data-decimal-input=""
        onKeyDown={e => {
          // فقط از روی «٬» خود کادر می‌پرد؛ در متنی که همان‌طور که تایپ شده دیده می‌شود هر «٬» از کاربر است و Backspace آن را پاک می‌کند
          if (grouped && decimalTextIsRebuilt(text)) stepOverGroupSeparator(e.currentTarget, e.key);
          onKeyDown?.(e);
        }}
        onChange={e => {
          const typed = e.target.value;
          const caret = e.target.selectionStart ?? typed.length;
          // فقط «٬»هایی که خود کادر گذاشته بود برداشته می‌شوند؛ «٬» تایپ‌شده می‌ماند و خطاست («۱۲٬۵» صد و بیست و پنج نمی‌شود)
          const edit = grouped && decimalTextIsRebuilt(text) ? editWithoutFieldSeparators(shown, typed, caret) : { text: typed, caret };
          const read = readDecimalInputText(edit.text, { min, max, step });
          // عدد پذیرفته بی جداکننده نگه داشته می‌شود، پس هر «٬»ی که از این پس دیده می‌شود از خود کادر است
          const next = read.kind === 'value' ? read.text : edit.text;
          pendingCaret.current = decimalTextIsRebuilt(next) ? { significant: significantCharsBefore(typed, caret) } : { index: edit.caret };
          setText(next);
          rerender();
          ownChange.current = true;
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
