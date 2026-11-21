import { useId, useState } from 'react';
import { ImageIcon, Search, X } from 'lucide-react';
import { API_URL } from '../../../api';
import { useHasPermission } from '../../../contexts/AuthContext';
import { PAGE_IMAGE_OPTIONS_PAGE_SIZE, usePageImageOptionsQuery } from '../../../hooks/queries/useStorefrontPageQueries';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { errorMessageOf, formatPersianCode } from '../../../utils';

/**
 * v12 phase 10b: an image of a page, chosen from the media library (any image with a light version). The thumbnails are
 * the library's own files, so they show for a colleague who may see the library. Choosing a new image needs «مشاهده
 * کتابخانه تصاویر» (`media.view`), as the server checks; without it a page keeps the images it has.
 */
export const libraryThumbUrl = (id: number) => `${API_URL}/media/assets/${id}/file?variant=thumb`;

/** The library's list, opened on demand; `onPick` gets the chosen image and its title */
export function LibraryImageList({ value, onPick }: { value: number | null; onPick: (id: number, title: string) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const options = usePageImageOptionsQuery(q, page, true);
  const rows = Array.isArray(options.data?.data) ? options.data.data : [];
  const pages = Math.max(1, Math.ceil((options.data?.total ?? 0) / PAGE_IMAGE_OPTIONS_PAGE_SIZE));
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <label htmlFor={`${id}-q`} className="relative flex items-center">
        <span className="sr-only">جست‌وجوی تصویر</span>
        <Search className="pointer-events-none absolute start-3 h-4 w-4 text-slate-400" />
        <input id={`${id}-q`} type="search" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="نام تصویر، کد یا نام کالا"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pe-3 ps-9 text-base sm:text-sm" />
      </label>
      {options.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {options.isError && <p className="text-xs text-rose-700">{errorMessageOf(options.error)}</p>}
      {options.data && rows.length === 0 && <p className="text-xs text-slate-500">تصویری با نسخهٔ سبک پیدا نشد.</p>}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {rows.map(o => (
          <li key={o.id}>
            <button type="button" aria-pressed={value === o.id} onClick={() => onPick(o.id, o.title)}
              className={`block w-full overflow-hidden rounded-xl border text-start ${value === o.id ? 'border-sky-700 ring-2 ring-sky-700' : 'border-slate-200'}`}>
              <img src={libraryThumbUrl(o.id)} alt="" loading="lazy" className="aspect-square w-full bg-slate-100 object-cover" />
              <span className="block truncate px-1.5 py-1 text-xs text-slate-600">{o.itemCode ? formatPersianCode(o.itemCode) : o.title || o.section}</span>
            </button>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="min-h-11 rounded-lg px-3 disabled:opacity-40">قبلی</button>
          <span>{`${formatPersianNumber(page)} از ${formatPersianNumber(pages)}`}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="min-h-11 rounded-lg px-3 disabled:opacity-40">بعدی</button>
        </div>
      )}
    </div>
  );
}

export function LibraryImageField({ label, where = '', value, title, unusable = false, onChange }: {
  label: string;
  /** where the image belongs («بخش ۲»), read out with the button so several pickers on a page are told apart */
  where?: string;
  value: number | null;
  /** the chosen image's title, '' while unknown */
  title: string;
  /** the chosen image left the library or lost its light version: the page cannot be published with it */
  unusable?: boolean;
  onChange: (id: number | null, title: string) => void;
}) {
  const canPick = useHasPermission('media.view');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <p className="mb-1 block text-xs font-bold text-slate-700">{label}</p>
      {value !== null ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2">
          <img src={libraryThumbUrl(value)} alt="" className="h-16 w-16 rounded-lg bg-slate-100 object-cover" />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{title || 'تصویر انتخاب‌شده'}</span>
          <button type="button" onClick={() => onChange(null, '')} aria-label={`برداشتن ${label}`} className="rounded-lg p-2.5 text-rose-600 hover:bg-rose-50"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
      {unusable && <p role="alert" className="text-xs text-rose-700">این عکس دیگر در کتابخانهٔ تصاویر نیست یا نسخهٔ سبک ندارد؛ عکس دیگری برگزینید.</p>}
      {!canPick && <p className="text-xs text-slate-500">برای انتخاب عکس تازه، دسترسی «مشاهده کتابخانه تصاویر» لازم است.</p>}
      {canPick && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`${open ? 'بستن کتابخانهٔ تصاویر' : value === null ? 'انتخاب از کتابخانهٔ تصاویر' : 'عوض کردن عکس'}: ${label}${where ? `، ${where}` : ''}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
          <ImageIcon className="h-4 w-4" />
          {open ? 'بستن کتابخانهٔ تصاویر' : value === null ? 'انتخاب از کتابخانهٔ تصاویر' : 'عوض کردن عکس'}
        </button>
      )}
      {canPick && open && <LibraryImageList value={value} onPick={(id, pickedTitle) => { onChange(id, pickedTitle); setOpen(false); }} />}
    </div>
  );
}
