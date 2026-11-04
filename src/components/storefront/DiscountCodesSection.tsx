import { useState } from 'react';
import { Pencil, Plus, TicketPercent, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeleteDiscountCodeMutation, useDiscountCodesQuery } from '../../hooks/queries/useStorefrontDiscountQueries';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import type { DiscountCodeRow } from '../../lib/storefront/storefrontDiscountContracts';
import { formatPersianNumber } from '../../utils/persianNumber';
import { isoToJalaliDate } from '../../utils/calendarDate';
import { errorMessageOf, formatPersianCode } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { DiscountCodeEditor } from './DiscountCodeEditor';

/**
 * v11 phase 8.2c: the site's discount codes. A buyer types one at checkout; the server checks it again when the order is
 * placed, takes the amount off the proforma's lines and counts one use, which goes back when the order is cancelled.
 */
export function DiscountCodesSection({ canManage }: { canManage: boolean }) {
  const rial = useRialDisplay();
  const codes = useDiscountCodesQuery();
  const remove = useDeleteDiscountCodeMutation();
  const [editing, setEditing] = useState<DiscountCodeRow | 'new' | null>(null);
  const groupTitle = new Map((codes.data?.groups ?? []).map(g => [g.id, g.title]));

  const askRemove = async (c: DiscountCodeRow) => {
    const ok = await confirmAction({ title: 'حذف کد تخفیف', message: `کد «${formatPersianCode(c.code)}» حذف شود؟ سفارش‌هایی که آن را به کار برده‌اند دست نمی‌خورند.`, confirmText: 'حذف' });
    if (!ok) return;
    remove.mutate({ id: c.id, version: c.version }, {
      onSuccess: () => toast.success(`کد «${formatPersianCode(c.code)}» حذف شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const rules = (c: DiscountCodeRow) => [
    c.kind === 'percent'
      ? `${formatPersianNumber(c.percent)}٪${c.maxDiscount !== '0' ? ` تا ${rial.amount(c.maxDiscount)}` : ''}`
      : rial.amount(c.amount),
    c.minOrderAmount !== '0' ? `از خرید ${rial.amount(c.minOrderAmount)}` : '',
    c.startsOn ? `از ${isoToJalaliDate(c.startsOn)}` : '',
    c.endsOn ? `تا ${isoToJalaliDate(c.endsOn)}` : '',
    [c.forRetail ? 'خریداران تکی' : '', ...c.groupIds.map(id => groupTitle.get(id) ?? '')].filter(Boolean).join(' و '),
    c.accountsOnly ? 'فقط با حساب' : '',
    c.firstOrderOnly ? 'فقط نخستین خرید' : '',
  ].filter(Boolean).join('، ');

  const uses = (c: DiscountCodeRow) => `${formatPersianNumber(c.usedCount)}${c.usageLimit > 0 ? ` از ${formatPersianNumber(c.usageLimit)}` : ''} بار به کار رفته`
    + (c.perBuyerLimit > 0 ? `، هر خریدار ${formatPersianNumber(c.perBuyerLimit)} بار` : '');

  return (
    <section aria-label="کدهای تخفیف" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <TicketPercent className="h-4 w-4 text-violet-600" />
          کدهای تخفیف
        </h3>
        {canManage && editing === null && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white">
            <Plus className="h-4 w-4" />
            کد تازه
          </button>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-500">
        خریدار کد را در صفحهٔ تسویه می‌نویسد. مبلغ تخفیف از ردیف‌های پیش‌فاکتور کم می‌شود و ارسال رایگان روی مبلغ پس از تخفیف سنجیده می‌شود. با لغو سفارش، یک بار استفاده به کد برمی‌گردد.
      </p>
      {editing !== null && codes.data && (
        <DiscountCodeEditor key={editing === 'new' ? 'new' : editing.id} code={editing === 'new' ? null : editing}
          groups={codes.data.groups} onClose={() => setEditing(null)} />
      )}
      {codes.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {codes.isError && <p className="text-xs text-rose-700">{errorMessageOf(codes.error)}</p>}
      {codes.data && codes.data.codes.length === 0 && <p className="text-xs text-slate-500">هنوز کد تخفیفی نیست.</p>}
      <ul className="divide-y divide-slate-100">
        {(codes.data?.codes ?? []).map(c => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-bold text-slate-800">
                <span dir="ltr" className="font-mono">{formatPersianCode(c.code)}</span>
                {c.title && <span className="ms-2 font-normal text-slate-600">{c.title}</span>}
                <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-bold ${c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {c.isActive ? 'فعال' : 'خاموش'}
                </span>
              </p>
              <p className="text-xs leading-5 text-slate-500">{rules(c)}</p>
              <p className="text-xs text-slate-500">{uses(c)}</p>
            </div>
            {canManage && (
              <div className="flex gap-1">
                <button type="button" aria-label={`ویرایش ${formatPersianCode(c.code)}`} onClick={() => setEditing(c)} className="rounded-lg p-2.5 text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                <button type="button" aria-label={`حذف ${formatPersianCode(c.code)}`} onClick={() => { void askRemove(c); }} className="rounded-lg p-2.5 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
