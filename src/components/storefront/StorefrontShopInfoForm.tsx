import { useEffect, useId, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSaveStorefrontShopInfoMutation, useStorefrontShopInfoQuery } from '../../hooks/queries/useStorefrontShopInfoQueries';
import type { StorefrontShopInfoInput, StorefrontShopInfoView } from '../../lib/storefront/storefrontShopInfoContracts';
import {
  SHOP_INFO_DEFAULTS, SHOP_SOCIALS, SHOP_SOCIAL_TITLES, defaultCopyright, shopInfoError, type ShopInfoField,
} from '../../lib/storefront/storefrontShopInfoRules';
import { errorMessageOf } from '../../utils';

/**
 * v12 phase 10a (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, owner's decisions 18 and 23): «اطلاعات فروشگاه», what the
 * site says of the shop itself: the brand's name and motto, the address and contact details, the social pages, the
 * footer's texts, the e-namad seal and the floating WhatsApp button. An empty field keeps what the site shows today (the
 * greyed text in the field), so nothing changes until something is written. A group of its own, saved under its own
 * version.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const card = 'rounded-2xl border border-slate-200 bg-white p-5 space-y-3';
const heading = 'text-sm font-black text-slate-800';

type TextField = Exclude<ShopInfoField, 'whatsappFloat'>;

const formOf = ({ whatsappNumberSet: _numberSet, ...view }: StorefrontShopInfoView): StorefrontShopInfoInput => ({ ...view });

export function StorefrontShopInfoSection({ canManage }: { canManage: boolean }) {
  const info = useStorefrontShopInfoQuery();
  if (info.isLoading) return <p className="text-xs text-slate-500">در حال خواندن…</p>;
  if (info.isError || !info.data) return <p className="text-xs text-rose-700">{errorMessageOf(info.error)}</p>;
  return <StorefrontShopInfoForm view={info.data} canManage={canManage} />;
}

function StorefrontShopInfoForm({ view, canManage }: { view: StorefrontShopInfoView; canManage: boolean }) {
  const id = useId();
  const save = useSaveStorefrontShopInfoMutation();
  const [form, setForm] = useState<StorefrontShopInfoInput>(() => formOf(view));
  useEffect(() => { setForm(formOf(view)); }, [view]);
  const set = <K extends keyof StorefrontShopInfoInput>(key: K, value: StorefrontShopInfoInput[K]) => setForm(f => ({ ...f, [key]: value }));
  const problem = shopInfoError(form);

  const submit = () => {
    save.mutate(form, {
      onSuccess: () => toast.success('اطلاعات فروشگاه ذخیره شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const input = (name: TextField, title: string, options: { ltr?: boolean; placeholder?: string; inputMode?: 'tel' | 'email' | 'url' | 'numeric'; note?: string } = {}) => (
    <div>
      <label htmlFor={`${id}-${name}`} className={label}>{title}</label>
      <input id={`${id}-${name}`} dir={options.ltr ? 'ltr' : undefined} inputMode={options.inputMode} autoComplete="off" placeholder={options.placeholder}
        className={field} value={form[name]} onChange={e => set(name, e.target.value)} aria-invalid={problem?.field === name ? true : undefined} />
      {options.note ? <p className={hint}>{options.note}</p> : null}
    </div>
  );

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (canManage && !problem) submit(); }}>
      <fieldset disabled={!canManage || save.isPending} className="space-y-5">
        <section aria-label="نام و شعار برند" className={card}>
          <h3 className={heading}>نام و شعار برند</h3>
          <p className={hint}>
            نام برند در سرصفحه، پاورقی، عنوان صفحه‌ها و نتیجهٔ موتورهای جست‌وجو می‌آید. هر فیلدی که خالی بماند، همان نوشتهٔ امروز سایت را نگه می‌دارد.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {input('brandName', 'نام کوتاه', { placeholder: SHOP_INFO_DEFAULTS.brandName })}
            {input('brandFullName', 'نام کامل', { placeholder: SHOP_INFO_DEFAULTS.brandFullName })}
          </div>
          {input('brandTagline', 'شعار', { placeholder: SHOP_INFO_DEFAULTS.brandTagline })}
        </section>

        <section aria-label="نشانی و تماس" className={card}>
          <h3 className={heading}>نشانی و تماس</h3>
          <p className={hint}>
            این‌ها در پاورقی همهٔ صفحه‌ها و در صفحهٔ «تماس با ما» نشان داده می‌شوند و به موتورهای جست‌وجو هم گفته می‌شوند. بررسی اینماد نشانی، کد پستی، تلفن و ایمیل را روی سایت می‌خواهد.
          </p>
          {input('address', 'نشانی')}
          <div className="grid gap-3 md:grid-cols-2">
            {input('postalCode', 'کد پستی', { ltr: true, inputMode: 'numeric' })}
            {input('hours', 'ساعت پاسخ‌گویی', { placeholder: 'شنبه تا چهارشنبه، ۹ تا ۱۷' })}
            {input('phone', 'تلفن ثابت', { ltr: true, inputMode: 'tel', note: 'با کد شهر.' })}
            {input('mobile', 'شمارهٔ همراه', { ltr: true, inputMode: 'tel' })}
            {input('email', 'ایمیل', { ltr: true, inputMode: 'email' })}
          </div>
        </section>

        <section aria-label="شبکه‌های اجتماعی" className={card}>
          <h3 className={heading}>شبکه‌های اجتماعی</h3>
          <p className={hint}>نشانی کامل هر صفحه، که با https:// آغاز می‌شود. اینستاگرام اگر خالی بماند، همان نشانی امروز سایت است؛ بقیه اگر خالی باشند، نشان داده نمی‌شوند.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {SHOP_SOCIALS.map(name => (
              <div key={name}>
                {input(name, SHOP_SOCIAL_TITLES[name], { ltr: true, inputMode: 'url', placeholder: name === 'instagram' ? SHOP_INFO_DEFAULTS.instagram : 'https://' })}
              </div>
            ))}
          </div>
        </section>

        <section aria-label="پاورقی" className={card}>
          <h3 className={heading}>پاورقی</h3>
          {input('footerNote', 'متن کوتاه زیر لوگو', { placeholder: SHOP_INFO_DEFAULTS.footerNote, note: 'پس از شعار برند می‌آید.' })}
          <div className="grid gap-3 md:grid-cols-2">
            {input('shippingTitle', 'عنوان ستون ارسال و پرداخت', { placeholder: SHOP_INFO_DEFAULTS.shippingTitle })}
            {input('alternateSiteLabel', 'نوشتهٔ پیوند سایت زبان دیگر', {
              placeholder: SHOP_INFO_DEFAULTS.alternateSiteLabel, note: 'نشانی آن سایت در بخش «جست‌وجو و آمار بازدید» است؛ تا آن پر نباشد، پیوندی در پاورقی نیست.',
            })}
          </div>
          <div>
            <label htmlFor={`${id}-shippingText`} className={label}>متن ستون ارسال و پرداخت</label>
            <textarea id={`${id}-shippingText`} rows={4} className={field} value={form.shippingText} onChange={e => set('shippingText', e.target.value)}
              aria-invalid={problem?.field === 'shippingText' ? true : undefined} />
            <p className={hint}>
              هر نکته در یک خط. روش‌های ارسال و سقف ارسال رایگان خودکار از «روش‌های ارسال» و «پرداخت، قیمت و موجودی» می‌آیند و بالای این خط‌ها می‌مانند. اگر خالی بماند، همان سه خط امروز سایت می‌ماند.
            </p>
          </div>
          {input('copyright', 'متن حق نشر', { placeholder: defaultCopyright(form.brandFullName.trim() || SHOP_INFO_DEFAULTS.brandFullName) })}
        </section>

        <section aria-label="نماد اعتماد الکترونیکی" className={card}>
          <h3 className={heading}>نماد اعتماد الکترونیکی (اینماد)</h3>
          <p className={hint}>
            پس از گرفتن نماد، اینماد یک تکه کد می‌دهد که دو نشانی در آن است: نشانی صفحهٔ نماد و نشانی تصویر نماد، هر دو با https://trustseal.enamad.ir آغاز می‌شوند. فقط همان دو نشانی را اینجا بنویسید، نه خود کد را. تا هر دو پر نشوند، نماد روی سایت نیست.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {input('enamadLinkUrl', 'نشانی پیوند نماد', { ltr: true, inputMode: 'url', placeholder: 'https://trustseal.enamad.ir/…' })}
            {input('enamadImageUrl', 'نشانی تصویر نماد', { ltr: true, inputMode: 'url', placeholder: 'https://trustseal.enamad.ir/…' })}
          </div>
        </section>

        <section aria-label="دکمهٔ شناور واتس‌اپ" className={card}>
          <h3 className={heading}>دکمهٔ شناور واتس‌اپ</h3>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={form.whatsappFloat} onChange={e => set('whatsappFloat', e.target.checked)} />
            دکمهٔ واتس‌اپ گوشهٔ همهٔ صفحه‌های سایت بماند
          </label>
          <p className={hint}>
            با همان «شماره واتس‌اپ فروشگاه» بخش «پرداخت، قیمت و موجودی» کار می‌کند و در سبد خرید، ثبت سفارش و صفحهٔ سفارش نشان داده نمی‌شود.
            {!view.whatsappNumberSet && ' هنوز شماره‌ای نوشته نشده است؛ تا شماره نباشد، دکمه هم نیست.'}
          </p>
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
