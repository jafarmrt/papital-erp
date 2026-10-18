import React, { useEffect, useId, useMemo, useRef, useImperativeHandle, useState } from 'react';
import { Coins, Copy, Check } from 'lucide-react';
import {
  formatCurrencyLabel,
  financialAmountToPersianWords,
  parseCleanNumber
} from '../../utils';
import { copyToClipboard } from '../../utils/clipboard';
import { currencyScale } from '../../lib/currencyScale';
import { amountTextOf, groupAmountText, readAmountText } from '../../lib/amountText';
import {
  caretAfterSignificant, editWithoutFieldSeparators, persianDigitsOf, significantCharsBefore, stepOverGroupSeparator
} from '../../lib/numberFieldDisplay';
import { groupSeparatorError } from '../../lib/decimalInputText';

export interface FinancialAmountInputProps {
  /** مقدار عددی مبلغ به واحد پولی مشخص‌شده (مثلاً ریال یا دلار) */
  value: number | string | null | undefined;
  /** تابع بازخورد تغییرات با مقدار عددی پاکسازی‌شده */
  onChange: (val: number) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** واحد پولی (پیش‌فرض IRR) */
  currency?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  containerClassName?: string;
  inputClassName?: string;
  id?: string;
  name?: string;
  /** حالت نمایش: استاندارد فرم، فشرده یا جدول سطری */
  variant?: 'standard' | 'compact' | 'table';
  /** عدم نمایش برچسب ارزی الحاقی */
  hideCurrencyAdornment?: boolean;
  /** نمایش معادل روان به حروف در زیر اینپوت */
  showWordsBadge?: boolean;
  /** نمایش معادل تومان در صورت ریالی بودن واحد پول */
  showTomanEquivalent?: boolean;
  /** امکان کپی سریع مبلغ حروفی یا عددی */
  allowCopyWords?: boolean;
  /** حداقل و حداکثر مجاز */
  min?: number;
  max?: number;
  step?: string | number;
  autoFocus?: boolean;
  /** راهنما یا هشدار سفارشی اضافی */
  helperText?: React.ReactNode;
}

/**
 * کامپوننت ارگونومیک ورودی مبالغ مالی (وایب‌فارسی - فاز ۳)
 * ویژگی‌ها:
 * - جداسازی خودکار ۳ رقمی با ارقام فارسی و «٬» (۱٬۰۰۰٬۰۰۰) در زمان تایپ زنده (v10.1.72، TD-1288)
 * - کنترل دقیق مکان‌نما (Caret Tracking) و عدم پرش کرسر هنگام درج جداکننده‌ها
 * - تبدیل همگام مبلغ به حروف سلیس فارسی (پشتیبانی تا کوادریلیون)
 * - تفکیک هوشمند ریال و تومان (نمایش معادل تومانی زیر مبلغ ریالی)
 * - بازگرداندن عدد تمیز (Clean Number) به فرم والد با حذف کامل خطای IEEE-754 و parseFloat
 * - پشتیبانی از forwardRef جهت فوکوس کیبورد در جداول و فرم‌های حسابداری
 */
