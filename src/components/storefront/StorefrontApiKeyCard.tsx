import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRotateStorefrontKeyMutation } from '../../hooks/queries/useStorefrontQueries';
import type { StorefrontSettingsView } from '../../lib/storefront/storefrontContracts';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';

/**
 * v11 phase 8.1: the key the site app reads the Storefront API with. The server keeps only its fingerprint, so a new key
 * is shown once here, to be put into the site app's settings; making a new one stops the old one at once.
 */
export function StorefrontApiKeyCard({ view, canManage }: { view: StorefrontSettingsView; canManage: boolean }) {
  const rotate = useRotateStorefrontKeyMutation();
  const [shown, setShown] = useState('');

  const make = async () => {
    if (view.apiKey.configured) {
      const ok = await confirmAction({
        title: 'کلید تازه بسازید؟',
        message: 'کلید کنونی همین حالا از کار می‌افتد و سایت تا گذاشتن کلید تازه در تنظیمات آن، کالایی نشان نمی‌دهد.',
        confirmText: 'ساخت کلید تازه',
      });
      if (!ok) return;
    }
    rotate.mutate(undefined, {
      onSuccess: (made) => { setShown(made.apiKey); toast.success('کلید برنامه سایت ساخته شد.'); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      toast.success('کلید رونوشت شد.');
    } catch {
      toast.error('رونوشت نشد؛ کلید را خودتان انتخاب و رونوشت کنید.');
    }
  };

  return (
    <section aria-label="کلید برنامه سایت" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <KeyRound className="w-4 h-4 text-amber-600" />
          کلید برنامه سایت
        </h3>
        {view.apiKey.configured ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">ساخته شده</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">ساخته نشده</span>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-600">
        برنامه سایت papitalgallery.com با این کلید کالاها، قیمت‌ها و موجودی را از ERP می‌خواند. کلید را فقط در تنظیمات سرور سایت بگذارید و برای کسی نفرستید.
        {view.apiKey.configured && view.apiKey.createdAt ? ` کلید کنونی با پایان «${view.apiKey.hint}» در ${formatPersianDateTime(view.apiKey.createdAt)} ساخته شد.` : ''}
      </p>
      {shown && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-bold text-amber-800">این کلید فقط همین یک بار دیده می‌شود؛ همین حالا آن را در تنظیمات سایت بگذارید.</p>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="flex-1 break-all rounded-lg bg-white px-2 py-1 text-xs">{shown}</code>
            <button type="button" onClick={() => { void copy(); }} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-bold text-amber-800">
              <Copy className="w-3.5 h-3.5" />
              رونوشت
            </button>
          </div>
        </div>
      )}
      {canManage && (
        <button type="button" disabled={rotate.isPending} onClick={() => { void make(); }} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <KeyRound className="w-4 h-4" />
          {view.apiKey.configured ? 'ساخت کلید تازه' : 'ساخت کلید'}
        </button>
      )}
    </section>
  );
}
