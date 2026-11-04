import { useState } from 'react';
import { CalendarHeart, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCampaignsQuery, useDeleteCampaignMutation } from '../../hooks/queries/useStorefrontCampaignQueries';
import type { CampaignRow } from '../../lib/storefront/storefrontCampaignContracts';
import { CAMPAIGN_SOURCE_TITLES, CAMPAIGN_STATUS_TITLES, type CampaignStatus } from '../../lib/storefront/storefrontCampaignRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { isoToJalaliDate } from '../../utils/calendarDate';
import { errorMessageOf, formatPersianCode } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { StorefrontCampaignEditor } from './StorefrontCampaignEditor';

/**
 * v11 phase 8.5b (owner's decision 2026-11-04): «صفحه‌های ویژه», the site's campaign and occasion pages (Yalda first). A
 * page has its own address, a hero image, a text, its products (one collection or chosen items) and an optional discount
 * code to show; it is on the site only between its two days, and may put itself on the home page meanwhile.
 */
const STATUS_TONES: Readonly<Record<CampaignStatus, string>> = {
  live: 'bg-emerald-50 text-emerald-700',
  scheduled: 'bg-sky-50 text-sky-700',
  ended: 'bg-slate-100 text-slate-500',
  off: 'bg-slate-100 text-slate-500',
};

export function StorefrontCampaignsSection({ canManage }: { canManage: boolean }) {
  const campaigns = useCampaignsQuery();
  const remove = useDeleteCampaignMutation();
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);

  const askRemove = async (c: CampaignRow) => {
    const ok = await confirmAction({ title: 'حذف صفحهٔ ویژه', message: `صفحهٔ «${c.title}» حذف شود؟ نشانی آن روی سایت دیگر باز نمی‌شود.`, confirmText: 'حذف' });
    if (!ok) return;
    remove.mutate({ id: c.id, version: c.version }, {
      onSuccess: () => toast.success(`صفحهٔ «${c.title}» حذف شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const facts = (c: CampaignRow) => [
    c.source === 'collection' ? `کالکشن ${c.collection}` : `${formatPersianNumber(c.itemIds.length)} ${CAMPAIGN_SOURCE_TITLES.products}`,
    c.startsOn ? `از ${isoToJalaliDate(c.startsOn)}` : '',
    c.endsOn ? `تا ${isoToJalaliDate(c.endsOn)}` : '',
    c.discountCode ? `کد ${formatPersianCode(c.discountCode)}` : '',
    c.homeBanner ? 'روی صفحهٔ اصلی' : '',
  ].filter(Boolean).join('، ');

  return (
    <section aria-label="صفحه‌های ویژه" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <CalendarHeart className="h-4 w-4 text-sky-700" />
          صفحه‌های ویژه
        </h3>
        {canManage && editing === null && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white">
            <Plus className="h-4 w-4" />
            صفحهٔ تازه
          </button>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-500">
        صفحه‌ای برای یک مناسبت یا پیشنهاد، مانند یلدا: با نشانی خودش روی سایت، تصویر سرصفحه، متن، محصولات یک کالکشن یا محصولات انتخابی، و کد تخفیفی که روی صفحه دیده می‌شود. صفحه فقط میان روز آغاز و پایانش روی سایت است.
      </p>
      {editing !== null && campaigns.data && (
        <StorefrontCampaignEditor key={editing === 'new' ? 'new' : editing.id} campaign={editing === 'new' ? null : editing}
          collections={campaigns.data.collections} onClose={() => setEditing(null)} />
      )}
      {campaigns.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {campaigns.isError && <p className="text-xs text-rose-700">{errorMessageOf(campaigns.error)}</p>}
      {campaigns.data && campaigns.data.campaigns.length === 0 && <p className="text-xs text-slate-500">هنوز صفحهٔ ویژه‌ای نیست.</p>}
      <ul className="divide-y divide-slate-100">
        {(campaigns.data?.campaigns ?? []).map(c => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-bold text-slate-800">
                {c.title}
                <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONES[c.status]}`}>{CAMPAIGN_STATUS_TITLES[c.status]}</span>
              </p>
              <p className="text-xs text-slate-500"><bdi dir="ltr" className="font-mono">/campaigns/{c.slug}</bdi></p>
              <p className="text-xs leading-5 text-slate-500">{facts(c)}</p>
              {c.hero && !c.hero.onSite && <p className="text-xs text-amber-700">تصویر سرصفحه نسخهٔ سبک ندارد یا حذف شده؛ صفحه بی تصویر نشان داده می‌شود.</p>}
              {c.products.some(p => !p.onSite) && (
                <p className="text-xs text-amber-700">{`${formatPersianNumber(c.products.filter(p => !p.onSite).length)} محصول انتخابی اکنون روی سایت نیست و نشان داده نمی‌شود.`}</p>
              )}
            </div>
            {canManage && (
              <div className="flex gap-1">
                <button type="button" aria-label={`ویرایش ${c.title}`} onClick={() => setEditing(c)} className="rounded-lg p-2.5 text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                <button type="button" aria-label={`حذف ${c.title}`} onClick={() => { void askRemove(c); }} className="rounded-lg p-2.5 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
