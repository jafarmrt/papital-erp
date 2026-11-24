import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { useHasPermission } from '../contexts/AuthContext';
import { useMessageListQuery, useMessageQuery } from '../hooks/queries/useStorefrontMessageQueries';
import { MESSAGE_STATUSES, MESSAGE_STATUS_TITLES, isMessageStatus, type MessageStatus } from '../lib/storefront/storefrontMessageRules';
import { MessageView, statusChip } from '../components/storefront/messages/MessageView';
import { errorMessageOf } from '../utils';
import { formatPersianDateTime } from '../utils/dateUtils';
import { formatPersianNumber } from '../utils/persianNumber';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «پیام‌های سایت» of the sidebar's «فروشگاه سایت»: what
 * visitors sent through the forms of the site, the newest first, filtered and paged on the server. `site_messages.view`
 * sees, `site_messages.manage` sets a state and removes; the open message and the filter are in the address
 * (`/site-messages?status=new&message=12`).
 */
const pager = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';

export default function StorefrontMessagesPage() {
  const canManage = useHasPermission('site_messages.manage');
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('message'));
  const openId = Number.isInteger(asked) && asked > 0 ? asked : null;
  const askedStatus = params.get('status');
  const status: MessageStatus | null = isMessageStatus(askedStatus) ? askedStatus : null;
  const [page, setPage] = useState(1);
  const list = useMessageListQuery(page, status);
  const detail = useMessageQuery(openId);
  const rows = Array.isArray(list.data?.data) ? list.data.data : [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (list.data?.pageSize ?? 30)));
  // the page being shown can end when its last message is removed or changes state: the list goes to its last page
  const lastPage = list.data && !list.isPlaceholderData && !list.isFetching ? pages : null;
  useEffect(() => { if (lastPage !== null && page > lastPage) setPage(lastPage); }, [lastPage, page]);
  const go = (next: { message?: number | null; status?: MessageStatus | null }) => {
    const message = next.message === undefined ? openId : next.message;
    const filter = next.status === undefined ? status : next.status;
    setParams({ ...(filter ? { status: filter } : {}), ...(message ? { message: String(message) } : {}) }, { replace: false });
  };
  const counts = list.data?.counts;
  const all = counts ? MESSAGE_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : 0;
  const tab = (active: boolean) => `inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <Inbox className="h-5 w-5 text-violet-600" />
          پیام‌های سایت
        </h1>
        <p className="text-xs leading-6 text-slate-500">
          هر چه بازدیدکنندگان با فرم‌های سایت می‌فرستند این‌جا می‌آید. سایت به نشانی یا شماره‌ای که بازدیدکننده نوشته خودکار چیزی نمی‌فرستد؛ پاسخ با شماست.
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>

      {openId === null ? (
        <>
          <nav aria-label="وضعیت پیام‌ها" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={status === null} className={tab(status === null)} onClick={() => { setPage(1); go({ status: null }); }}>
              {`همه${counts ? ` (${formatPersianNumber(all)})` : ''}`}
            </button>
            {MESSAGE_STATUSES.map(s => (
              <button key={s} type="button" aria-pressed={status === s} className={tab(status === s)} onClick={() => { setPage(1); go({ status: s }); }}>
                {`${MESSAGE_STATUS_TITLES[s]}${counts ? ` (${formatPersianNumber(counts[s] ?? 0)})` : ''}`}
              </button>
            ))}
          </nav>
          {list.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {list.isError && <p className="text-xs text-rose-700">{errorMessageOf(list.error)}</p>}
          {list.data && total === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">
              {status ? `پیامی با وضعیت «${MESSAGE_STATUS_TITLES[status]}» نیست.` : 'هنوز پیامی از سایت نرسیده است.'}
            </p>
          )}
          {rows.length > 0 && (
            <ul aria-label="پیام‌ها" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {rows.map(row => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm text-slate-800 ${row.status === 'new' ? 'font-black' : 'font-bold'}`}>{row.formTitle}</p>
                    <p className="truncate text-xs text-slate-500">{row.preview}</p>
                    <p className="text-xs text-slate-400">{formatPersianDateTime(row.createdAt)}</p>
                  </div>
                  <span className={statusChip(row.status)}>{MESSAGE_STATUS_TITLES[row.status]}</span>
                  <button type="button" onClick={() => go({ message: row.id })} aria-label={`دیدن پیام ${formatPersianNumber(row.id)} از فرم ${row.formTitle}`}
                    className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                    دیدن
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="صفحه‌های فهرست پیام‌ها" className="flex items-center justify-center gap-2 text-xs text-slate-600">
              <button type="button" className={pager} disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</button>
              <span>{`صفحهٔ ${formatPersianNumber(Math.min(page, pages))} از ${formatPersianNumber(pages)}`}</span>
              <button type="button" className={pager} disabled={page >= pages} onClick={() => setPage(page + 1)}>بعدی</button>
            </nav>
          )}
        </>
      ) : (
        <>
          {detail.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {detail.isError && (
            <div className="space-y-2">
              <p className="text-xs text-rose-700">{errorMessageOf(detail.error)}</p>
              <button type="button" onClick={() => go({ message: null })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">همهٔ پیام‌ها</button>
            </div>
          )}
          {detail.data && <MessageView key={detail.data.id} detail={detail.data} canManage={canManage} onBack={() => go({ message: null })} onDeleted={() => go({ message: null })} />}
        </>
      )}
    </div>
  );
}
