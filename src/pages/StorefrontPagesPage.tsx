import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHasPermission } from '../contexts/AuthContext';
import { useMenuLinkOptionsQuery } from '../hooks/queries/useStorefrontMenuQueries';
import { useCreatePageMutation, usePageQuery, usePagesQuery } from '../hooks/queries/useStorefrontPageQueries';
import { PAGE_STATUS_TITLES } from '../lib/storefront/storefrontPageContracts';
import { PAGE_SLUG_MAX, PAGE_TEMPLATES, PAGE_TITLE_MAX, checkedPage, fixedPageOf, isPageTemplateKey, type PageTemplateKey } from '../lib/storefront/storefrontPageRules';
import { PageEditor } from '../components/storefront/pages/PageEditor';
import { errorMessageOf } from '../utils';

/**
 * v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «صفحه‌های سایت» of the sidebar's «فروشگاه سایت»: the five
 * base pages of the site and the pages a colleague makes, each built from ready sections. `site_content.view` sees,
 * `site_content.manage` changes; the open page is in the address (`/site-pages?page=12`).
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';

function NewPageForm({ onCreated }: { onCreated: (id: number) => void }) {
  const id = useId();
  const create = useCreatePageMutation();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState<PageTemplateKey | ''>('');
  const problem = title.trim() || slug.trim() ? checkedPage({ title, slug, sections: [] }, { forPublish: false, baseSlug: null }).problem : null;
  const submit = () => {
    create.mutate({ title, slug: slug.trim(), template: template || null }, {
      onSuccess: (detail) => { toast.success('صفحه ساخته شد (پیش‌نویس).'); setTitle(''); setSlug(''); setTemplate(''); onCreated(detail.id); },
      onError: err => toast.error(errorMessageOf(err)),
    });
  };
  return (
    <form aria-label="صفحهٔ تازه" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={(e) => { e.preventDefault(); if (!problem && title.trim() && slug.trim()) submit(); }}>
      <h2 className="text-sm font-black text-slate-800">صفحهٔ تازه</h2>
      <fieldset disabled={create.isPending} className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor={`${id}-title`} className={label}>عنوان صفحه</label>
          <input id={`${id}-title`} className={field} maxLength={PAGE_TITLE_MAX} value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-slug`} className={label}>نشانی لاتین</label>
          <input id={`${id}-slug`} dir="ltr" className={field} maxLength={PAGE_SLUG_MAX} placeholder="our-story" value={slug} onChange={e => setSlug(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-template`} className={label}>شروع از الگو</label>
          <select id={`${id}-template`} className={field} value={template} onChange={e => setTemplate(isPageTemplateKey(e.target.value) ? e.target.value : '')}>
            <option value="">صفحهٔ خالی</option>
            {PAGE_TEMPLATES.map(t => <option key={t.key} value={t.key}>{`چیدمان «${t.title}» سایت قبلی`}</option>)}
          </select>
        </div>
      </fieldset>
      <p className="text-xs leading-6 text-slate-500">الگو چیدمان و تیترهای همان صفحهٔ سایت قبلی را می‌آورد و جای عکس‌ها و متن‌ها را خالی می‌گذارد. صفحهٔ تازه پیش‌نویس است و تا «انتشار» روی سایت نمی‌آید.</p>
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      <button type="submit" disabled={create.isPending || Boolean(problem) || !title.trim() || !slug.trim()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        <Plus className="h-4 w-4" />
        {create.isPending ? 'در حال ساختن…' : 'ساختن صفحه'}
      </button>
    </form>
  );
}

export default function StorefrontPagesPage() {
  const canManage = useHasPermission('site_content.manage');
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('page'));
  const openId = Number.isInteger(asked) && asked > 0 ? asked : null;
  const pages = usePagesQuery();
  const detail = usePageQuery(openId);
  const options = useMenuLinkOptionsQuery();
  const rows = Array.isArray(pages.data) ? pages.data : [];
  const open = (id: number | null) => setParams(id === null ? {} : { page: String(id) }, { replace: false });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <FileText className="h-5 w-5 text-violet-600" />
          صفحه‌های سایت
        </h1>
        <p className="text-xs leading-6 text-slate-500">
          هر صفحه از بخش‌های آماده ساخته می‌شود. ذخیرهٔ پیش‌نویس سایت را عوض نمی‌کند؛ صفحه با «انتشار» روی سایت می‌رود. صفحه‌های پایه تا منتشر نشده‌اند، سایت متن ثابت پیشین خودش را برای آن‌ها نشان می‌دهد.
          {' صفحه‌های ثابت (مانند «سبد خرید») کارشان در خود سایت است؛ این‌جا فقط عنوان، متن بالای صفحه و عنوان و توضیح جست‌وجوی آن‌ها نوشته می‌شود.'}
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>

      {openId === null ? (
        <>
          {pages.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {pages.isError && <p className="text-xs text-rose-700">{errorMessageOf(pages.error)}</p>}
          <ul aria-label="صفحه‌ها" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {rows.map(row => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{row.title}</p>
                  <p dir="ltr" className="truncate text-end text-xs text-slate-500">{row.kind === 'home' ? '/' : row.kind === 'base' ? `/${row.slug}` : row.kind === 'fixed' ? (fixedPageOf(row.slug)?.path ?? '') : `/pages/${row.slug}`}</p>
                </div>
                {row.kind === 'home' && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">صفحهٔ اصلی سایت</span>}
                {row.kind === 'base' && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800">صفحهٔ پایه</span>}
                {row.kind === 'fixed' && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800">صفحهٔ ثابت</span>}
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
          {canManage && <NewPageForm onCreated={open} />}
        </>
      ) : (
        <>
          {detail.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {detail.isError && (
            <div className="space-y-2">
              <p className="text-xs text-rose-700">{errorMessageOf(detail.error)}</p>
              <button type="button" onClick={() => open(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">همهٔ صفحه‌ها</button>
            </div>
          )}
          {options.isError && <p className="text-xs text-amber-800">{`فهرست محصولات و کالکشن‌ها خوانده نشد: ${errorMessageOf(options.error)}`}</p>}
          {detail.data && <PageEditor key={detail.data.id} detail={detail.data} canManage={canManage} options={options.data} onBack={() => open(null)} onDeleted={() => open(null)} />}
        </>
      )}
    </div>
  );
}
