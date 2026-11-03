import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Handshake } from 'lucide-react';
import { BUYERS_PAGE_SIZE, useBuyersQuery, type BuyerFilter } from '../hooks/queries/useStorefrontBuyerQueries';
import { useHasPermission } from '../contexts/AuthContext';
import { BUYER_LIST_FILTERS, BUYER_LIST_FILTER_TITLES } from '../lib/storefront/storefrontBuyerRules';
import { StorefrontBuyerDetail } from '../components/storefront/StorefrontBuyerDetail';
import { BuyerStatusChip } from '../components/storefront/BuyerStatusChip';
import { formatPersianNumber, formatPersianCode } from '../utils/persianNumber';
import { formatPersianDateTime } from '../utils/dateUtils';
import { errorMessageOf } from '../utils';

/**
 * v11 phase 8.2b (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6): the buyer accounts of the new site. Built for the
 * phone first, like «سفارش‌های سایت»: one card per account, a filter bar that scrolls sideways, and the account opening
 * as a sheet with approval and the set-password link. «درخواست‌های تازه» (the default) is what needs a colleague now.
 */
export default function StorefrontBuyersPage() {
  const canManage = useHasPermission('site_buyers.manage');
  const [filter, setFilter] = useState<BuyerFilter>({ page: 1, q: '', filter: 'pending' });
  const [search, setSearch] = useState('');
  // a notification opens its account: /site-buyers?id=<account>
  const [params, setParams] = useSearchParams();
  const linked = Number(params.get('id'));
  const openId = Number.isInteger(linked) && linked > 0 ? linked : null;
  const setOpenId = (id: number | null) => setParams(id === null ? {} : { id: String(id) }, { replace: true });
  const buyers = useBuyersQuery(filter);
  const page = buyers.data;
  const pages = page ? Math.max(1, Math.ceil(page.total / BUYERS_PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <Handshake className="h-5 w-5 text-violet-600" />
          خریداران سایت
          {page && <span className="text-xs font-bold text-slate-500">({formatPersianNumber(page.total)})</span>}
        </h1>
        <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); setFilter(f => ({ ...f, q: search, page: 1 })); }}>
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
          <input type="search" inputMode="search" enterKeyHint="search" aria-label="جست‌وجوی نام، فروشگاه، شهر یا همراه" value={search}
            onChange={e => setSearch(e.target.value)} placeholder="نام، فروشگاه، شهر یا همراه"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 ps-9 pe-3 text-base sm:text-sm" />
        </form>
      </header>

      <div role="group" aria-label="نوع حساب" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {BUYER_LIST_FILTERS.map(f => (
          <button key={f} type="button" aria-pressed={filter.filter === f} onClick={() => setFilter(x => ({ ...x, filter: f, page: 1 }))}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold ${filter.filter === f ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
            {BUYER_LIST_FILTER_TITLES[f]}
          </button>
        ))}
      </div>

      {buyers.isLoading && <p className="text-sm text-slate-500">در حال خواندن…</p>}
      {buyers.isError && <p className="text-sm text-rose-700">{errorMessageOf(buyers.error)}</p>}
      {page && page.data.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">حسابی با این شرط‌ها نیست.</p>
      )}

      {page && page.data.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {page.data.map(row => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpenId(row.id)}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-start shadow-sm active:bg-slate-50 hover:border-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-black text-slate-800">{row.companyName || row.name}</span>
                  <BuyerStatusChip status={row.status} application={row.applicationStatus} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm text-slate-600">
                  <span className="truncate">{row.companyName ? `${row.name} · ` : ''}{row.city || '—'}</span>
                  <span dir="ltr" className="shrink-0">{formatPersianCode(row.phone)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{formatPersianDateTime(row.appliedAt ?? row.createdAt)}</span>
                  {row.groupTitle && <span className="font-bold text-violet-700">{row.groupTitle}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {page && pages > 1 && (
        <nav aria-label="صفحه‌ها" className="flex items-center justify-center gap-2 text-sm">
          <button type="button" disabled={filter.page <= 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))} className="rounded-xl border border-slate-300 px-4 py-2 font-bold disabled:opacity-40">قبلی</button>
          <span className="text-slate-600">صفحه {formatPersianNumber(filter.page)} از {formatPersianNumber(pages)}</span>
          <button type="button" disabled={filter.page >= pages} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))} className="rounded-xl border border-slate-300 px-4 py-2 font-bold disabled:opacity-40">بعدی</button>
        </nav>
      )}

      {openId !== null && <StorefrontBuyerDetail id={openId} canManage={canManage} onClose={() => setOpenId(null)} />}
    </div>
  );
}
