import { useEffect, useId, useState } from 'react';
import { MessageSquareText, Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useSaveStorefrontSmsSettingsMutation, useSendTestSmsMutation, useStorefrontSmsLogQuery, useStorefrontSmsSettingsQuery,
} from '../../hooks/queries/useStorefrontSmsQueries';
import type { StorefrontSmsSettingsInput, StorefrontSmsSettingsView } from '../../lib/storefront/storefrontSmsContracts';
import {
  OTP_HOURLY_CAP_MAX, SMS_KINDS, SMS_KIND_PARAMS, SMS_KIND_TITLES, SMS_MESSAGE_STATUSES, SMS_MESSAGE_STATUS_TITLES, SMS_PROVIDERS,
  SMS_PROVIDER_TITLES, apiKeyError, suggestedTemplateText, templateIdError, type SmsKind, type SmsMessageStatus, type SmsProvider,
} from '../../lib/storefront/storefrontSmsRules';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.4a: the site's text messages to buyers: which service sends them, its key (write-only), the template of
 * each message (a message without a template is not sent), the site's hourly budget of login codes, a test of each
 * template to a number, and the log of what was sent. Every message is a template the provider approved; none carries an
 * amount or a name.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';

const formOf = (view: StorefrontSmsSettingsView): StorefrontSmsSettingsInput => ({
  enabled: view.enabled, provider: view.provider, apiKey: '', clearApiKey: false, templates: { ...view.templates },
  otpHourlyCap: view.otpHourlyCap, version: view.version,
});

const STATUS_TONE: Readonly<Record<SmsMessageStatus, string>> = {
  queued: 'bg-slate-100 text-slate-700',
  sending: 'bg-sky-50 text-sky-700',
  sent: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  skipped: 'bg-amber-50 text-amber-800',
};

