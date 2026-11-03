import { useId, useRef } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSaveStorefrontBrandMutation } from '../../hooks/queries/useStorefrontQueries';
import type { StorefrontBrandView } from '../../lib/storefront/storefrontContracts';
import {
  BRAND_IMAGE_KINDS, BRAND_IMAGE_MAX_BYTES, BRAND_IMAGE_TITLES, brandImageError, type BrandImageKind,
} from '../../lib/storefront/storefrontRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.3: the site's logo and browser icon (owner: «لوگو … بشه تغییر داد توی تنظیمات»). An image is read in the
 * browser as a data URL and checked with the same rule the server uses; the server checks it again.
 */
const HINTS: Readonly<Record<BrandImageKind, string>> = {
  logo: 'در سرصفحه و پاصفحه سایت دیده می‌شود. بهتر است SVG یا PNG با زمینه شفاف باشد.',
  favicon: 'در زبانه مرورگر و میان‌برِ گوشی دیده می‌شود. تصویری مربع، دست‌کم ۱۸۰ در ۱۸۰ نقطه.',
};

const decodeText = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('خواندن فایل ممکن نشد.'));
    reader.readAsDataURL(file);
  });
}

function BrandSlot({ kind, brand, canManage }: { kind: BrandImageKind; brand: StorefrontBrandView; canManage: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const save = useSaveStorefrontBrandMutation();
  const current = brand[kind];
  const send = (image: string) => save.mutate({ kind, image, version: brand.version }, {
    onSuccess: () => toast.success(image ? `${BRAND_IMAGE_TITLES[kind]} ذخیره شد.` : `${BRAND_IMAGE_TITLES[kind]} برداشته شد.`),
    onError: (err) => toast.error(errorMessageOf(err)),
  });
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const image = await readAsDataUrl(file);
      const problem = brandImageError(image, kind, decodeText);
      if (problem) toast.error(problem);
      else send(image);
    } catch (err) {
      toast.error(errorMessageOf(err));
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <h3 id={`${id}-title`} className="text-sm font-black text-slate-800">{BRAND_IMAGE_TITLES[kind]}</h3>
      <div className="flex flex-wrap items-center gap-4">
        <div className={`flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 ${kind === 'logo' ? 'h-20 w-48' : 'h-20 w-20'}`}>
          {current
            ? <img src={current} alt={BRAND_IMAGE_TITLES[kind]} className="max-h-16 max-w-[11rem] object-contain" />
            : <span className="px-2 text-center text-xs text-slate-500">{kind === 'logo' && brand.usesCompanyLogo ? 'لوگوی شرکت نشان داده می‌شود' : 'گذاشته نشده'}</span>}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} id={`${id}-file`} type="file" accept="image/svg+xml,image/png,image/webp,image/jpeg" className="sr-only"
              onChange={e => { void pick(e.target.files?.[0]); }} />
            <label htmlFor={`${id}-file`} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${save.isPending ? 'pointer-events-none opacity-50' : ''}`}>
              <ImageUp className="w-4 h-4" />
              {current ? 'عوض کردن' : 'بارگذاری'}
            </label>
            {current && (
              <button type="button" disabled={save.isPending} onClick={() => send('')} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
                برداشتن
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-500">
        {HINTS[kind]} حداکثر {formatPersianNumber(BRAND_IMAGE_MAX_BYTES[kind] / 1024)} کیلوبایت.
      </p>
    </section>
  );
}

export function StorefrontBrandCard({ brand, canManage }: { brand: StorefrontBrandView; canManage: boolean }) {
  return (
    <div className="space-y-5">
      {BRAND_IMAGE_KINDS.map(kind => <BrandSlot key={kind} kind={kind} brand={brand} canManage={canManage} />)}
    </div>
  );
}
