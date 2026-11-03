import { useId, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';
import { useSaveShippingMethodMutation } from '../../hooks/queries/useStorefrontQueries';
import type { ShippingMethodInput, ShippingMethodRow, ShippingRateRow } from '../../lib/storefront/storefrontContracts';
import { IRAN_PROVINCES, SHIPPING_PRICING, SHIPPING_PRICING_TITLES, type ShippingPricing } from '../../lib/storefront/storefrontRules';
import { errorMessageOf } from '../../utils';
import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v11 phase 8.1: one delivery method of the site: a flat rate, rows by province and weight (the buyer's province wins over
 * «همه استان‌های دیگر», and the lightest bound that holds the parcel wins), paid by the buyer on delivery (Snapp, courier),
 * or free (pickup). Amounts are in rials.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';

export const EMPTY_METHOD: ShippingMethodInput = {
  code: '', title: '', description: '', pricing: 'flat', flatRate: '', isActive: false, isFreeShippingEligible: true, sortOrder: 0, rates: [],
};

export function ShippingMethodEditor({ method, onClose }: { method: ShippingMethodRow | null; onClose: () => void }) {
  const id = useId();
  const save = useSaveShippingMethodMutation();
  const [form, setForm] = useState<ShippingMethodInput>(() => (method ? { ...method } : { ...EMPTY_METHOD }));
  const set = <K extends keyof ShippingMethodInput>(key: K, value: ShippingMethodInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const setRate = (index: number, patch: Partial<ShippingRateRow>) => set('rates', form.rates.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const canBeFree = form.pricing === 'flat' || form.pricing === 'table';

  const submit = () => {
    const input: ShippingMethodInput = { ...form, rates: form.pricing === 'table' ? form.rates : [], isFreeShippingEligible: canBeFree && form.isFreeShippingEligible };
    save.mutate({ id: method?.id ?? null, version: method?.version ?? 0, input }, {
      onSuccess: () => { toast.success(`روش ارسال «${form.title}» ذخیره شد.`); onClose(); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form aria-label={method ? `ویرایش روش ارسال ${method.title}` : 'روش ارسال تازه'} className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-5 space-y-4"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">{method ? `ویرایش «${method.title}»` : 'روش ارسال تازه'}</h4>
        <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-1 text-slate-500 hover:bg-white"><X className="w-4 h-4" /></button>
      </div>
      <fieldset disabled={save.isPending} className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-title`} className={label}>عنوان روی سایت</label>
          <input id={`${id}-title`} className={field} value={form.title} onChange={e => set('title', e.target.value)} placeholder="پست پیشتاز" />
        </div>
        <div>
          <label htmlFor={`${id}-code`} className={label}>کد لاتین</label>
          <input id={`${id}-code`} dir="ltr" className={field} value={form.code} onChange={e => set('code', e.target.value.toLowerCase())} placeholder="post" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-desc`} className={label}>توضیح کوتاه برای خریدار</label>
          <input id={`${id}-desc`} className={field} value={form.description} onChange={e => set('description', e.target.value)} placeholder="تحویل ۲ تا ۴ روز کاری" />
        </div>
        <div>
          <label htmlFor={`${id}-pricing`} className={label}>شیوه قیمت</label>
          <select id={`${id}-pricing`} className={field} value={form.pricing} onChange={e => set('pricing', e.target.value as ShippingPricing)}>
            {SHIPPING_PRICING.map(p => <option key={p} value={p}>{SHIPPING_PRICING_TITLES[p]}</option>)}
          </select>
        </div>
        {form.pricing === 'flat' && (
          <div>
            <label htmlFor={`${id}-flat`} className={label}>نرخ ثابت (ریال)</label>
            <DecimalInput id={`${id}-flat`} className={field} value={form.flatRate} min={0} step={1} onValueChange={v => set('flatRate', v)} />
            <RialEquivalent value={form.flatRate} />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-sort`} className={label}>ترتیب نمایش</label>
          <DecimalInput id={`${id}-sort`} className={field} grouped={false} value={form.sortOrder} min={0} step={1} onValueChange={v => set('sortOrder', Number(v) || 0)} />
        </div>
        <div className="flex flex-wrap items-center gap-4 md:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
            روی سایت پیشنهاد شود
          </label>
          {canBeFree && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isFreeShippingEligible} onChange={e => set('isFreeShippingEligible', e.target.checked)} />
              بالای سقف ارسال رایگان، رایگان شود
            </label>
          )}
        </div>
      </fieldset>

      {form.pricing === 'table' && (
        <div className="space-y-2">
          <p className="text-xs leading-6 text-slate-600">
            هر ردیف: تا این وزن (گرم) به این استان این نرخ. «همه استان‌های دیگر» برای استانی است که ردیف خودش را ندارد و سقف وزن خالی یعنی بی‌سقف.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="p-1 text-start font-bold">استان</th>
                  <th className="p-1 text-start font-bold">سقف وزن (گرم)</th>
                  <th className="p-1 text-start font-bold">نرخ (ریال)</th>
                  <th className="p-1"><span className="sr-only">حذف ردیف</span></th>
                </tr>
              </thead>
              <tbody>
                {form.rates.map((rate, index) => (
                  <tr key={index}>
                    <td className="p-1">
                      <select aria-label={`استان ردیف ${formatPersianNumber(index + 1)}`} className={`${field} min-w-[11rem]`} value={rate.province} onChange={e => setRate(index, { province: e.target.value })}>
                        <option value="">همه استان‌های دیگر</option>
                        {IRAN_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="p-1">
                      <DecimalInput aria-label={`سقف وزن ردیف ${formatPersianNumber(index + 1)}`} className={field} grouped={false} min={1} step={1}
                        value={rate.maxWeightGrams ?? ''} onValueChange={v => setRate(index, { maxWeightGrams: v === '' ? null : Number(v) })} />
                    </td>
                    <td className="p-1">
                      <DecimalInput aria-label={`نرخ ردیف ${formatPersianNumber(index + 1)}`} className={field} min={0} step={1} value={rate.rate} onValueChange={v => setRate(index, { rate: v })} />
                    </td>
                    <td className="p-1">
                      <button type="button" aria-label={`حذف ردیف ${formatPersianNumber(index + 1)}`} onClick={() => set('rates', form.rates.filter((_, i) => i !== index))} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => set('rates', [...form.rates, { province: '', maxWeightGrams: null, rate: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700">
            <Plus className="w-3.5 h-3.5" />
            افزودن ردیف
          </button>
        </div>
      )}

      <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        <Save className="w-4 h-4" />
        {save.isPending ? 'در حال ذخیره…' : 'ذخیره روش ارسال'}
      </button>
    </form>
  );
}
