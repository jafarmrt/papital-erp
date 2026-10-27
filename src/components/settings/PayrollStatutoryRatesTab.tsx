import { useEffect, useEffectEvent, useState, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Landmark } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf, getTodayJalaliDate } from '../../utils';
import { toPersianDigits } from '../../utils/persianNumber';
import { normalizeDecimalString, toLatinDigits } from '../../lib/numericInput';
import { statutoryRatesError, type TaxBracket } from '../../lib/payroll/statutoryDeductions';
import { putPayrollRateRow, useStatutoryRatesQuery } from '../../hooks/queries/usePieceworkQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import { useSeededForm } from '../../hooks/useSeededForm';
import { invalidateDomain } from '../../lib/queryInvalidation';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { RialEquivalent } from '../common/RialEquivalent';

/**
 * v10.0.210 (TD-1087، طرح حقوق §۳.۳ بند ۱، تصمیم ت۴ الف): «نرخ‌های بیمه و مالیات حقوق» هر سال جلالی. حسابدار اعداد را از
 * بخشنامه تأمین اجتماعی و قانون بودجه همان سال وارد می‌کند؛ هیچ نرخ پیش‌فرضی نیست. ذخیره `payroll.rates_manage` می‌خواهد.
 * 10.3 (ARCH review finding 3, part 13): the rows are read through the shared cache, again on each opening of the tab; the
 * form follows a save made elsewhere until the user edits it, and a save refreshes everything under `piecework`. The form
 * waits for the first read (or its failure), so nothing typed is sent without the version read.
 */

interface RatesView {
  jalaliYear: number;
  employeeInsurancePercent: string;
  employerInsurancePercent: string;
  insuranceWageCap: string;
  taxBrackets: TaxBracket[];
  deductInsuranceFromTax: boolean;
  version: number;
}

interface FormState {
  employeeInsurancePercent: string;
  employerInsurancePercent: string;
  insuranceWageCap: string;
  taxBrackets: Array<{ from: string; to: string; rate: string }>;
  deductInsuranceFromTax: boolean;
  version?: number;
}

const NO_YEARS: RatesView[] = [];
const EMPTY_FORM: FormState = { employeeInsurancePercent: '', employerInsurancePercent: '', insuranceWageCap: '', taxBrackets: [{ from: '0', to: '', rate: '' }], deductInsuranceFromTax: false };
const inputClass = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono';
const clean = (v: string) => normalizeDecimalString(v) || '0';

function formOf(view: RatesView | undefined): FormState {
  if (!view) return EMPTY_FORM;
  return {
    employeeInsurancePercent: view.employeeInsurancePercent,
    employerInsurancePercent: view.employerInsurancePercent,
    insuranceWageCap: view.insuranceWageCap,
    taxBrackets: view.taxBrackets.map(b => ({ from: b.from, to: b.to ?? '', rate: b.rate })),
    deductInsuranceFromTax: view.deductInsuranceFromTax,
    version: view.version,
  };
}

