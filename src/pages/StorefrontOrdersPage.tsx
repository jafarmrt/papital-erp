import { useState } from 'react';
import { ShoppingBag, Search } from 'lucide-react';
import { STOREFRONT_ORDERS_PAGE_SIZE, useStorefrontOrdersQuery, type StorefrontOrderFilter } from '../hooks/queries/useStorefrontQueries';
import { useRialDisplay } from '../hooks/useAppCurrency';
import { useHasPermission } from '../contexts/AuthContext';
import { ORDER_STATUS_TITLES } from '../lib/storefront/storefrontOrderRules';
import { StorefrontOrderDetail } from '../components/storefront/StorefrontOrderDetail';
import { ORDER_STATUS_TONES } from '../components/storefront/storefrontOrderTones';
import { formatPersianCode, formatPersianNumber } from '../utils/persianNumber';
import { formatPersianDateTime } from '../utils/dateUtils';
import { errorMessageOf } from '../utils';

/**
 * v11 phase 8.2a (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §5): the orders of the new site. Built for the phone
 * first: one card per order, a status bar that scrolls sideways, and the order opening as a full-screen sheet with its
 * receipts and the next step at the bottom within thumb reach. «باز» (the default) is what needs a colleague now.
 */
const FILTERS: Array<{ value: StorefrontOrderFilter['status']; label: string }> = [
  { value: 'open', label: 'باز' },
  { value: 'payment_submitted', label: ORDER_STATUS_TITLES.payment_submitted },
  { value: 'awaiting_payment', label: ORDER_STATUS_TITLES.awaiting_payment },
  { value: 'paid', label: ORDER_STATUS_TITLES.paid },
  { value: 'shipped', label: ORDER_STATUS_TITLES.shipped },
  { value: 'delivered', label: ORDER_STATUS_TITLES.delivered },
  { value: 'cancelled', label: ORDER_STATUS_TITLES.cancelled },
  { value: '', label: 'همه' },
];

export default function StorefrontOrdersPage() {
  const rial = useRialDisplay();
  const canManage = useHasPermission('site_orders.manage');
  const [filter, setFilter] = useState<StorefrontOrderFilter>({ page: 1, q: '', status: 'open' });
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const orders = useStorefrontOrdersQuery(filter);
  const page = orders.data;
  const pages = page ? Math.max(1, Math.ceil(page.total / STOREFRONT_ORDERS_PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <ShoppingBag className="h-5 w-5 text-violet-600" />
          سفارش‌های سایت
          {page && <span className="text-xs font-bold text-slate-500">({formatPersianNumber(page.total)})</span>}
        </h1>
        <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); setFilter(f => ({ ...f, q: search, page: 1 })); }}>
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
          <input type="search" inputMode="search" enterKeyHint="search" aria-label="جست‌وجوی شماره سفارش، نام یا همراه" value={search}
            onChange={e => setSearch(e.target.value)} placeholder="شماره سفارش، نام یا همراه"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 ps-9 pe-3 text-base sm:text-sm" />
        </form>
      </header>

      <div role="group" aria-label="وضعیت سفارش" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map(f => (
          <button key={f.value || 'all'} type="button" aria-pressed={filter.status === f.value}
            onClick={() => setFilter(x => ({ ...x, status: f.value, page: 1 }))}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold ${filter.status === f.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {orders.isLoading && <p className="text-sm text-slate-500">در حال خواندن…</p>}
      {orders.isError && <p className="text-sm text-rose-700">{errorMessageOf(orders.error)}</p>}
      {page && page.data.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">سفارشی با این شرط‌ها نیست.</p>
      )}

      {page && page.data.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {page.data.map(row => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpenId(row.id)}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-start shadow-sm active:bg-slate-50 hover:border-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-slate-800" dir="ltr">#{formatPersianCode(row.number)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ORDER_STATUS_TONES[row.status]}`}>{ORDER_STATUS_TITLES[row.status]}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-700">{row.recipientName} · {row.city}</span>
                  <span className="shrink-0 font-bold text-slate-800">{rial.number(row.payableAmount)} <span className="text-xs text-slate-500">{rial.label}</span></span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{formatPersianDateTime(row.createdAt)}</span>
                  {row.hasPendingReceipt && <span className="font-bold text-amber-700">رسید در انتظار بررسی</span>}
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

      {openId !== null && <StorefrontOrderDetail id={openId} canManage={canManage} onClose={() => setOpenId(null)} />}
    </div>
  );
}
