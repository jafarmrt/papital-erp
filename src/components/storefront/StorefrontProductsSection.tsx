import { useState } from 'react';
import { ImageOff, Package, Search } from 'lucide-react';
import { STOREFRONT_PRODUCTS_PAGE_SIZE, useStorefrontProductsQuery, type StorefrontProductFilter } from '../../hooks/queries/useStorefrontQueries';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import type { StorefrontProductAdminRow } from '../../lib/storefront/storefrontContracts';
import { PUBLISH_BLOCKER_MESSAGES } from '../../lib/storefront/storefrontRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { StorefrontProductEditor } from './StorefrontProductEditor';

/**
 * v11 phase 8.1: which finished products are on the site. Each row shows the retail price of the site's list, the cover,
 * the sellable stock of the site's warehouse and, when it cannot be published, why.
 */
const FILTERS: Array<{ value: StorefrontProductFilter['published']; label: string }> = [
  { value: 'all', label: 'همه' }, { value: 'published', label: 'روی سایت' }, { value: 'unpublished', label: 'منتشرنشده' },
];

export function StorefrontProductsSection({ canManage }: { canManage: boolean }) {
  const rial = useRialDisplay();
  const [filter, setFilter] = useState<StorefrontProductFilter>({ page: 1, q: '', published: 'all' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StorefrontProductAdminRow | null>(null);
  const products = useStorefrontProductsQuery(filter);
  const page = products.data;
  const pages = page ? Math.max(1, Math.ceil(page.total / STOREFRONT_PRODUCTS_PAGE_SIZE)) : 1;

  return (
    <section aria-label="کالاهای سایت" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <Package className="w-4 h-4 text-violet-600" />
          کالاهای سایت
          {page && <span className="text-xs font-bold text-slate-500">({formatPersianNumber(page.publishedCount)} کالا روی سایت)</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <form className="relative" onSubmit={(e) => { e.preventDefault(); setFilter(f => ({ ...f, q: search, page: 1 })); }}>
            <Search className="pointer-events-none absolute start-2 top-2.5 w-4 h-4 text-slate-400" />
            <input aria-label="جست‌وجوی کد یا نام کالا" value={search} onChange={e => setSearch(e.target.value)} placeholder="کد یا نام کالا"
              className="rounded-xl border border-slate-200 bg-slate-50 py-2 ps-8 pe-3 text-sm" />
          </form>
          <div role="group" aria-label="پالایش انتشار" className="flex rounded-xl border border-slate-200 p-0.5">
            {FILTERS.map(f => (
              <button key={f.value} type="button" aria-pressed={filter.published === f.value} onClick={() => setFilter(x => ({ ...x, published: f.value, page: 1 }))}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold ${filter.published === f.value ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {editing && <StorefrontProductEditor key={editing.itemId} row={editing} onClose={() => setEditing(null)} />}
      {products.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {products.isError && <p className="text-xs text-rose-700">{errorMessageOf(products.error)}</p>}
      {page && page.data.length === 0 && <p className="text-xs text-slate-500">کالایی با این شرط‌ها پیدا نشد.</p>}

      {page && page.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="p-2 text-start font-bold">کالا</th>
                <th className="p-2 text-start font-bold">قیمت تکی ({rial.label})</th>
                <th className="p-2 text-start font-bold">موجودی قابل فروش</th>
                <th className="p-2 text-start font-bold">وضعیت</th>
                <th className="p-2"><span className="sr-only">کار</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {page.data.map(row => (
                <tr key={row.itemId}>
                  <td className="p-2">
                    <p className="font-bold text-slate-800">{row.name}</p>
                    <p className="text-xs text-slate-500">
                      <span dir="ltr">{row.code}</span>
                      {!row.hasCover && <span className="ms-2 inline-flex items-center gap-1 text-amber-700"><ImageOff className="w-3 h-3" />بی تصویر شاخص</span>}
                    </p>
                  </td>
                  <td className="p-2">{row.retailPrice ? rial.number(row.retailPrice) : <span className="text-slate-400">ندارد</span>}</td>
                  <td className="p-2">{formatPersianNumber(row.sellable)}</td>
                  <td className="p-2">
                    {row.published
                      ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">روی سایت</span>
                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">منتشرنشده</span>}
                    {row.blocker && <p className="mt-1 text-xs text-amber-700">{PUBLISH_BLOCKER_MESSAGES[row.blocker]}</p>}
                  </td>
                  <td className="p-2 text-end">
                    {canManage && (
                      <button type="button" onClick={() => setEditing(row)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        {row.published ? 'ویرایش' : 'انتشار'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
