import { useState } from 'react';
import { ArrowLeftRight, DownloadCloud, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  STOREFRONT_REDIRECTS_PAGE_SIZE, useDeleteStorefrontRedirectMutation, useImportStorefrontRedirectsMutation, useStorefrontRedirectsQuery,
  useToggleStorefrontRedirectMutation, type StorefrontRedirectFilter,
} from '../../hooks/queries/useStorefrontSeoQueries';
import type { StorefrontRedirectImportResult, StorefrontRedirectRow } from '../../lib/storefront/storefrontSeoContracts';
import { REDIRECT_SOURCE_TITLES, REDIRECT_TARGET_KIND_TITLES } from '../../lib/storefront/storefrontSeoRules';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { StorefrontRedirectEditor } from './StorefrontRedirectEditor';

/**
 * v11 phase 8.5: the old addresses of the WooCommerce site and where each goes on the new site, so a link in an
 * Instagram post, a search result or a bookmark keeps working after the switch. «خواندن از ووکامرس» makes them from the
 * links «اتصال ووکامرس» keeps; a row made or edited here is never changed by a later reading.
 */
const SOURCE_FILTERS: Array<{ value: StorefrontRedirectFilter['source']; label: string }> = [
  { value: '', label: 'همه' }, { value: 'woocommerce', label: REDIRECT_SOURCE_TITLES.woocommerce }, { value: 'manual', label: REDIRECT_SOURCE_TITLES.manual },
];

function targetText(row: StorefrontRedirectRow): string {
  if (row.targetKind === 'product') return `${row.targetName} (${formatPersianCode(row.targetCode)})`;
  return row.target;
}

function importSummary(r: StorefrontRedirectImportResult): string {
  const n = formatPersianNumber;
  const parts = [`${n(r.created)} انتقال تازه`, `${n(r.updated)} به‌روز`, `${n(r.unchanged)} بی‌تغییر`];
  if (r.keptManual > 0) parts.push(`${n(r.keptManual)} دستی که دست نخورد`);
  if (r.unmatched > 0) parts.push(`${n(r.unmatched)} بی‌همتا در ERP`);
  return `از ووکامرس ${n(r.read.products)} محصول، ${n(r.read.categories)} دسته و ${n(r.read.tags)} برچسب خوانده شد: ${parts.join('، ')}.${r.truncated ? ' سایت بیش از اندازهٔ یک بار خواندن محصول داشت؛ یک بار دیگر بزنید.' : ''}`;
}

