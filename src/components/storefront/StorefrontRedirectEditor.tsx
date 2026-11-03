import { useId, useState } from 'react';
import { Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSaveStorefrontRedirectMutation } from '../../hooks/queries/useStorefrontSeoQueries';
import { useStorefrontProductsQuery } from '../../hooks/queries/useStorefrontQueries';
import type { StorefrontRedirectInput, StorefrontRedirectRow } from '../../lib/storefront/storefrontSeoContracts';
import {
  REDIRECT_TARGET_KINDS, REDIRECT_TARGET_KIND_TITLES, legacyPathError, legacyPathKey, redirectTargetError, type RedirectTargetKind,
} from '../../lib/storefront/storefrontSeoRules';
import { formatPersianCode } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.5: one old address and where it goes. The old address may be pasted whole (with the site and an encoded
 * Persian path); the form shows the key the ERP keeps. A product is chosen by its code or name and followed by its item,
 * so a later change of its site address keeps the redirect.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';

const blank: StorefrontRedirectInput = { fromPath: '', targetKind: 'product', targetItemId: null, target: '', note: '', isActive: true };

export function StorefrontRedirectEditor({ row, onClose }: { row: StorefrontRedirectRow | null; onClose: () => void }) {
  const id = useId();
  const save = useSaveStorefrontRedirectMutation();
  const [form, setForm] = useState<StorefrontRedirectInput>(() => (row
    ? { fromPath: row.fromPath, targetKind: row.targetKind, targetItemId: row.targetItemId, target: row.target, note: row.note, isActive: row.isActive }
    : blank));
  const [productSearch, setProductSearch] = useState('');
  const [productLabel, setProductLabel] = useState(row?.targetKind === 'product' ? `${formatPersianCode(row.targetCode)} ${row.targetName}` : '');
  const products = useStorefrontProductsQuery({ page: 1, q: productSearch, published: 'all' });
  const set = <K extends keyof StorefrontRedirectInput>(key: K, value: StorefrontRedirectInput[K]) => setForm(f => ({ ...f, [key]: value }));

  const key = legacyPathKey(form.fromPath);
  const fromProblem = form.fromPath.trim() ? legacyPathError(form.fromPath) : null;
  const targetProblem = form.targetKind === 'product'
    ? (form.targetItemId ? null : 'محصول مقصد را انتخاب کنید.')
    : (form.target.trim() ? redirectTargetError(form.targetKind, form.target) : null);
  const ready = Boolean(form.fromPath.trim()) && !fromProblem && !targetProblem && (form.targetKind === 'product' || Boolean(form.target.trim()));

  const submit = () => {
    save.mutate({ id: row?.id ?? null, version: row?.version ?? 0, input: form }, {
      onSuccess: () => { toast.success('انتقال نشانی ذخیره شد.'); onClose(); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form aria-label={row ? 'ویرایش انتقال نشانی' : 'انتقال نشانی تازه'} className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4 space-y-3"
      onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">{row ? 'ویرایش انتقال نشانی' : 'انتقال نشانی تازه'}</h4>
        <button type="button" aria-label="بستن" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-white"><X className="w-4 h-4" /></button>
      </div>
      <fieldset disabled={save.isPending} className="space-y-3">
        <div>
          <label htmlFor={`${id}-from`} className={label}>نشانی در سایت قبلی</label>
          <input id={`${id}-from`} dir="ltr" autoComplete="off" className={field} value={form.fromPath} onChange={e => set('fromPath', e.target.value)}
            placeholder="/product/…" />
          {fromProblem
            ? <p className="mt-1 text-xs text-rose-700">{fromProblem}</p>
            : key && <p className="mt-1 text-xs text-slate-500">نگه‌داشته می‌شود: <span dir="ltr" className="font-mono">{key}</span></p>}
        </div>
        <div role="radiogroup" aria-label="مقصد" className="flex flex-wrap gap-2">
          {REDIRECT_TARGET_KINDS.map(kind => (
            <label key={kind} className={`inline-flex cursor-pointer items-center rounded-xl border px-3 py-1.5 text-xs font-bold ${form.targetKind === kind ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
              <input type="radio" className="sr-only" name={`${id}-kind`} checked={form.targetKind === kind}
                onChange={() => setForm(f => ({ ...f, targetKind: kind as RedirectTargetKind, targetItemId: null, target: '' }))} />
              {REDIRECT_TARGET_KIND_TITLES[kind]}
            </label>
          ))}
        </div>
        {form.targetKind === 'product' ? (
          <div className="space-y-2">
            <label htmlFor={`${id}-product`} className={label}>محصول مقصد</label>
            {form.targetItemId && <p className="text-sm font-bold text-slate-800">{productLabel}</p>}
            <input id={`${id}-product`} autoComplete="off" className={field} placeholder="کد یا نام کالا" value={productSearch} onChange={e => setProductSearch(e.target.value)} />
            {productSearch.trim() && (
              <ul className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm">
                {(products.data?.data ?? []).slice(0, 12).map(p => (
                  <li key={p.itemId}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-slate-50"
                      onClick={() => { set('targetItemId', p.itemId); setProductLabel(`${formatPersianCode(p.code)} ${p.name}`); setProductSearch(''); }}>
                      <span>{p.name} <span dir="ltr" className="text-xs text-slate-500">{formatPersianCode(p.code)}</span></span>
                      {!p.published && <span className="text-xs text-amber-700">منتشرنشده</span>}
                    </button>
                  </li>
                ))}
                {products.data && products.data.data.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">کالایی پیدا نشد.</li>}
              </ul>
            )}
            <p className="text-xs leading-6 text-slate-500">تا وقتی محصول روی سایت منتشر نشده، این انتقال منتظر می‌ماند و نشانی قدیمی به جست‌وجوی سایت می‌رود.</p>
          </div>
        ) : (
          <div>
            <label htmlFor={`${id}-target`} className={label}>
              {form.targetKind === 'path' ? 'نشانی در سایت تازه' : `نام ${REDIRECT_TARGET_KIND_TITLES[form.targetKind]}، همان‌گونه که در ERP است`}
            </label>
            <input id={`${id}-target`} dir={form.targetKind === 'path' ? 'ltr' : 'rtl'} autoComplete="off" className={field} value={form.target}
              placeholder={form.targetKind === 'path' ? '/about' : ''} onChange={e => set('target', e.target.value)} />
          </div>
        )}
        {targetProblem && form.targetKind !== 'product' && <p className="text-xs text-rose-700">{targetProblem}</p>}
        <div>
          <label htmlFor={`${id}-note`} className={label}>یادداشت (اختیاری)</label>
          <input id={`${id}-note`} autoComplete="off" className={field} value={form.note} onChange={e => set('note', e.target.value)} />
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700">
          <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
          روشن
        </label>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" disabled={!ready || save.isPending} className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
          <Save className="w-4 h-4" />
          {save.isPending ? 'در حال ذخیره…' : 'ذخیره'}
        </button>
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">انصراف</button>
      </div>
    </form>
  );
}
