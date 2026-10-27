import { useEffect, useEffectEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf, getTodayJalaliDate } from '../../utils';
import { toPersianDigits } from '../../utils/persianNumber';
import { normalizeDecimalString, toLatinDigits } from '../../lib/numericInput';
import { EIDI_METHODS, EIDI_METHOD_LABELS, eidiRatesError, type EidiMethod } from '../../lib/payroll/eidi';
import { putPayrollRateRow, useEidiRatesQuery } from '../../hooks/queries/usePieceworkQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import { useSeededForm } from '../../hooks/useSeededForm';
import { invalidateDomain } from '../../lib/queryInvalidation';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { RIAL_INPUT_UNIT, RialEquivalent } from '../common/RialEquivalent';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸، ت۱۴ تا ت۱۶ الف): روش و نرخ عیدی هر سال جلالی، کنار نرخ‌های بیمه و مالیات. هیچ نرخ
 * پیش‌فرضی نیست؛ ذخیره `payroll.rates_manage` می‌خواهد.
 * 10.3 (ARCH review finding 3, part 13): read through the shared cache like the statutory rates beside it, the form
 * waiting for the first read and filled from the saved row after a save.
 */

interface EidiRatesView {
  jalaliYear: number;
  method: EidiMethod;
  percent: string;
  yearlyCap: string;
  laborDays: string;
  laborCapDays: string;
  minDailyWage: string;
  fixedAmount: string;
  version: number;
}

type NumberKey = 'percent' | 'yearlyCap' | 'laborDays' | 'laborCapDays' | 'minDailyWage' | 'fixedAmount';
type FormState = Record<NumberKey, string> & { method: EidiMethod; version?: number };

const NO_YEARS: EidiRatesView[] = [];
const EMPTY_FORM: FormState = { method: 'percent_of_work', percent: '', yearlyCap: '', laborDays: '', laborCapDays: '', minDailyWage: '', fixedAmount: '' };
const inputClass = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono';
const clean = (v: string) => normalizeDecimalString(v) || '0';

const FIELDS: Record<EidiMethod, Array<{ key: NumberKey; label: string }>> = {
  percent_of_work: [{ key: 'percent', label: 'درصد عیدی از کارکرد و حقوق ثابت هر فیش' }, { key: 'yearlyCap', label: 'سقف سالانه عیدی هر نفر (ریال)' }],
  labor_law: [
    { key: 'laborDays', label: 'روزهای مزد عیدی' },
    { key: 'laborCapDays', label: 'روزهای سقف به حداقل مزد' },
    { key: 'minDailyWage', label: 'حداقل مزد روزانه سال (ریال)' },
  ],
  fixed_amount: [{ key: 'fixedAmount', label: 'مبلغ عیدی سال برای یک سال کامل (ریال)' }],
};

const HELP: Record<EidiMethod, string> = {
  percent_of_work: 'هر فیش حقوق سهم عیدی خود را با تأیید فیش در «عیدی پرداختنی» انباشته می‌کند تا جمع سال به سقف برسد؛ پاداش و کسورات در پایه نیست.',
  labor_law: 'عیدی هر نفر کمینه «روزهای مزد × حقوق ماهانه ÷ ۳۰» و «روزهای سقف × حداقل مزد روزانه» است، به نسبت روزهای همکاری در سال.',
  fixed_amount: 'هر نفر این مبلغ را به نسبت روزهای همکاری در سال می‌گیرد.',
};

function formOf(view: EidiRatesView | undefined): FormState {
  return view ? { ...view } : EMPTY_FORM;
}

export function PayrollEidiRatesSection() {
  const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
  const queryClient = useQueryClient();
  const read = useOpeningRead(useEidiRatesQuery<EidiRatesView>(), true);
  const years = read.data ?? NO_YEARS;
  const [year, setYear] = useState<number>(thisYear);
  const { form, edit: setForm, refill } = useSeededForm(years.find(r => r.jalaliYear === year), formOf);
  const [saving, setSaving] = useState(false);
  const ready = read.data !== undefined || read.failedAt > 0;
  const sayFailed = useEffectEvent(() => { toast.error(errorMessageOf(read.error)); });
  useEffect(() => {
    if (read.failedAt) sayFailed();
  }, [read.failedAt]);

  const pickYear = (y: number) => {
    setYear(y);
    refill();
  };

  const body = {
    method: form.method,
    percent: clean(form.percent),
    yearlyCap: clean(form.yearlyCap),
    laborDays: clean(form.laborDays),
    laborCapDays: clean(form.laborCapDays),
    minDailyWage: clean(form.minDailyWage),
    fixedAmount: clean(form.fixedAmount),
    ...(form.version !== undefined ? { version: form.version } : {}),
  };
  const formError = eidiRatesError({ jalaliYear: year, ...body });

  const save = async () => {
    if (formError) { toast.error(formError); return; }
    setSaving(true);
    try {
      const saved = await fetchJson<EidiRatesView>(`/piecework/eidi-rates/${year}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast.success(`روش عیدی سال ${toPersianDigits(String(year))} ذخیره شد`);
      await putPayrollRateRow(queryClient, QUERY_KEYS.piecework.eidiRates(), saved);
      refill();
      await invalidateDomain(queryClient, 'piecework');
    } catch (err) {
      toast.error(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const yearOptions = [...new Set([thisYear - 1, thisYear, thisYear + 1, ...years.map(r => r.jalaliYear)])].sort((a, b) => b - a);

  return (
    <div className="space-y-4 pt-6 mt-6 border-t border-slate-200">
      <div className="flex items-center gap-2">
        <Gift className="w-5 h-5 text-emerald-600" />
        <h3 className="text-sm font-black text-slate-900">عیدی و پاداش سالانه</h3>
      </div>
      <fieldset disabled={!ready} className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-slate-700" htmlFor="eidi-year">سال جلالی</label>
          <select id="eidi-year" value={year} onChange={(e) => pickYear(Number(e.target.value))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold">
            {yearOptions.map(y => (
              <option key={y} value={y}>{toPersianDigits(String(y))}{years.some(r => r.jalaliYear === y) ? '' : ' (ثبت نشده)'}</option>
            ))}
          </select>
          <label className="text-xs font-bold text-slate-700" htmlFor="eidi-method">روش</label>
          <select id="eidi-method" value={form.method} onChange={(e) => setForm(p => ({ ...p, method: e.target.value as EidiMethod }))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold">
            {EIDI_METHODS.map(m => <option key={m} value={m}>{EIDI_METHOD_LABELS[m]}</option>)}
          </select>
        </div>
        <p className="text-xs text-slate-600 leading-6">{HELP[form.method]}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FIELDS[form.method].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor={`eidi-${f.key}`}>{f.label}</label>
              <input id={`eidi-${f.key}`} inputMode="decimal" value={form[f.key]} onChange={(e) => setForm(p => ({ ...p, [f.key]: e.target.value }))} className={inputClass} />
              {f.label.endsWith(`(${RIAL_INPUT_UNIT})`) && <RialEquivalent value={form[f.key]} />}
            </div>
          ))}
        </div>
        {formError && <p className="text-[11px] font-bold text-rose-700">{formError}</p>}
        <div className="flex justify-end">
          <button type="button" onClick={() => void save()} disabled={saving || !!formError}
            className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs disabled:opacity-50 cursor-pointer">
            {saving ? 'در حال ذخیره...' : `ذخیره روش عیدی سال ${toPersianDigits(String(year))}`}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