function SmsSettingsForm({ view, canManage }: { view: StorefrontSmsSettingsView; canManage: boolean }) {
  const id = useId();
  const save = useSaveStorefrontSmsSettingsMutation();
  const [form, setForm] = useState<StorefrontSmsSettingsInput>(() => formOf(view));
  useEffect(() => { setForm(formOf(view)); }, [view]);
  const set = <K extends keyof StorefrontSmsSettingsInput>(key: K, value: StorefrontSmsSettingsInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const setTemplate = (kind: SmsKind, value: string) => setForm(f => ({ ...f, templates: { ...f.templates, [kind]: value } }));
  const keyProblem = apiKeyError(form.apiKey);

  const submit = () => {
    save.mutate(form, {
      onSuccess: () => toast.success('تنظیمات پیامک ذخیره شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (canManage) submit(); }}>
      <fieldset disabled={!canManage || save.isPending} className="space-y-5">
        <section aria-label="روشن بودن پیامک" className={`rounded-2xl border p-5 space-y-2 ${form.enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
          <label className="inline-flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
            سایت به خریداران پیامک بفرستد
          </label>
          <p className={hint}>
            تا وقتی خاموش است، هیچ پیامکی به خریداران نمی‌رود و ورود پیامکی در سایت دیده نمی‌شود. پیامک آزمایشی پایین همین صفحه حتی در حالت خاموش کار می‌کند تا پیش از روشن کردن، هر الگو را بیازمایید.
          </p>
        </section>

        <section aria-label="سرویس پیامک" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">سرویس پیامک</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-provider`} className={label}>سرویس</label>
              <select id={`${id}-provider`} className={field} value={form.provider} onChange={e => set('provider', e.target.value as SmsProvider)}>
                {SMS_PROVIDERS.map(p => <option key={p} value={p}>{SMS_PROVIDER_TITLES[p]}</option>)}
              </select>
              {form.provider !== view.provider && view.apiKey.configured && <p className="mt-1 text-xs text-amber-800">کلید ذخیره‌شده مال سرویس پیشین است؛ کلید سرویس تازه را هم وارد کنید.</p>}
            </div>
            <div>
              <label htmlFor={`${id}-key`} className={label}>کلید سرویس</label>
              <input id={`${id}-key`} dir="ltr" type="password" autoComplete="new-password" className={field} value={form.apiKey}
                placeholder={view.apiKey.configured ? `ذخیره شده: …${view.apiKey.hint}` : ''} onChange={e => set('apiKey', e.target.value)} />
              {form.apiKey && keyProblem && <p className="mt-1 text-xs text-rose-700">{keyProblem}</p>}
              <p className={hint}>
                {view.apiKey.configured ? 'برای نگه داشتن کلید کنونی خالی بگذارید.' : 'کلید را از پنل سرویس پیامک بردارید.'}
                {' '}کلید رمزشده ذخیره می‌شود و دیگر نشان داده نمی‌شود.
              </p>
              {view.apiKey.configured && !view.apiKey.readable && <p className="mt-1 text-xs text-rose-700">کلید ذخیره‌شده با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ آن را دوباره وارد کنید.</p>}
              {!view.secretsKeyConfigured && <p className="mt-1 text-xs text-rose-700">کلید رمزنگاری سرور تنظیم نشده است و تا آن زمان کلید سرویس ذخیره نمی‌شود.</p>}
              {view.apiKey.configured && (
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={form.clearApiKey} onChange={e => set('clearApiKey', e.target.checked)} />
                  پاک کردن کلید ذخیره‌شده
                </label>
              )}
            </div>
          </div>
        </section>

        <section aria-label="الگوهای پیامک" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-black text-slate-800">الگوهای پیامک</h3>
          <p className={hint}>
            هر پیامک خدماتی باید الگویی باشد که سرویس پیامک پیش‌تر تأییدش کرده است. متن پیشنهادی هر الگو را در پنل سرویس ثبت کنید و {form.provider === 'smsir' ? 'شمارهٔ الگو' : 'نام الگو'} را اینجا بنویسید. پیامکی که الگو ندارد فرستاده نمی‌شود. در هیچ پیامکی مبلغ یا نام خریدار نمی‌آید.
          </p>
          <div className="space-y-4">
            {SMS_KINDS.map(kind => {
              const value = form.templates[kind] ?? '';
              const problem = templateIdError(form.provider, value);
              return (
                <div key={kind} className="rounded-xl border border-slate-100 p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label htmlFor={`${id}-t-${kind}`} className="text-xs font-black text-slate-800">{SMS_KIND_TITLES[kind]}</label>
                    <span className="text-xs text-slate-500">
                      {form.provider === 'smsir' ? `پارامترها: ${SMS_KIND_PARAMS[kind].join('، ')}` : `پارامترها به ترتیب: ${SMS_KIND_PARAMS[kind].map((_, i) => (i === 0 ? 'token' : `token${i + 1}`)).join('، ')}`}
                    </span>
                  </div>
                  <input id={`${id}-t-${kind}`} dir="ltr" className={field} value={value} inputMode={form.provider === 'smsir' ? 'numeric' : 'text'}
                    placeholder={form.provider === 'smsir' ? 'شمارهٔ الگو' : 'نام الگو'} onChange={e => setTemplate(kind, e.target.value)} />
                  {value && problem && <p className="text-xs text-rose-700">{problem}</p>}
                  <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">{suggestedTemplateText(kind, form.provider)}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-label="سقف کد ورود" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
          <label htmlFor={`${id}-cap`} className={label}>بیشترین کد ورود در یک ساعت، برای کل سایت</label>
          <input id={`${id}-cap`} type="number" min={1} max={OTP_HOURLY_CAP_MAX} className={`${field} max-w-[10rem]`} value={form.otpHourlyCap}
            onChange={e => set('otpHourlyCap', Math.trunc(Number(e.target.value)) || 1)} />
          <p className={hint}>
            جلوی کسی را می‌گیرد که با شماره‌های بسیار، اعتبار پنل پیامک را خرج کند. هر شماره هم جدا در هر دقیقه یک کد، در ساعت {formatPersianNumber(5)} و در روز {formatPersianNumber(10)} کد بیشتر نمی‌گیرد.
          </p>
        </section>
      </fieldset>
      {canManage && (
        <button type="submit" disabled={save.isPending || Boolean(form.apiKey && keyProblem)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Save className="w-4 h-4" />
          ذخیرهٔ تنظیمات پیامک
        </button>
      )}
    </form>
  );
}

function SmsTestCard({ view }: { view: StorefrontSmsSettingsView }) {
  const id = useId();
  const test = useSendTestSmsMutation();
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<SmsKind>('otp');
  const send = () => {
    test.mutate({ phone, kind }, {
      onSuccess: (result) => {
        if (result.sent) toast.success('پیامک آزمایشی فرستاده شد.');
        else toast.error(`سرویس پیامک نفرستاد: ${result.error}`);
      },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };
  return (
    <section aria-label="پیامک آزمایشی" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <h3 className="text-sm font-black text-slate-800">پیامک آزمایشی</h3>
      <p className={hint}>یک پیامک واقعی با همان الگو و نمونهٔ مقدارها (کد ۱۲۳۴۵، سفارش ۱۰۰۰۰۱) به شماره‌ای که می‌نویسید می‌رود و در گزارش پایین با برچسب «آزمایشی» می‌آید. اول تنظیمات را ذخیره کنید.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`${id}-phone`} className={label}>شمارهٔ همراه</label>
          <input id={`${id}-phone`} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" className={field} value={phone} placeholder="۰۹…" onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className={label}>کدام پیامک</label>
          <select id={`${id}-kind`} className={field} value={kind} onChange={e => setKind(e.target.value as SmsKind)}>
            {SMS_KINDS.map(k => <option key={k} value={k} disabled={!view.templates[k]}>{SMS_KIND_TITLES[k]}{view.templates[k] ? '' : ' (بی الگو)'}</option>)}
          </select>
        </div>
        <button type="button" disabled={test.isPending || !phone.trim() || !view.templates[kind]} onClick={send}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Send className="w-4 h-4" />
          فرستادن
        </button>
      </div>
    </section>
  );
}

function SmsLog() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SmsMessageStatus | ''>('');
  const log = useStorefrontSmsLogQuery({ page, status });
  const rows = Array.isArray(log.data?.data) ? log.data.data : [];
  const total = log.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <section aria-label="گزارش پیامک‌ها" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-800">گزارش پیامک‌ها</h3>
        <select aria-label="وضعیت" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs" value={status} onChange={e => { setStatus(e.target.value as SmsMessageStatus | ''); setPage(1); }}>
          <option value="">همهٔ وضعیت‌ها</option>
          {SMS_MESSAGE_STATUSES.map(s => <option key={s} value={s}>{SMS_MESSAGE_STATUS_TITLES[s]}</option>)}
        </select>
      </div>
      {log.isError && <p className="text-xs text-rose-700">{errorMessageOf(log.error)}</p>}
      {!log.isLoading && rows.length === 0 && <p className="text-xs text-slate-500">هنوز پیامکی نیست.</p>}
      <ul className="divide-y divide-slate-100">
        {rows.map(r => (
          <li key={r.id} className="flex flex-col gap-1 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="font-bold text-slate-800">
                {SMS_KIND_TITLES[r.kind]}
                {r.orderNumber ? ` · سفارش ${formatPersianCode(r.orderNumber)}` : ''}
                {r.isTest ? ' · آزمایشی' : ''}
              </p>
              <p className="text-slate-500"><span dir="ltr">{formatPersianCode(r.phone)}</span> · {formatPersianDateTime(r.sentAt ?? r.createdAt)}</p>
              {r.error && <p className="text-rose-700">{r.error}</p>}
            </div>
            <span className={`self-start rounded-full px-2 py-0.5 font-bold sm:self-center ${STATUS_TONE[r.status]}`}>
              {SMS_MESSAGE_STATUS_TITLES[r.status]}{r.attempts > 1 ? ` (${formatPersianNumber(r.attempts)} بار)` : ''}
            </span>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">قبلی</button>
          <span>{formatPersianNumber(page)} از {formatPersianNumber(pages)}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">بعدی</button>
        </div>
      )}
    </section>
  );
}

export function StorefrontSmsSection({ canManage }: { canManage: boolean }) {
  const settings = useStorefrontSmsSettingsQuery();
  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 text-xs leading-6 text-slate-600">
        <MessageSquareText className="mt-1 w-4 h-4 shrink-0 text-violet-600" />
        پیامک‌های وضعیت سفارش و کد ورود سایت. پیامک‌های سفارش پس از ثبت هر تغییر، حداکثر تا نیم دقیقه بعد فرستاده می‌شوند.
      </p>
      {settings.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {settings.isError && <p className="text-xs text-rose-700">{errorMessageOf(settings.error)}</p>}
      {settings.data && <SmsSettingsForm view={settings.data} canManage={canManage} />}
      {settings.data && canManage && <SmsTestCard view={settings.data} />}
      <SmsLog />
    </div>
  );
}
