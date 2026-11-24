import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  FORM_CONSENT_LABEL_MAX, FORM_FIELD_HELP_MAX, FORM_FIELD_LABEL_MAX, FORM_OPTIONS_MAX, FORM_OPTIONS_MIN, FORM_OPTION_MAX, hasOptions, type FormField,
} from '../../../lib/storefront/storefrontFormRules';
import { formatPersianNumber } from '../../../utils/persianNumber';

/**
 * v12 phase 10f: what one field of a form of the site takes: its name (for a tick of acceptance, the sentence beside
 * the tick), whether it must be filled in, a line of guidance, and for the two kinds of choice their options.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';

/** how the site takes each kind, said under the field's name */
const KIND_HINTS: Readonly<Record<FormField['kind'], string>> = {
  shortText: 'یک خط متن.',
  longText: 'چند خط متن.',
  mobile: 'شمارهٔ همراه، مانند ۰۹۱۲۳۴۵۶۷۸۹.',
  email: 'نشانی ایمیل.',
  number: 'فقط عدد.',
  choice: 'بازدیدکننده یکی از گزینه‌ها را برمی‌گزیند.',
  choices: 'بازدیدکننده هر چند گزینه که بخواهد برمی‌گزیند.',
  date: 'یک روز از تقویم.',
  consent: 'یک تیک با جمله‌ای کنارش، مانند پذیرفتن قوانین.',
};

export function FormFieldCard({ value, name, disabled, onChange }: { value: FormField; /** «فیلد ۲» */ name: string; disabled: boolean; onChange: (next: FormField) => void }) {
  const id = useId();
  const consent = value.kind === 'consent';
  const options = Array.isArray(value.options) ? value.options : [];
  const setOption = (index: number, text: string) => onChange({ ...value, options: options.map((option, i) => (i === index ? text : option)) });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-label`} className={label}>{consent ? 'جملهٔ کنار تیک' : 'عنوان فیلد'}</label>
          <input id={`${id}-label`} className={field} maxLength={consent ? FORM_CONSENT_LABEL_MAX : FORM_FIELD_LABEL_MAX} value={value.label} onChange={e => onChange({ ...value, label: e.target.value })} />
          <p className={hint}>{KIND_HINTS[value.kind]}</p>
        </div>
        <div>
          <label htmlFor={`${id}-help`} className={label}>راهنما (اختیاری)</label>
          <input id={`${id}-help`} className={field} maxLength={FORM_FIELD_HELP_MAX} value={value.help} onChange={e => onChange({ ...value, help: e.target.value })} />
          <p className={hint}>یک خط زیر فیلد، برای کسی که آن را پر می‌کند.</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
        <input type="checkbox" checked={value.required} onChange={e => onChange({ ...value, required: e.target.checked })} />
        {consent ? 'بی این تیک فرم فرستاده نشود' : 'پر کردن این فیلد اجباری باشد'}
      </label>
      {hasOptions(value.kind) && (
        <div role="group" aria-label={`گزینه‌های ${name}`} className="space-y-2">
          <p className={label}>گزینه‌ها</p>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input className={field} maxLength={FORM_OPTION_MAX} value={option} aria-label={`گزینهٔ ${formatPersianNumber(index + 1)} ${name}`} onChange={e => setOption(index, e.target.value)} />
              <button type="button" disabled={disabled || options.length <= FORM_OPTIONS_MIN} aria-label={`حذف گزینهٔ ${formatPersianNumber(index + 1)} ${name}`}
                className="rounded-lg p-2 text-rose-600 hover:bg-slate-100 disabled:opacity-30" onClick={() => onChange({ ...value, options: options.filter((_, i) => i !== index) })}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" disabled={disabled || options.length >= FORM_OPTIONS_MAX} onClick={() => onChange({ ...value, options: [...options, ''] })}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-40">
            <Plus className="h-4 w-4" />
            افزودن گزینه
          </button>
          <p className={hint}>{`از ${formatPersianNumber(FORM_OPTIONS_MIN)} تا ${formatPersianNumber(FORM_OPTIONS_MAX)} گزینه.`}</p>
        </div>
      )}
    </div>
  );
}
