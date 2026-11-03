import { useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useBuyerGroupsQuery, useDeleteBuyerGroupMutation } from '../../hooks/queries/useStorefrontBuyerQueries';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import type { BuyerGroupRow } from '../../lib/storefront/storefrontBuyerContracts';
import { CATALOG_SCOPE_TITLES } from '../../lib/storefront/storefrontBuyerRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { BuyerGroupEditor } from './BuyerGroupEditor';

/**
 * v11 phase 8.2b: the site's buyer groups. The retail policy is the price list of «پرداخت، قیمت و موجودی» and is shown to
 * everyone, guests too; each group here reaches only the accounts a colleague approved into it on «خریداران سایت».
 */
export function BuyerGroupsSection({ canManage }: { canManage: boolean }) {
  const rial = useRialDisplay();
  const groups = useBuyerGroupsQuery();
  const remove = useDeleteBuyerGroupMutation();
  const [editing, setEditing] = useState<BuyerGroupRow | 'new' | null>(null);

  const askRemove = async (g: BuyerGroupRow) => {
    const ok = await confirmAction({ title: 'حذف گروه خریدار', message: `گروه «${g.title}» حذف شود؟`, confirmText: 'حذف' });
    if (!ok) return;
    remove.mutate({ id: g.id, version: g.version }, {
      onSuccess: () => toast.success(`گروه «${g.title}» حذف شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const rules = (g: BuyerGroupRow) => [
    g.priceList || 'بی لیست قیمت',
    g.minOrderAmount !== '0' ? `حداقل سفارش ${rial.amount(g.minOrderAmount)}` : '',
    g.minLineQuantity > 0 ? `هر کالا دست‌کم ${formatPersianNumber(g.minLineQuantity)} عدد` : '',
    [g.allowCard ? 'کارت‌به‌کارت' : '', g.allowOnAccount ? 'به حساب' : ''].filter(Boolean).join(' و '),
    g.catalogScope === 'collections' ? `${formatPersianNumber(g.collections.length)} کالکشن` : CATALOG_SCOPE_TITLES.all,
  ].filter(Boolean).join('، ');

  return (
    <section aria-label="گروه‌های خریدار" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <Tags className="h-4 w-4 text-violet-600" />
          گروه‌های خریدار
        </h3>
        {canManage && editing === null && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white">
            <Plus className="h-4 w-4" />
            گروه تازه
          </button>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-500">
        قیمت خریدار تکی همان لیست قیمت تکی در «پرداخت، قیمت و موجودی» است و همه، بی حساب هم، آن را می‌بینند. قیمت هر گروه فقط به حسابی می‌رسد که همکار در «خریداران سایت» در آن گروه تأیید کرده باشد.
      </p>
      {editing !== null && groups.data && (
        <BuyerGroupEditor key={editing === 'new' ? 'new' : editing.id} group={editing === 'new' ? null : editing}
          priceLists={groups.data.priceLists} collections={groups.data.collections} onClose={() => setEditing(null)} />
      )}
      {groups.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {groups.isError && <p className="text-xs text-rose-700">{errorMessageOf(groups.error)}</p>}
      {groups.data && groups.data.groups.length === 0 && <p className="text-xs text-slate-500">هنوز گروهی نیست.</p>}
      <ul className="divide-y divide-slate-100">
        {(groups.data?.groups ?? []).map(g => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-bold text-slate-800">
                {g.title}
                <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-bold ${g.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {g.isActive ? 'فعال' : 'خاموش'}
                </span>
              </p>
              <p className="text-xs leading-5 text-slate-500">{rules(g)}</p>
              <p className="text-xs text-slate-500">{formatPersianNumber(g.accountCount)} حساب</p>
            </div>
            {canManage && (
              <div className="flex gap-1">
                <button type="button" aria-label={`ویرایش ${g.title}`} onClick={() => setEditing(g)} className="rounded-lg p-2.5 text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                <button type="button" aria-label={`حذف ${g.title}`} onClick={() => { void askRemove(g); }} className="rounded-lg p-2.5 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