export function StorefrontRedirectsSection({ canManage }: { canManage: boolean }) {
  const [filter, setFilter] = useState<StorefrontRedirectFilter>({ page: 1, q: '', source: '' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StorefrontRedirectRow | 'new' | null>(null);
  const [lastImport, setLastImport] = useState<StorefrontRedirectImportResult | null>(null);
  const list = useStorefrontRedirectsQuery(filter);
  const toggle = useToggleStorefrontRedirectMutation();
  const remove = useDeleteStorefrontRedirectMutation();
  const importer = useImportStorefrontRedirectsMutation();
  const page = list.data;
  const pages = page ? Math.max(1, Math.ceil(page.total / STOREFRONT_REDIRECTS_PAGE_SIZE)) : 1;

  const runImport = () => {
    importer.mutate(undefined, {
      onSuccess: (result) => { setLastImport(result); toast.success('نشانی‌های ووکامرس خوانده شد.'); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const askRemove = async (row: StorefrontRedirectRow) => {
    const ok = await confirmAction({
      title: 'حذف انتقال نشانی',
      message: `انتقال «${row.fromPath}» حذف شود؟ خواندن دوبارهٔ ووکامرس آن را برنمی‌گرداند.`,
      confirmText: 'حذف',
    });
    if (!ok) return;
    remove.mutate({ id: row.id, version: row.version }, {
      onSuccess: () => toast.success('انتقال نشانی حذف شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <section aria-label="انتقال نشانی‌های سایت قبلی" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <ArrowLeftRight className="w-4 h-4 text-cyan-600" />
          انتقال نشانی‌های سایت قبلی
          {page && <span className="text-xs font-bold text-slate-500">({formatPersianNumber(page.total)})</span>}
        </h3>
        {canManage && editing === null && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={runImport} disabled={importer.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <DownloadCloud className="w-4 h-4" />
              {importer.isPending ? 'در حال خواندن…' : 'خواندن از ووکامرس'}
            </button>
            <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">
              <Plus className="w-4 h-4" />
              انتقال تازه
            </button>
          </div>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-500">
        نشانی‌های محصول، دسته و برچسب سایت ووکامرس پس از جابه‌جایی به صفحهٔ همان محصول یا فهرست در سایت تازه می‌روند (انتقال دائمی).
        نشانی قدیمی‌ای که اینجا نیست، اگر نشانی محصول باشد به جست‌وجوی سایت و اگر نشانی فروشگاه یا دسته باشد به فهرست محصولات می‌رود.
      </p>
      {lastImport && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-6 text-emerald-800">{importSummary(lastImport)}</p>}

      {editing !== null && <StorefrontRedirectEditor key={editing === 'new' ? 'new' : editing.id} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setFilter(f => ({ ...f, q: search, page: 1 })); }}>
          <Search className="pointer-events-none absolute start-2 top-2.5 w-4 h-4 text-slate-400" />
          <input aria-label="جست‌وجوی نشانی یا محصول" value={search} onChange={e => setSearch(e.target.value)} placeholder="نشانی قدیمی یا محصول"
            className="rounded-xl border border-slate-200 bg-slate-50 py-2 ps-8 pe-3 text-sm" />
        </form>
        <div role="group" aria-label="پالایش منبع" className="flex rounded-xl border border-slate-200 p-0.5">
          {SOURCE_FILTERS.map(f => (
            <button key={f.label} type="button" aria-pressed={filter.source === f.value} onClick={() => setFilter(x => ({ ...x, source: f.value, page: 1 }))}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${filter.source === f.value ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {list.isError && <p className="text-xs text-rose-700">{errorMessageOf(list.error)}</p>}
      {page && page.data.length === 0 && <p className="text-xs text-slate-500">هنوز انتقالی نیست. «خواندن از ووکامرس» نشانی‌های محصولات پیوندخورده را می‌سازد.</p>}

      {page && page.data.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {page.data.map(row => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0 space-y-0.5">
                <p dir="ltr" className="truncate text-start font-mono text-xs text-slate-800">{row.fromPath}</p>
                <p className="text-xs text-slate-600">
                  به {REDIRECT_TARGET_KIND_TITLES[row.targetKind]}: <span className="font-bold">{targetText(row)}</span>
                  {row.targetKind === 'product' && !row.targetSlug && <span className="ms-2 text-amber-700">منتشرنشده، منتظر</span>}
                </p>
                <p className="text-xs text-slate-400">
                  {REDIRECT_SOURCE_TITLES[row.source]}
                  {row.note && <span>، {row.note}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {row.isActive ? 'روشن' : 'خاموش'}
                </span>
                {canManage && (
                  <>
                    <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: row.id, active: !row.isActive, version: row.version }, { onError: (err) => toast.error(errorMessageOf(err)) })}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                      {row.isActive ? 'خاموش کن' : 'روشن کن'}
                    </button>
                    <button type="button" aria-label={`ویرایش ${row.fromPath}`} onClick={() => setEditing(row)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                    <button type="button" aria-label={`حذف ${row.fromPath}`} onClick={() => { void askRemove(row); }} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {page && pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button type="button" disabled={filter.page <= 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))} className="rounded-lg border border-slate-300 px-2.5 py-1 font-bold disabled:opacity-40">قبلی</button>
          <span className="text-slate-600">صفحه {formatPersianNumber(filter.page)} از {formatPersianNumber(pages)}</span>
          <button type="button" disabled={filter.page >= pages} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))} className="rounded-lg border border-slate-300 px-2.5 py-1 font-bold disabled:opacity-40">بعدی</button>
        </div>
      )}
    </section>
  );
}
