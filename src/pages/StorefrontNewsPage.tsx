import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Newspaper, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHasPermission } from '../contexts/AuthContext';
import { useCreateNewsMutation, useNewsListQuery, useNewsQuery } from '../hooks/queries/useStorefrontNewsQueries';
import { checkedNews } from '../lib/storefront/storefrontNewsRules';
import { PAGE_STATUS_TITLES } from '../lib/storefront/storefrontPageContracts';
import { PAGE_SLUG_MAX, PAGE_TITLE_MAX } from '../lib/storefront/storefrontPageRules';
import { NewsEditor } from '../components/storefront/news/NewsEditor';
import { errorMessageOf, formatPersianDate } from '../utils';
import { formatPersianNumber } from '../utils/persianNumber';

/**
 * v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «خبرهای سایت» of the sidebar's «فروشگاه سایت»: the news
 * items of the site, the newest day first. `site_content.view` sees, `site_content.manage` changes; the open item is in
 * the address (`/site-news?item=12`). The site does not show news yet: its pages come in the next part of 10d.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const pager = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';

function NewNewsForm({ onCreated }: { onCreated: (id: number) => void }) {
  const id = useId();
  const create = useCreateNewsMutation();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const problem = title.trim() || slug.trim() ? checkedNews({ title, slug, sections: [] }, { forPublish: false }).problem : null;
  const ready = !problem && Boolean(title.trim()) && Boolean(slug.trim());
  const submit = () => {
    create.mutate({ title, slug: slug.trim() }, {
      onSuccess: (detail) => { toast.success('خبر ساخته شد (پیش‌نویس).'); setTitle(''); setSlug(''); onCreated(detail.id); },
      onError: err => toast.error(errorMessageOf(err)),
    });
  };
  return (
    <form aria-label="خبر تازه" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={(e) => { e.preventDefault(); if (ready && !create.isPending) submit(); }}>
      <h2 className="text-sm font-black text-slate-800">خبر تازه</h2>
      <fieldset disabled={create.isPending} className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-title`} className={label}>عنوان خبر</label>
          <input id={`${id}-title`} className={field} maxLength={PAGE_TITLE_MAX} value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-slug`} className={label}>نشانی لاتین</label>
          <input id={`${id}-slug`} dir="ltr" className={field} maxLength={PAGE_SLUG_MAX} placeholder="new-collection" value={slug} onChange={e => setSlug(e.target.value)} />
        </div>
      </fieldset>
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      <button type="submit" disabled={create.isPending || !ready} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        <Plus className="h-4 w-4" />
        {create.isPending ? 'در حال ساختن…' : 'ساختن خبر'}
      </button>
    </form>
  );
}

export default function StorefrontNewsPage() {
  const canManage = useHasPermission('site_content.manage');
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('item'));
  const openId = Number.isInteger(asked) && asked > 0 ? asked : null;
  const [page, setPage] = useState(1);
  const list = useNewsListQuery(page);
  const detail = useNewsQuery(openId);
  const rows = Array.isArray(list.data?.data) ? list.data.data : [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (list.data?.pageSize ?? 50)));
  // the page being shown can end when its last item is removed (here or by a colleague): the list goes to its last page
  const lastPage = list.data && !list.isPlaceholderData ? pages : null;
  useEffect(() => { if (lastPage !== null && page > lastPage) setPage(lastPage); }, [lastPage, page]);
  const open = (id: number | null) => setParams(id === null ? {} : { item: String(id) }, { replace: false });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <Newspaper className="h-5 w-5 text-violet-600" />
          خبرهای سایت
        </h1>
        <p className="text-xs leading-6 text-slate-500">
          هر خبر عنوان، خلاصه، تصویر شاخص، تاریخ و متن دارد. ذخیرهٔ پیش‌نویس سایت را عوض نمی‌کند؛ خبر با «انتشار» آمادهٔ سایت می‌شود. بخش خبرهای خود سایت هنوز ساخته نشده است و در گام بعد می‌آید.
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>

      {openId === null ? (
        <>
          {list.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {list.isError && <p className="text-xs text-rose-700">{errorMessageOf(list.error)}</p>}
          {list.data && total === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">هنوز خبری ساخته نشده است.</p>}
          {rows.length > 0 && (
            <ul aria-label="خبرها" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {rows.map(row => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{row.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      <span dir="ltr">{`/news/${row.slug}`}</span>
                      {(row.publishedDate || row.newsDate) && <span className="ms-2">{formatPersianDate(row.publishedDate || row.newsDate)}</span>}
                    </p>
                  </div>
                  {row.scheduled && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800">در نوبت انتشار</span>}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.status === 'published' ? 'bg-emerald-50 text-emerald-800' : row.status === 'changed' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                    {PAGE_STATUS_TITLES[row.status]}
                  </span>
                  <button type="button" onClick={() => open(row.id)} aria-label={`${canManage ? 'ویرایش' : 'دیدن'} ${row.title}`}
                    className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                    {canManage ? 'ویرایش' : 'دیدن'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="صفحه‌های فهرست خبرها" className="flex items-center justify-center gap-2 text-xs text-slate-600">
              <button type="button" className={pager} disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</button>
              <span>{`صفحهٔ ${formatPersianNumber(page)} از ${formatPersianNumber(pages)}`}</span>
              <button type="button" className={pager} disabled={page >= pages} onClick={() => setPage(page + 1)}>بعدی</button>
            </nav>
          )}
          {canManage && <NewNewsForm onCreated={open} />}
        </>
      ) : (
        <>
          {detail.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {detail.isError && (
            <div className="space-y-2">
              <p className="text-xs text-rose-700">{errorMessageOf(detail.error)}</p>
              <button type="button" onClick={() => open(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">همهٔ خبرها</button>
            </div>
          )}
          {detail.data && <NewsEditor key={detail.data.id} detail={detail.data} canManage={canManage} onBack={() => open(null)} onDeleted={() => open(null)} />}
        </>
      )}
    </div>
  );
}