export const FinancialAmountInput = React.forwardRef<HTMLInputElement, FinancialAmountInputProps>(({
  value,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  currency = 'IRR',
  label,
  placeholder = '۰',
  required = false,
  disabled = false,
  readOnly = false,
  className = '',
  containerClassName = '',
  inputClassName = '',
  id,
  name,
  variant = 'standard',
  hideCurrencyAdornment,
  showWordsBadge,
  showTomanEquivalent = true,
  allowCopyWords = true,
  min,
  max,
  step,
  autoFocus = false,
  helperText
}, ref) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const internalInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = React.useState(false);

  // هماهنگ‌سازی ref ارجاعی با المنت داخلی اینپوت
  useImperativeHandle(ref, () => internalInputRef.current!, []);

  const isTable = variant === 'table';
  const shouldShowWords = showWordsBadge ?? (!isTable && variant !== 'compact');
  const shouldHideAdornment = hideCurrencyAdornment ?? isTable;

  // پاکسازی ورودی و استخراج عدد صحیح
  const numericValue = useMemo(() => {
    return parseCleanNumber(value, 0);
  }, [value]);

  // v9.0.244 (TD-665): متن خام کادر تا پایان ویرایش جدا از عدد نگه داشته می‌شود («12.» و «12.5» از دست نمی‌روند)؛
  // اعشار مجاز از ارز می‌آید (ریال ۰، ارز ۲) و قالب از مقدار فقط وقتی ساخته می‌شود که متن با مقدار والد نخواند.
  const scale = currencyScale(currency);
  const allowNegative = min !== undefined && min < 0;
  const [draft, setDraft] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  /**
   * v10.2.3 (TD-1291): متنی که «٬» نابه‌جای کاربر را دارد («۱۲٬» یا «۱۲٬۵») همان‌طور که تایپ شده روی کادر می‌ماند و خطاست،
   * مثل کادر عدد؛ پیش‌تر کادر «٬» را دور می‌ریخت و کلید بعدی «۱۲۵» می‌ساخت. تا اصلاح آن مبلغ صفر (خالی) فرستاده می‌شود،
   * هرگز پیشوند معتبر پیشین، و ارسال فرم با پیام همان خطا نگه داشته می‌شود.
   */
  const [typedGroupText, setTypedGroupText] = useState<string | null>(null);
  const reportedValue = useRef<number | null>(null);
  const previousValue = useRef(value);
  const draftValue = draft === null ? null : readAmountText(draft, { scale, allowNegative });
  const draftMatchesValue = draftValue?.ok === true && draftValue.value === numericValue;
  const displayFormatted = typedGroupText !== null
    ? persianDigitsOf(typedGroupText)
    : draftMatchesValue && draft !== null ? groupAmountText(draft) : groupAmountText(amountTextOf(value));

  // مقداری که از بیرون می‌رسد (پاک‌کردن فرم، تراز خودکار ردیف) متن نادرست را کنار می‌زند؛ صفری که خود کادر فرستاده است نه
  useEffect(() => {
    const changed = !Object.is(previousValue.current, value);
    previousValue.current = value;
    if (!changed || typedGroupText === null || parseCleanNumber(value, 0) === reportedValue.current) return;
    setTypedGroupText(null);
    setInputError(null);
  }, [value, typedGroupText]);

  useEffect(() => {
    internalInputRef.current?.setCustomValidity(typedGroupText !== null ? inputError ?? '' : '');
  }, [typedGroupText, inputError]);

  // تبدیل مبلغ به حروف فارسی
  const wordsResult = useMemo(() => {
    if (!numericValue || numericValue === 0 || !shouldShowWords) return null;
    return financialAmountToPersianWords(numericValue, currency);
  }, [numericValue, currency, shouldShowWords]);

  const curLabel = useMemo(() => formatCurrencyLabel(currency), [currency]);
  const isRial = (currency?.toUpperCase() === 'IRR' || currency === 'ریال');

  const significantCount = (text: string) => significantCharsBefore(text, text.length);

  // v10.1.72 (TD-1288): کادر ارقام فارسی و «٬» نشان می‌دهد؛ مکان‌نما پس از همان رقمی می‌ماند که پیش از آن بود
  const placeCaret = (significantBefore: number) => {
    requestAnimationFrame(() => {
      const el = internalInputRef.current;
      if (!el) return;
      const caret = caretAfterSignificant(el.value, significantBefore);
      el.setSelectionRange(caret, caret);
    });
  };

  // متنی که همان‌طور که تایپ شده دیده می‌شود: هر نویسه سر جای خود است و مکان‌نما همان‌جا می‌ماند
  const placeCaretAt = (index: number) => {
    requestAnimationFrame(() => {
      const el = internalInputRef.current;
      if (!el) return;
      const caret = Math.min(index, el.value.length);
      el.setSelectionRange(caret, caret);
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const cursor = input.selectionStart ?? input.value.length;
    // v9.0.244 (TD-666): ورودی نامعتبر (حرف، نویسه ناآشنا، اعشار بیش از ارز) مقدار قبلی را نگه می‌دارد و پیام می‌دهد؛
    // جداکننده‌های فارسی «٬» «٫» «،»، فاصله و برچسب ارزی که از خود برنامه کپی شده پذیرفته می‌شوند.
    // v10.1.72 (TD-1288): «٬»های نمایش از خود کادرند و برداشته می‌شوند؛ «٬» تایپ‌شده جز میان دسته‌های سه‌رقمی خطاست
    // v10.2.3 (TD-1291): متن نادرستی که روی کادر مانده «٬» خود کادر ندارد؛ هر «٬» آن از کاربر است و دست نمی‌خورد
    const edit = typedGroupText !== null
      ? { text: input.value, caret: cursor }
      : editWithoutFieldSeparators(displayFormatted, input.value, cursor);
    const result = readAmountText(edit.text, { scale, allowNegative });
    if (!result.ok) {
      setInputError(result.error);
      // فقط خطای «٬» نابه‌جا روی کادر می‌ماند؛ حرف، اعشار بیش از ارز یا منفی همچنان کلید را نمی‌پذیرد (TD-666)
      if (result.error === groupSeparatorError(edit.text)) {
        setTypedGroupText(edit.text);
        setDraft(null);
        reportedValue.current = 0;
        if (numericValue !== 0) onChange(0);
        placeCaretAt(edit.caret);
        return;
      }
      placeCaret(Math.max(0, significantCount(input.value.slice(0, cursor)) - 1));
      return;
    }
    setInputError(null);
    setTypedGroupText(null);
    setDraft(result.text);
    reportedValue.current = result.value;
    onChange(result.value);
    placeCaret(Math.min(significantCount(input.value.slice(0, cursor)), result.text.length));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setDraft(null);
    if (onBlur) onBlur(e);
  };

  const handleCopyWords = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!wordsResult?.words) return;
    const textToCopy = isRial && showTomanEquivalent && wordsResult.tomanEquivalent
      ? wordsResult.fullDescription
      : wordsResult.words;
    void copyToClipboard(textToCopy).then(ok => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const baseContainerStyle = isTable
    ? `relative flex items-center ${containerClassName}`
    : `relative rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 transition-all focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent flex items-center shadow-xs ${containerClassName}`;

  const baseInputStyle = isTable
    ? `w-full text-xs tabular-nums font-bold text-left bg-transparent outline-none placeholder:text-slate-400 ${inputClassName}`
    : `w-full py-2 px-3 text-xs tabular-nums font-bold text-left bg-transparent border-0 outline-none text-slate-900 dark:text-white placeholder:text-slate-400 ${inputClassName}`;

  return (
    <div className={isTable ? className : `space-y-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            {label}
            {required && <span className="text-rose-500 mr-1">*</span>}
          </label>
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
            {curLabel}
          </span>
        </div>
      )}

      {/* Input container */}
      <div className={baseContainerStyle}>
        <input
          ref={internalInputRef}
          id={inputId}
          name={name}
          type="text"
          inputMode={scale > 0 ? 'decimal' : 'numeric'}
          aria-invalid={inputError ? true : undefined}
          data-decimal-input=""
          dir="ltr"
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          min={min}
          max={max}
          step={step}
          value={displayFormatted}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={onFocus}
          onKeyDown={e => {
            // فقط از روی «٬» خود کادر می‌پرد؛ «٬»ی که کاربر زده و روی کادر مانده با Backspace پاک می‌شود
            if (typedGroupText === null) stepOverGroupSeparator(e.currentTarget, e.key);
            onKeyDown?.(e);
          }}
          placeholder={placeholder}
          className={baseInputStyle}
        />
        {!shouldHideAdornment && (
          <div className="px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 rounded-l-lg select-none shrink-0">
            {curLabel}
          </div>
        )}
      </div>

      {/* Words Preview Badge (Persian words + Toman equivalent) */}
      {shouldShowWords && wordsResult && (
        <div className="flex items-start justify-between gap-2 p-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-950 dark:text-indigo-200 animate-fadeIn">
          <div className="flex items-start gap-1.5 flex-1 min-w-0">
            <Coins className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-5">
              <span className="font-bold text-indigo-900 dark:text-indigo-200">
                {wordsResult.words}
              </span>
              {isRial && showTomanEquivalent && wordsResult.tomanEquivalent && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  معادل: <strong className="text-emerald-700 dark:text-emerald-400">{wordsResult.tomanEquivalent}</strong>
                </div>
              )}
            </div>
          </div>
          {allowCopyWords && (
            <button
              type="button"
              onClick={handleCopyWords}
              title="کپی مبلغ به حروف"
              className="p-1 rounded text-indigo-500 hover:text-indigo-800 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition cursor-pointer shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      )}

      {inputError && (
        <div role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
          {inputError}
        </div>
      )}

      {helperText && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {helperText}
        </div>
      )}
    </div>
  );
});

FinancialAmountInput.displayName = 'FinancialAmountInput';
export default FinancialAmountInput;
