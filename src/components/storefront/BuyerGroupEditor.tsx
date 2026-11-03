import { useId, useState } from 'react';
import { Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';
import { useSaveBuyerGroupMutation } from '../../hooks/queries/useStorefrontBuyerQueries';
import type { BuyerGroupInput, BuyerGroupRow } from '../../lib/storefront/storefrontBuyerContracts';
import { CATALOG_SCOPES, CATALOG_SCOPE_TITLES, type CatalogScope } from '../../lib/storefront/storefrontBuyerRules';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.2b (start plan §6, decision 5): one buyer group, a price policy of the site: its ERP price list, the
 * smallest order and the smallest quantity of each product (0 = none), how it may pay, and which products it sees.
 * Choosing a price list also needs the price key of the items (the server says so). Amounts are in rials.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base sm:text-sm';
const label = 'mb-1 block text-xs font-bold text-slate-700';
const check = 'flex min-h-11 items-center gap-2 text-sm text-slate-700';

export const EMPTY_GROUP: BuyerGroupInput = {
  code: '', title: '', description: '', priceList: '', minOrderAmount: '0', minLineQuantity: 0, allowCard: true, allowOnAccount: false,
  creditLimit: '0', catalogScope: 'all', collections: [], acceptsDiscounts: false, isActive: false, sortOrder: 0,
};

export function BuyerGroupEditor({ group, priceLists, collections, onClose }: {
  group: BuyerGroupRow | null; priceLists: string[]; collections: string[]; onClose: () => void;
}) {
  const id = useId();
  const save = useSaveBuyerGroupMutation();
  const [form, setForm] = useState<BuyerGroupInput>(() => (group ? { ...group } : { ...EMPTY_GROUP }));
  const set = <K extends keyof BuyerGroupInput>(key: K, value: BuyerGroupInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const toggleCollection = (name: string) => set('collections', form.collections.includes(name) ? form.collections.filter(c => c !== name) : [...form.collections, name]);
  const collectionChoices = [...new Set([...collections, ...form.collections])];

  const submit = () => {
    save.mutate({ id: group?.id ?? null, version: group?.version ?? 0, input: { ...form, collections: form.catalogScope === 'collections' ? form.collections : [] } }, {
      onSuccess: () => { toast.success(`گروه «${form.title}» ذخیره شد.`); onClose(); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form aria-label={group ? `ویرایش گروه ${group.title}` : 'گروه خریدار تازه'} className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">{group ? `ویرایش «${group.title}»` : 'گروه خریدار تازه'}</h4>
        <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-2 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
      <fieldset disabled={save.isPending} className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-title`} className={label}>نام گروه</label>
          <input id={`${id}-title`} className={field} value={form.title} onChange={e => set('title', e.target.value)} placeholder="خریدار عمده" />
        </div>
        <div>
          <label htmlFor={`${id}-code`} className={label}>کد لاتین</label>
          <input id={`${id}-code`} dir="ltr" className={field} value={form.code} onChange={e => set('code', e.target.value.toLowerCase())} placeholder="wholesale" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-desc`} className={label}>توضیح برای همکاران</label>
          <input id={`${id}-desc`} className={field} value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-list`} className={label}>لیست قیمت ERP</label>
          <select id={`${id}-list`} className={field} value={form.priceList} onChange={e => set('priceList', e.target.value)}>
            <option value="">انتخاب نشده</option>
            {priceLists.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-min-order`} className={label}>حداقل مبلغ سفارش (ریال، ۰ یعنی ندارد)</label>
          <DecimalInput id={`${id}-min-order`} className={field} value={form.minOrderAmount} min={0} step={1} onValueChange={v => set('minOrderAmount', v)} />
          <RialEquivalent value={form.minOrderAmount} />
        </div>
        <div>
          <label htmlFor={`${id}-min-line`} className={label}>حداقل تعداد هر کالا (۰ یعنی ندارد)</label>
          <DecimalInput id={`${id}-min-line`} className={field} grouped={false} value={form.minLineQuantity} min={0} step={1} onValueChange={v => set('minLineQuantity', Number(v) || 0)} />
        </div>
        <div>
          <label htmlFor={`${id}-sort`} className={label}>ترتیب نمایش</label>
          <DecimalInput id={`${id}-sort`} className={field} grouped={false} value={form.sortOrder} min={0} step={1} onValueChange={v => set('sortOrder', Number(v) || 0)} />
        </div>
        <fieldset className="md:col-span-2">
          <legend className={label}>راه پرداخت</legend>
          <div className="flex flex-wrap gap-x-5">
            <label className={check}><input type="checkbox" checked={form.allowCard} onChange={e => set('allowCard', e.target.checked)} />کارت‌به‌کارت</label>
            <label className={check}><input type="checkbox" checked={form.allowOnAccount} onChange={e => set('allowOnAccount', e.target.checked)} />به حساب (فاکتور بی رسید، با تأیید همکار)</label>
          </div>
        </fieldset>
        {form.allowOnAccount && (
          <div>
            <label htmlFor={`${id}-credit`} className={label}>سقف اعتبار برای دید همکار (ریال، ۰ یعنی ندارد)</label>
            <DecimalInput id={`${id}-credit`} className={field} value={form.creditLimit} min={0} step={1} onValueChange={v => set('creditLimit', v)} />
            <RialEquivalent value={form.creditLimit} />
          </div>
        )}
        <div className="md:col-span-2">
          <label htmlFor={`${id}-scope`} className={label}>کالاهایی که این گروه می‌بیند</label>
          <select id={`${id}-scope`} className={field} value={form.catalogScope} onChange={e => set('catalogScope', e.target.value as CatalogScope)}>
            {CATALOG_SCOPES.map(s => <option key={s} value={s}>{CATALOG_SCOPE_TITLES[s]}</option>)}
          </select>
        </div>
        {form.catalogScope === 'collections' && (
          <fieldset className="md:col-span-2">
            <legend className={label}>کالکشن‌ها</legend>
            {collectionChoices.length === 0 && <p className="text-xs text-slate-500">هنوز کالایی کالکشن ندارد؛ کالکشن را روی کارت کالا بنویسید.</p>}
            <div className="flex flex-wrap gap-2">
              {collectionChoices.map(c => (
                <button key={c} type="button" aria-pressed={form.collections.includes(c)} onClick={() => toggleCollection(c)}
                  className={`min-h-11 rounded-full border px-3.5 text-xs font-bold ${form.collections.includes(c) ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                  {c}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex flex-wrap gap-x-5 md:col-span-2">
          <label className={check}><input type="checkbox" checked={form.acceptsDiscounts} onChange={e => set('acceptsDiscounts', e.target.checked)} />کد تخفیف روی قیمت این گروه بنشیند</label>
          <label className={check}><input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />گروه فعال است</label>
        </div>
      </fieldset>
      <button type="submit" disabled={save.isPending} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:w-auto">
        <Save className="h-4 w-4" />
        {save.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ گروه'}
      </button>
    </form>
  );
}
