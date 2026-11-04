import { useId, useState } from 'react';
import { Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { useSaveDiscountCodeMutation } from '../../hooks/queries/useStorefrontDiscountQueries';
import type { DiscountCodeInput, DiscountCodeRow, DiscountCodesView } from '../../lib/storefront/storefrontDiscountContracts';
import { DISCOUNT_CODE_HINT, DISCOUNT_KINDS, DISCOUNT_KIND_TITLES, DISCOUNT_PERCENT_MAX, type DiscountKind } from '../../lib/storefront/storefrontDiscountRules';
import { errorMessageOf, formatPersianCode } from '../../utils';

/**
 * v11 phase 8.2c (start plan §6, decision 6): one discount code of the site. A percent (with an optional cap) or an amount
 * in rial, from a minimum order, between two days, with a limit in all and for each buyer (0 = none). It reaches retail
 * buyers (guests too) by default, and the buyer groups chosen here when their group accepts discount codes.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base sm:text-sm';
const label = 'mb-1 block text-xs font-bold text-slate-700';
const check = 'flex min-h-11 items-center gap-2 text-sm text-slate-700';

export const EMPTY_DISCOUNT: DiscountCodeInput = {
  code: '', title: '', kind: 'percent', percent: 10, amount: '0', maxDiscount: '0', minOrderAmount: '0', startsOn: '', endsOn: '',
  usageLimit: 0, perBuyerLimit: 1, forRetail: true, groupIds: [], accountsOnly: false, firstOrderOnly: false, isActive: true,
};

export function DiscountCodeEditor({ code, groups, onClose }: { code: DiscountCodeRow | null; groups: DiscountCodesView['groups']; onClose: () => void }) {
  const id = useId();
  const save = useSaveDiscountCodeMutation();
  const [form, setForm] = useState<DiscountCodeInput>(() => {
    if (!code) return { ...EMPTY_DISCOUNT };
    const { id: _id, usedCount: _used, version: _version, ...input } = code;
    return input;
  });
  const set = <K extends keyof DiscountCodeInput>(key: K, value: DiscountCodeInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const toggleGroup = (groupId: number) => set('groupIds', form.groupIds.includes(groupId) ? form.groupIds.filter(g => g !== groupId) : [...form.groupIds, groupId]);
  const percentKind = form.kind === 'percent';

  const submit = () => {
    save.mutate({ id: code?.id ?? null, version: code?.version ?? 0, input: form }, {
      onSuccess: (saved) => { toast.success(`کد «${formatPersianCode(saved.code)}» ذخیره شد.`); onClose(); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form aria-label={code ? `ویرایش کد ${formatPersianCode(code.code)}` : 'کد تخفیف تازه'} className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">{code ? `ویرایش «${formatPersianCode(code.code)}»` : 'کد تخفیف تازه'}</h4>
        <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-2 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
      <fieldset disabled={save.isPending} className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-code`} className={label}>کد</label>
          <input id={`${id}-code`} dir="ltr" className={field} value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="YALDA1405" aria-describedby={`${id}-code-hint`} />
          <p id={`${id}-code-hint`} className="mt-1 text-xs leading-5 text-slate-500">{DISCOUNT_CODE_HINT}</p>
        </div>
        <div>
          <label htmlFor={`${id}-title`} className={label}>عنوانی که خریدار می‌بیند</label>
          <input id={`${id}-title`} className={field} value={form.title} onChange={e => set('title', e.target.value)} placeholder="تخفیف شب یلدا" />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className={label}>نوع تخفیف</label>
          <select id={`${id}-kind`} className={field} value={form.kind} onChange={e => set('kind', e.target.value as DiscountKind)}>
            {DISCOUNT_KINDS.map(k => <option key={k} value={k}>{DISCOUNT_KIND_TITLES[k]}</option>)}
          </select>
        </div>
        {percentKind ? (
          <>
            <div>
              <label htmlFor={`${id}-percent`} className={label}>{`درصد (۱ تا ${DISCOUNT_PERCENT_MAX.toLocaleString('fa-IR')})`}</label>
              <DecimalInput id={`${id}-percent`} className={field} grouped={false} value={form.percent} min={1} max={DISCOUNT_PERCENT_MAX} step={1} onValueChange={v => set('percent', Number(v) || 0)} />
            </div>
            <div>
              <label htmlFor={`${id}-cap`} className={label}>سقف تخفیف (ریال، ۰ یعنی ندارد)</label>
              <DecimalInput id={`${id}-cap`} className={field} value={form.maxDiscount} min={0} step={1} onValueChange={v => set('maxDiscount', v)} />
              <RialEquivalent value={form.maxDiscount} />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor={`${id}-amount`} className={label}>مبلغ تخفیف (ریال)</label>
            <DecimalInput id={`${id}-amount`} className={field} value={form.amount} min={0} step={1} onValueChange={v => set('amount', v)} />
            <RialEquivalent value={form.amount} />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-min`} className={label}>{percentKind ? 'حداقل خرید (ریال، ۰ یعنی ندارد)' : 'حداقل خرید (ریال، بیشتر از مبلغ تخفیف)'}</label>
          <DecimalInput id={`${id}-min`} className={field} value={form.minOrderAmount} min={0} step={1} onValueChange={v => set('minOrderAmount', v)} />
          <RialEquivalent value={form.minOrderAmount} />
        </div>
        <div>
          <label htmlFor={`${id}-starts`} className={label}>از روز (خالی یعنی از همین حالا)</label>
          <JalaliDateInput id={`${id}-starts`} className={field} value={form.startsOn} onChange={v => set('startsOn', v)} />
        </div>
        <div>
          <label htmlFor={`${id}-ends`} className={label}>تا پایان روز (خالی یعنی بی‌پایان)</label>
          <JalaliDateInput id={`${id}-ends`} className={field} value={form.endsOn} onChange={v => set('endsOn', v)} />
        </div>
        <div>
          <label htmlFor={`${id}-limit`} className={label}>سقف کل استفاده (۰ یعنی بی‌سقف)</label>
          <DecimalInput id={`${id}-limit`} className={field} grouped={false} value={form.usageLimit} min={0} step={1} onValueChange={v => set('usageLimit', Number(v) || 0)} />
        </div>
        <div>
          <label htmlFor={`${id}-per-buyer`} className={label}>سقف استفادهٔ هر خریدار (۰ یعنی بی‌سقف)</label>
          <DecimalInput id={`${id}-per-buyer`} className={field} grouped={false} value={form.perBuyerLimit} min={0} step={1} onValueChange={v => set('perBuyerLimit', Number(v) || 0)} />
        </div>
        <fieldset className="md:col-span-2">
          <legend className={label}>چه کسی می‌تواند به کار ببرد</legend>
          <label className={check}><input type="checkbox" checked={form.forRetail} onChange={e => set('forRetail', e.target.checked)} />خریداران تکی (با حساب یا بی حساب)</label>
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {groups.map(g => (
                <button key={g.id} type="button" aria-pressed={form.groupIds.includes(g.id)} disabled={!g.acceptsDiscounts && !form.groupIds.includes(g.id)}
                  title={g.acceptsDiscounts ? undefined : 'این گروه کد تخفیف نمی‌پذیرد'} onClick={() => toggleGroup(g.id)}
                  className={`min-h-11 rounded-full border px-3.5 text-xs font-bold disabled:opacity-50 ${form.groupIds.includes(g.id) ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                  {g.title}
                </button>
              ))}
            </div>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-x-5 md:col-span-2">
          <label className={check}><input type="checkbox" checked={form.accountsOnly} onChange={e => set('accountsOnly', e.target.checked)} />فقط برای دارندگان حساب</label>
          <label className={check}><input type="checkbox" checked={form.firstOrderOnly} onChange={e => set('firstOrderOnly', e.target.checked)} />فقط نخستین خرید</label>
          <label className={check}><input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />کد فعال است</label>
        </div>
      </fieldset>
      <button type="submit" disabled={save.isPending} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:w-auto">
        <Save className="h-4 w-4" />
        {save.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ کد'}
      </button>
    </form>
  );
}
