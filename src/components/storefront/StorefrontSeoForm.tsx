import { useEffect, useId, useState } from 'react';
import { BarChart3, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSaveStorefrontSeoMutation, useStorefrontSeoQuery } from '../../hooks/queries/useStorefrontSeoQueries';
import type { StorefrontSeoSettingsInput, StorefrontSeoSettingsView } from '../../lib/storefront/storefrontSeoContracts';
import { ANALYTICS_PROVIDERS, ANALYTICS_PROVIDER_TITLES, seoSettingsError, type AnalyticsProvider } from '../../lib/storefront/storefrontSeoRules';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.5: how the site meets search engines and visit statistics: the verification codes of Google Search Console
 * and Bing, the statistics service (off by default; the site then loads nothing from another site) and the brand's site
 * in another language. A group of its own, saved under its own version.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';

const formOf = (view: StorefrontSeoSettingsView): StorefrontSeoSettingsInput => ({ ...view });

export function StorefrontSeoSection({ canManage }: { canManage: boolean }) {
  const seo = useStorefrontSeoQuery();
  if (seo.isLoading) return <p className="text-xs text-slate-500">در حال خواندن…</p>;
  if (seo.isError || !seo.data) return <p className="text-xs text-rose-700">{errorMessageOf(seo.error)}</p>;
  return <StorefrontSeoForm view={seo.data} canManage={canManage} />;
}

function StorefrontSeoForm({ view, canManage }: { view: StorefrontSeoSettingsView; canManage: boolean }) {
  const id = useId();
  const save = useSaveStorefrontSeoMutation();
  const [form, setForm] = useState<StorefrontSeoSettingsInput>(() => formOf(view));
  useEffect(() => { setForm(formOf(view)); }, [view]);
  const set = <K extends keyof StorefrontSeoSettingsInput>(key: K, value: StorefrontSeoSettingsInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const problem = seoSettingsError(form);

  const submit = () => {
    save.mutate(form, {
      onSuccess: () => toast.success('تنظیمات جست‌وجو و آمار بازدید ذخیره شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (canManage && !problem) submit(); }}>
      <fieldset disabled={!canManage || save.isPending} className="space-y-5">
        <section aria-label="تأیید مالکیت در موتورهای جست‌وجو" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">تأیید مالکیت سایت در موتورهای جست‌وجو</h3>
          <p className={hint}>
            در کنسول جست‌وجوی گوگل و ابزار وب‌مستر بینگ، تأیید با «برچسب» را برگزینید و فقط کد درون آن را (میان دو نشانهٔ نقل‌قول) اینجا بنویسید. سایت آن را در همهٔ صفحه‌ها می‌گذارد.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-google`} className={label}>کد تأیید گوگل</label>
              <input id={`${id}-google`} dir="ltr" autoComplete="off" className={field} value={form.googleVerification} onChange={e => set('googleVerification', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-bing`} className={label}>کد تأیید بینگ</label>
              <input id={`${id}-bing`} dir="ltr" autoComplete="off" className={field} value={form.bingVerification} onChange={e => set('bingVerification', e.target.value)} />
            </div>
          </div>
        </section>

        <section aria-label="آمار بازدید" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
            <BarChart3 className="w-4 h-4 text-cyan-600" />
            آمار بازدید
          </h3>
          <p className={hint}>
            تا وقتی خاموش است، سایت هیچ اسکریپتی از سایت دیگری بار نمی‌کند. روی نشانی آزمایشی و پیش‌نمایش هم آمار بار نمی‌شود، فقط روی سایت اصلی.
          </p>
          <div role="radiogroup" aria-label="سرویس آمار بازدید" className="flex flex-wrap gap-2">
            {ANALYTICS_PROVIDERS.map(p => (
              <label key={p} className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold ${form.analyticsProvider === p ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>
                <input type="radio" className="sr-only" name={`${id}-provider`} checked={form.analyticsProvider === p} onChange={() => set('analyticsProvider', p as AnalyticsProvider)} />
                {ANALYTICS_PROVIDER_TITLES[p]}
              </label>
            ))}
          </div>
          {form.analyticsProvider === 'ga4' && (
            <div className="max-w-sm">
              <label htmlFor={`${id}-ga`} className={label}>شناسهٔ اندازه‌گیری</label>
              <input id={`${id}-ga`} dir="ltr" autoComplete="off" placeholder="G-…" className={field} value={form.analyticsId} onChange={e => set('analyticsId', e.target.value)} />
              <p className={hint}>در گوگل آنالیتیکس: مدیریت ← جریان‌های داده ← وب.</p>
            </div>
          )}
          {form.analyticsProvider === 'matomo' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor={`${id}-matomo-url`} className={label}>نشانی سرور ماتومو</label>
                <input id={`${id}-matomo-url`} dir="ltr" autoComplete="off" placeholder="https://" className={field} value={form.analyticsUrl} onChange={e => set('analyticsUrl', e.target.value)} />
              </div>
              <div>
                <label htmlFor={`${id}-matomo-id`} className={label}>شناسهٔ سایت در ماتومو</label>
                <input id={`${id}-matomo-id`} dir="ltr" inputMode="numeric" autoComplete="off" className={field} value={form.analyticsId} onChange={e => set('analyticsId', e.target.value)} />
              </div>
            </div>
          )}
        </section>

        <section aria-label="سایت زبان دیگر" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">سایت برند به زبان دیگر</h3>
          <p className={hint}>
            اگر پر شود، صفحهٔ اصلی به موتورهای جست‌وجو می‌گوید که این سایت نسخهٔ فارسی برند است و آن سایت نسخهٔ زبان دیگر، تا هر کدام به جست‌وجوکنندهٔ زبان خودش نشان داده شود.
          </p>
          <div className="max-w-md">
            <label htmlFor={`${id}-alt`} className={label}>نشانی سایت</label>
            <input id={`${id}-alt`} dir="ltr" autoComplete="off" placeholder="https://" className={field} value={form.alternateSiteUrl} onChange={e => set('alternateSiteUrl', e.target.value)} />
          </div>
        </section>
      </fieldset>
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      {canManage && (
        <button type="submit" disabled={save.isPending || Boolean(problem)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Save className="w-4 h-4" />
          {save.isPending ? 'در حال ذخیره…' : 'ذخیره'}
        </button>
      )}
    </form>
  );
}