export function PayrollStatutoryRatesTab() {
  const fieldId = useId();
  const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
  const queryClient = useQueryClient();
  const read = useOpeningRead(useStatutoryRatesQuery<RatesView>(), true);
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

  const payload = () => ({
    employeeInsurancePercent: clean(form.employeeInsurancePercent),
    employerInsurancePercent: clean(form.employerInsurancePercent),
    insuranceWageCap: clean(form.insuranceWageCap),
    taxBrackets: form.taxBrackets.map(b => ({ from: clean(b.from), to: b.to.trim() === '' ? null : clean(b.to), rate: clean(b.rate) })),
    deductInsuranceFromTax: form.deductInsuranceFromTax,
    ...(form.version !== undefined ? { version: form.version } : {}),
  });
  const body = payload();
  const formError = statutoryRatesError({ jalaliYear: year, ...body });

  const save = async () => {
    if (formError) { toast.error(formError); return; }
    setSaving(true);
    try {
      const saved = await fetchJson<RatesView>(`/piecework/statutory-rates/${year}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast.success(`نرخ‌های سال ${toPersianDigits(String(year))} ذخیره شد`);
      await putPayrollRateRow(queryClient, QUERY_KEYS.piecework.statutoryRates(), saved);
      refill();
      await invalidateDomain(queryClient, 'piecework');
    } catch (err) {
      toast.error(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const setBracket = (i: number, key: 'from' | 'to' | 'rate', value: string) =>
    setForm(prev => ({ ...prev, taxBrackets: prev.taxBrackets.map((b, j) => (j === i ? { ...b, [key]: value } : b)) }));
  const addBracket = () => setForm(prev => {
    const last = prev.taxBrackets[prev.taxBrackets.length - 1];
    return { ...prev, taxBrackets: [...prev.taxBrackets, { from: last?.to ?? '', to: '', rate: '' }] };
  });
  const removeBracket = (i: number) => setForm(prev => ({ ...prev, taxBrackets: prev.taxBrackets.filter((_, j) => j !== i) }));
  const yearOptions = [...new Set([thisYear - 1, thisYear, thisYear + 1, ...years.map(r => r.jalaliYear)])].sort((a, b) => b - a);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Landmark className="w-5 h-5 text-indigo-600" />
        <h3 className="text-sm font-black text-slate-900">نرخ‌های بیمه و مالیات حقوق</h3>
      </div>
      <p className="text-xs text-slate-600 leading-6">
        اعداد هر سال را از بخشنامه سازمان تأمین اجتماعی و قانون بودجه همان سال وارد کنید. فیش حقوق نرخ‌های سال پایان دوره خود را می‌خواند؛
        سال بی نرخ یعنی فیش بیمه و مالیات را حساب نمی‌کند. پله‌های مالیات ماهانه‌اند و فیش کوتاه‌تر یا بلندتر از یک ماه به نسبت روزها حساب می‌شود.
      </p>

      <fieldset disabled={!ready} className="space-y-5 min-w-0">
        <div className="flex items-center gap-2">
          <label htmlFor={`${fieldId}-year`} className="text-xs font-bold text-slate-700">سال جلالی</label>
          <select id={`${fieldId}-year`} value={year} onChange={(e) => pickYear(Number(e.target.value))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold">
            {yearOptions.map(y => (
              <option key={y} value={y}>{toPersianDigits(String(y))}{years.some(r => r.jalaliYear === y) ? '' : ' (بی نرخ)'}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor={`${fieldId}-employee-insurance-percent`} className="block text-xs font-bold text-slate-700 mb-1">درصد بیمه سهم کارگر</label>
            <input id={`${fieldId}-employee-insurance-percent`} inputMode="decimal" value={form.employeeInsurancePercent} onChange={(e) => setForm(p => ({ ...p, employeeInsurancePercent: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${fieldId}-employer-insurance-percent`} className="block text-xs font-bold text-slate-700 mb-1">درصد بیمه سهم کارفرما (همراه بیمه بیکاری)</label>
            <input id={`${fieldId}-employer-insurance-percent`} inputMode="decimal" value={form.employerInsurancePercent} onChange={(e) => setForm(p => ({ ...p, employerInsurancePercent: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${fieldId}-insurance-wage-cap`} className="block text-xs font-bold text-slate-700 mb-1">سقف ماهانه دستمزد مشمول بیمه (ریال)</label>
            <input id={`${fieldId}-insurance-wage-cap`} inputMode="decimal" value={form.insuranceWageCap} placeholder="خالی یعنی بی سقف" onChange={(e) => setForm(p => ({ ...p, insuranceWageCap: e.target.value }))} className={inputClass} />
            <RialEquivalent value={form.insuranceWageCap} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={form.deductInsuranceFromTax} onChange={(e) => setForm(p => ({ ...p, deductInsuranceFromTax: e.target.checked }))} />
          سهم بیمه کارگر از پایه مالیات کم شود
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-800">پله‌های مالیات حقوق ماهانه</span>
            <button type="button" onClick={addBracket} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1 cursor-pointer"><Plus size={13} /> افزودن پله</button>
          </div>
          {form.taxBrackets.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
              <input inputMode="decimal" aria-label={`آغاز پله ${toPersianDigits(String(i + 1))}`} value={b.from} onChange={(e) => setBracket(i, 'from', e.target.value)} placeholder="از (ریال)" className={inputClass} />
              <input inputMode="decimal" aria-label={`پایان پله ${toPersianDigits(String(i + 1))}`} value={b.to} onChange={(e) => setBracket(i, 'to', e.target.value)} placeholder="تا (ریال)؛ خالی یعنی بی‌پایان" className={inputClass} />
              <input inputMode="decimal" aria-label={`نرخ پله ${toPersianDigits(String(i + 1))}`} value={b.rate} onChange={(e) => setBracket(i, 'rate', e.target.value)} placeholder="نرخ (درصد)" className={inputClass} />
              <button type="button" onClick={() => removeBracket(i)} aria-label="حذف پله" className="p-2 text-rose-600 cursor-pointer"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        {formError && <p className="text-[11px] font-bold text-rose-700">{formError}</p>}
        <div className="flex justify-end">
          <button type="button" onClick={() => void save()} disabled={saving || !!formError}
            className="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs disabled:opacity-50 cursor-pointer">
            {saving ? 'در حال ذخیره...' : `ذخیره نرخ‌های سال ${toPersianDigits(String(year))}`}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
