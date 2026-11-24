import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHasPermission } from '../contexts/AuthContext';
import { useCreateFormMutation, useFormListQuery, useFormQuery } from '../hooks/queries/useStorefrontFormQueries';
import { FORM_KEY_MAX, FORM_TITLE_MAX, checkedForm, type FormTemplate } from '../lib/storefront/storefrontFormRules';
import { FormEditor } from '../components/storefront/forms/FormEditor';
import { errorMessageOf } from '../utils';
import { formatPersianNumber } from '../utils/persianNumber';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «فرم‌های سایت» of the sidebar's «فروشگاه سایت»: the
 * forms the shop builds for its site. `site_content.view` sees, `site_content.manage` changes; the open form is in the
 * address (`/site-forms?form=3`). A form is on the site only while its own switch is on (off for a new form).
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';

function NewFormForm({ full, onCreated }: { full: boolean; onCreated: (id: number) => void }) {
  const id = useId();
  const create = useCreateFormMutation();
  const [title, setTitle] = useState('');
  const [key, setKey] = useState('');
  const [template, setTemplate] = useState<FormTemplate | ''>('contact');
  const problem = title.trim() || key.trim() ? checkedForm({ title, key, fields: [] }, { forSite: false }).problem : null;
  const ready = !problem && Boolean(title.trim()) && Boolean(key.trim()) && !full;
  const submit = () => {
    create.mutate({ title, key: key.trim(), template: template || null }, {
      onSuccess: (detail) => { toast.success('فرم ساخته شد (خاموش).'); setTitle(''); setKey(''); onCreated(detail.id); },
      onError: err => toast.error(errorMessageOf(err)),
    });
  };
  return (
    <form aria-label="فرم تازه" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={(e) => { e.preventDefault(); if (ready && !create.isPending) submit(); }}>
      <h2 className="text-sm font-black text-slate-800">فرم تازه</h2>
      <fieldset disabled={create.isPending || full} className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor={`${id}-title`} className={label}>عنوان فرم</label>
          <input id={`${id}-title`} className={field} maxLength={FORM_TITLE_MAX} value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-key`} className={label}>نام لاتین</label>
          <input id={`${id}-key`} dir="ltr" className={field} maxLength={FORM_KEY_MAX} placeholder="contact" value={key} onChange={e => setKey(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-template`} className={label}>شروع از</label>
          <select id={`${id}-template`} className={field} value={template} onChange={e => setTemplate(e.target.value as FormTemplate | '')}>
            <option value="contact">الگوی «فرم تماس»</option>
            <option value="">فرم خالی</option>
          </select>
        </div>
      </fieldset>
      {full && <p className="text-xs text-amber-800">شمار فرم‌ها به سقف رسیده است؛ فرمی را که لازم نیست حذف کنید.</p>}
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      <button type="submit" disabled={create.isPending || !ready} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        <Plus className="h-4 w-4" />
        {create.isPending ? 'در حال ساختن…' : 'ساختن فرم'}
      </button>
    </form>
  );
}

export default function StorefrontFormsPage() {
  const canManage = useHasPermission('site_content.manage');
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('form'));
  const openId = Number.isInteger(asked) && asked > 0 ? asked : null;
  const list = useFormListQuery();
  const detail = useFormQuery(openId);
  const rows = Array.isArray(list.data?.data) ? list.data.data : [];
  const open = (id: number | null) => setParams(id === null ? {} : { form: String(id) }, { replace: false });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <ClipboardList className="h-5 w-5 text-violet-600" />
          فرم‌های سایت
        </h1>
        <p className="text-xs leading-6 text-slate-500">
          هر فرم عنوان، متن بالا، چند فیلد، نوشتهٔ دکمه و پیام پس از فرستادن دارد. فرم تازه خاموش است و تا کلید «این فرم روی سایت باشد» را روشن نکنید روی سایت نمی‌آید.
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>

      {openId === null ? (
        <>
          {list.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {list.isError && <p className="text-xs text-rose-700">{errorMessageOf(list.error)}</p>}
          {list.data && rows.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">هنوز فرمی ساخته نشده است.</p>}
          {rows.length > 0 && (
            <ul aria-label="فرم‌ها" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {rows.map(row => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{row.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      <span dir="ltr">{row.key}</span>
                      <span className="ms-2">{`${formatPersianNumber(row.fieldCount)} فیلد`}</span>
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{row.enabled ? 'روی سایت' : 'خاموش'}</span>
                  <button type="button" onClick={() => open(row.id)} aria-label={`${canManage ? 'ویرایش' : 'دیدن'} ${row.title}`}
                    className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
                    {canManage ? 'ویرایش' : 'دیدن'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canManage && list.data && <NewFormForm full={rows.length >= (list.data.max ?? 0)} onCreated={open} />}
        </>
      ) : (
        <>
          {detail.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {detail.isError && (
            <div className="space-y-2">
              <p className="text-xs text-rose-700">{errorMessageOf(detail.error)}</p>
              <button type="button" onClick={() => open(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">همهٔ فرم‌ها</button>
            </div>
          )}
          {detail.data && <FormEditor key={detail.data.id} detail={detail.data} canManage={canManage} onBack={() => open(null)} onDeleted={() => open(null)} />}
        </>
      )}
    </div>
  );
}
