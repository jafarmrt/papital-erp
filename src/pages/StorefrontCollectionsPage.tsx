import { useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { useHasPermission } from '../contexts/AuthContext';
import { useCollectionTextsQuery } from '../hooks/queries/useStorefrontCollectionQueries';
import { collectionTextShows } from '../lib/storefront/storefrontCollectionRules';
import { CollectionTextEditor } from '../components/storefront/collections/CollectionTextEditor';
import { errorMessageOf } from '../utils';
import { formatPersianNumber } from '../utils/persianNumber';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «کالکشن‌های سایت» of the sidebar's «فروشگاه سایت»: each
 * collection of the site with the words the shop writes for it (an introduction, an image, «آشنایی بیشتر»).
 * `site_content.view` sees, `site_content.manage` changes. A collection is a name on the items: it is made and filled
 * in the items' own screen, not here.
 */
export default function StorefrontCollectionsPage() {
  const canManage = useHasPermission('site_content.manage');
  const list = useCollectionTextsQuery();
  const rows = Array.isArray(list.data?.data) ? list.data.data : [];
  const pages = Array.isArray(list.data?.pages) ? list.data.pages : [];
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <LayoutGrid className="h-5 w-5 text-violet-600" />
          کالکشن‌های سایت
        </h1>
        <p className="text-xs leading-6 text-slate-500">
          برای هر کالکشن می‌توانید متن معرفی، یک تصویر و پیوند «آشنایی بیشتر» بنویسید؛ این‌ها بالای صفحهٔ همان کالکشن روی سایت می‌آیند. خود کالکشن‌ها از کالاها می‌آیند: هر کالکشنی که کالایی روی سایت دارد این‌جا هست.
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>
      {list.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {list.isError && <p className="text-xs text-rose-700">{errorMessageOf(list.error)}</p>}
      {list.data && rows.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">هنوز هیچ کالکشنی کالایی روی سایت ندارد.</p>}
      {rows.length > 0 && (
        <ul aria-label="کالکشن‌ها" className="space-y-3">
          {rows.map((row) => {
            const shown = open === row.name;
            return (
              <li key={row.name} className="rounded-2xl border border-slate-200 bg-white">
                <button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? null : row.name)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-start">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{row.name}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.count > 0 ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}`}>
                    {row.count > 0 ? `${formatPersianNumber(row.count)} کالا روی سایت` : 'اکنون کالایی روی سایت ندارد'}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${collectionTextShows(row) ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {collectionTextShows(row) ? 'متن یا تصویر دارد' : 'بی متن و تصویر'}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${shown ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {shown && (
                  <div className="border-t border-slate-100 p-4">
                    <CollectionTextEditor row={row} pages={pages} canManage={canManage} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
