import { useState } from 'react';
import { Pencil, Plus, Trash2, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeleteShippingMethodMutation, useShippingMethodsQuery } from '../../hooks/queries/useStorefrontQueries';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import type { ShippingMethodRow } from '../../lib/storefront/storefrontContracts';
import { SHIPPING_PRICING_TITLES } from '../../lib/storefront/storefrontRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { ShippingMethodEditor } from './ShippingMethodEditor';

/** v11 phase 8.1: the delivery methods of the site; the seeded post, Snapp, courier and pickup start off */
export function ShippingMethodsSection({ canManage }: { canManage: boolean }) {
  const rial = useRialDisplay();
  const methods = useShippingMethodsQuery();
  const remove = useDeleteShippingMethodMutation();
  const [editing, setEditing] = useState<ShippingMethodRow | 'new' | null>(null);

  const priceText = (m: ShippingMethodRow) => {
    if (m.pricing === 'flat') return rial.amount(m.flatRate);
    if (m.pricing === 'table') return `${formatPersianNumber(m.rates.length)} ردیف نرخ`;
    return SHIPPING_PRICING_TITLES[m.pricing];
  };

  const askRemove = async (m: ShippingMethodRow) => {
    const ok = await confirmAction({ title: 'حذف روش ارسال', message: `روش «${m.title}» از سایت و از این فهرست برداشته شود؟`, confirmText: 'حذف' });
    if (!ok) return;
    remove.mutate({ id: m.id, version: m.version }, {
      onSuccess: () => toast.success(`روش «${m.title}» حذف شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <section aria-label="روش‌های ارسال" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <Truck className="w-4 h-4 text-cyan-600" />
          روش‌های ارسال
        </h3>
        {canManage && editing === null && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">
            <Plus className="w-4 h-4" />
            روش تازه
          </button>
        )}
      </div>
      {editing !== null && <ShippingMethodEditor key={editing === 'new' ? 'new' : editing.id} method={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {methods.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {methods.isError && <p className="text-xs text-rose-700">{errorMessageOf(methods.error)}</p>}
      {methods.data && methods.data.length === 0 && <p className="text-xs text-slate-500">هنوز روش ارسالی نیست.</p>}
      <ul className="divide-y divide-slate-100">
        {(methods.data ?? []).map(m => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-slate-800">
                {m.title}
                <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-bold ${m.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {m.isActive ? 'روی سایت' : 'خاموش'}
                </span>
              </p>
              <p className="text-xs text-slate-500">
                {SHIPPING_PRICING_TITLES[m.pricing]}، {priceText(m)}{m.isFreeShippingEligible ? '، بالای سقف رایگان' : ''}
              </p>
            </div>
            {canManage && (
              <div className="flex gap-1">
                <button type="button" aria-label={`ویرایش ${m.title}`} onClick={() => setEditing(m)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                <button type="button" aria-label={`حذف ${m.title}`} onClick={() => { void askRemove(m); }} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
