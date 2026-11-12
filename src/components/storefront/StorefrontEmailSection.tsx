import { useEffect, useId, useState } from 'react';
import { Mail, Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import {
  useSaveStorefrontEmailSettingsMutation, useSendTestEmailMutation, useStorefrontEmailSettingsQuery,
} from '../../hooks/queries/useStorefrontEmailQueries';
import type { StorefrontEmailSettingsInput, StorefrontEmailSettingsView } from '../../lib/storefront/storefrontEmailContracts';
import {
  EMAIL_PORT_DEFAULT, EMAIL_SECURITY_MODES, EMAIL_SECURITY_PORTS, EMAIL_SECURITY_TITLES, type EmailSecurity,
} from '../../lib/storefront/storefrontEmailRules';
import { errorMessageOf } from '../../utils';

/**
 * v12 phase 8e (owner's decision 7): the site's email: the shop's mail server (its name, port, encryption, user name and
 * write-only password), the sender, on or off, and a test mail. Until the settings are whole and on, the site sends no
 * email and offers no email sign-in. A mail never carries an amount or another person's name.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';

const formOf = (view: StorefrontEmailSettingsView): StorefrontEmailSettingsInput => ({
  enabled: view.enabled, host: view.host, port: view.port, security: view.security, username: view.username, password: '', clearPassword: false,
  fromAddress: view.fromAddress, fromName: view.fromName, version: view.version,
});

function EmailSettingsForm({ view, canManage }: { view: StorefrontEmailSettingsView; canManage: boolean }) {
  const id = useId();
  const save = useSaveStorefrontEmailSettingsMutation();
  const [form, setForm] = useState<StorefrontEmailSettingsInput>(() => formOf(view));
  useEffect(() => { setForm(formOf(view)); }, [view]);
  const set = <K extends keyof StorefrontEmailSettingsInput>(key: K, value: StorefrontEmailSettingsInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const serverChanged = view.password.configured && (form.host.trim().toLowerCase() !== view.host || form.username.trim() !== view.username);

  const submit = () => {
    save.mutate(form, {
      onSuccess: () => toast.success('تنظیمات ایمیل ذخیره شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (canManage) submit(); }}>
      <fieldset disabled={!canManage || save.isPending} className="space-y-5">
        <section aria-label="روشن بودن ایمیل" className={`rounded-2xl border p-5 space-y-2 ${form.enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
          <label className="inline-flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
            سایت به خریداران ایمیل بفرستد
          </label>
          <p className={hint}>
            تا وقتی خاموش است یا تنظیمات پایین کامل نیست، سایت ایمیلی نمی‌فرستد و ورود با ایمیل را نشان نمی‌دهد. ایمیل آزمایشی پایین همین صفحه حتی در حالت خاموش کار می‌کند تا پیش از روشن کردن، سرور ایمیل را بیازمایید.
          </p>
          <p className={`text-xs font-bold ${view.ready ? 'text-emerald-700' : 'text-slate-600'}`}>{view.ready ? 'ایمیل سایت اکنون روشن و آماده است.' : 'ایمیل سایت اکنون فرستاده نمی‌شود.'}</p>
        </section>

        <section aria-label="سرور ایمیل" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">سرور ایمیل</h3>
          <p className={hint}>این مقدارها را از سرویس ایمیل یا میزبان سایت خود بگیرید.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-host`} className={label}>نام سرور</label>
              <input id={`${id}-host`} dir="ltr" className={field} value={form.host} autoComplete="off" onChange={e => set('host', e.target.value)} />
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <div>
                <label htmlFor={`${id}-port`} className={label}>درگاه</label>
                <DecimalInput id={`${id}-port`} className={field} grouped={false} value={form.port} min={1} max={65535} step={1}
                  onValueChange={v => set('port', Math.trunc(Number(v)) || EMAIL_PORT_DEFAULT)} />
              </div>
              <div>
                <label htmlFor={`${id}-security`} className={label}>رمزگذاری</label>
                <select id={`${id}-security`} className={field} value={form.security} onChange={e => { const mode = e.target.value as EmailSecurity; setForm(f => ({ ...f, security: mode, port: EMAIL_SECURITY_PORTS[mode] })); }}>
                  {EMAIL_SECURITY_MODES.map(m => <option key={m} value={m}>{EMAIL_SECURITY_TITLES[m]}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-user`} className={label}>نام کاربری</label>
              <input id={`${id}-user`} dir="ltr" className={field} value={form.username} autoComplete="off" onChange={e => set('username', e.target.value)} />
              <p className={hint}>اگر سرور بی ورود نامه می‌پذیرد، خالی بگذارید. با نام کاربری، یکی از دو رمزگذاری لازم است.</p>
              {form.username.trim() && form.security === 'none' && <p className="mt-1 text-xs text-rose-700">نام کاربری و رمز بی رمزگذاری فرستاده نمی‌شود؛ یکی از دو رمزگذاری را برگزینید.</p>}
            </div>
            <div>
              <label htmlFor={`${id}-password`} className={label}>رمز</label>
              <input id={`${id}-password`} dir="ltr" type="password" autoComplete="new-password" className={field} value={form.password}
                placeholder={view.password.configured ? 'ذخیره شده' : ''} onChange={e => set('password', e.target.value)} />
              <p className={hint}>{view.password.configured ? 'برای نگه داشتن رمز کنونی خالی بگذارید.' : ''} رمز به‌صورت رمزنگاری‌شده ذخیره می‌شود و دیگر نشان داده نمی‌شود.</p>
              {serverChanged && !form.password && !form.clearPassword && <p className="mt-1 text-xs text-amber-800">رمز ذخیره‌شده مال سرور یا نام کاربری پیشین است؛ رمز تازه را هم وارد کنید.</p>}
              {view.password.configured && !view.password.readable && <p className="mt-1 text-xs text-rose-700">رمز ذخیره‌شده با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ آن را دوباره وارد کنید.</p>}
              {!view.secretsKeyConfigured && <p className="mt-1 text-xs text-rose-700">کلید رمزنگاری سرور تنظیم نشده است و تا آن زمان رمز ذخیره نمی‌شود.</p>}
              {view.password.configured && (
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={form.clearPassword} onChange={e => set('clearPassword', e.target.checked)} />
                  پاک کردن رمز ذخیره‌شده
                </label>
              )}
            </div>
          </div>
        </section>

        <section aria-label="فرستنده" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">فرستنده</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-from`} className={label}>نشانی فرستنده</label>
              <input id={`${id}-from`} dir="ltr" type="email" className={field} value={form.fromAddress} onChange={e => set('fromAddress', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-from-name`} className={label}>نام فرستنده</label>
              <input id={`${id}-from-name`} className={field} value={form.fromName} placeholder="پاپیتال گالری" onChange={e => set('fromName', e.target.value)} />
            </div>
          </div>
          <p className={hint}>ایمیل‌های سایت فقط کد یک‌بارمصرف و خبر سفارش را می‌برند؛ در هیچ‌کدام مبلغ یا نام کسی نمی‌آید.</p>
        </section>
      </fieldset>
      {canManage && (
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Save className="w-4 h-4" />
          ذخیرهٔ تنظیمات ایمیل
        </button>
      )}
    </form>
  );
}

function EmailTestCard() {
  const id = useId();
  const test = useSendTestEmailMutation();
  const [to, setTo] = useState('');
  const send = () => {
    test.mutate({ to }, {
      onSuccess: (result) => {
        if (result.sent) toast.success('ایمیل آزمایشی فرستاده شد.');
        else toast.error(result.error);
      },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };
  return (
    <section aria-label="ایمیل آزمایشی" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <h3 className="text-sm font-black text-slate-800">ایمیل آزمایشی</h3>
      <p className={hint}>یک ایمیل واقعی با تنظیمات ذخیره‌شده به نشانی‌ای که می‌نویسید می‌رود. اول تنظیمات را ذخیره کنید.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`${id}-to`} className={label}>نشانی ایمیل</label>
          <input id={`${id}-to`} dir="ltr" type="email" autoComplete="email" className={field} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <button type="button" disabled={test.isPending || !to.trim()} onClick={send}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Send className="w-4 h-4" />
          فرستادن
        </button>
      </div>
    </section>
  );
}

export function StorefrontEmailSection({ canManage }: { canManage: boolean }) {
  const settings = useStorefrontEmailSettingsQuery();
  return (
    <div className="space-y-5">
      <h3 className="flex items-center gap-2 text-base font-black text-slate-800">
        <Mail className="w-5 h-5 text-violet-600" />
        ایمیل سایت
      </h3>
      {settings.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {settings.isError && <p className="text-xs text-rose-700">{errorMessageOf(settings.error)}</p>}
      {settings.data && <EmailSettingsForm view={settings.data} canManage={canManage} />}
      {settings.data && canManage && <EmailTestCard />}
    </div>
  );
}
