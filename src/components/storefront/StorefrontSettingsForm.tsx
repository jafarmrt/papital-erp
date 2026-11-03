import { useEffect, useId, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';
import { useSaveStorefrontSettingsMutation } from '../../hooks/queries/useStorefrontQueries';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import type { StorefrontSettingsInput, StorefrontSettingsView } from '../../lib/storefront/storefrontContracts';
import {
  LOW_STOCK_THRESHOLD_MAX, RESERVATION_HOURS_MAX, STOCK_DISPLAYS, STOCK_DISPLAY_TITLES, cardNumberError, ibanError, type StockDisplay,
} from '../../lib/storefront/storefrontRules';
import { OPEN_ORDERS_PER_PHONE_MAX } from '../../lib/storefront/storefrontOrderRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.1: the settings of the new site: where buyers pay by card to card, when shipping is free, how long an
 * unpaid order holds its stock, which price lists the site shows, how stock reads and which warehouse the site sells from
 * (start plan decisions 4 and 5). One save writes all of them under the version the form was opened with.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';

const formOf = (view: StorefrontSettingsView): StorefrontSettingsInput => ({
  cardNumber: view.cardNumber, cardHolder: view.cardHolder, bankName: view.bankName, iban: view.iban,
  freeShippingThreshold: view.freeShippingThreshold, reservationHours: view.reservationHours,
  retailPriceList: view.retailPriceList, wholesalePriceList: view.wholesalePriceList,
  lowStockThreshold: view.lowStockThreshold, stockDisplay: view.stockDisplay, warehouseCode: view.warehouseCode, enabled: view.enabled,
  ordersEnabled: view.ordersEnabled, treasuryAccountId: view.treasuryAccountId, openOrdersPerPhone: view.openOrdersPerPhone,
  version: view.version,
});

export function StorefrontSettingsForm({ view, canManage }: { view: StorefrontSettingsView; canManage: boolean }) {
  const id = useId();
  const rial = useRialDisplay();
  const save = useSaveStorefrontSettingsMutation();
  const [form, setForm] = useState<StorefrontSettingsInput>(() => formOf(view));
  useEffect(() => { setForm(formOf(view)); }, [view]);
  const set = <K extends keyof StorefrontSettingsInput>(key: K, value: StorefrontSettingsInput[K]) => setForm(f => ({ ...f, [key]: value }));

  const cardProblem = cardNumberError(form.cardNumber);
  const ibanProblem = ibanError(form.iban);
  const effective = view.warehouses.find(w => w.code === view.effectiveWarehouseCode);

  const submit = () => {
    save.mutate(form, {
      onSuccess: () => toast.success('تنظیمات فروشگاه سایت ذخیره شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (canManage) submit(); }}>
      <fieldset disabled={!canManage || save.isPending} className="space-y-5">
        <section aria-label="روشن بودن سایت" className={`rounded-2xl border p-5 space-y-2 ${form.enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
          <label className="inline-flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
            برنامهٔ سایت تازه به ERP دسترسی دارد
          </label>
          <p className={hint}>
            تا وقتی خاموش است، برنامهٔ سایت هیچ داده‌ای از ERP نمی‌گیرد، حتی با کلید درست، و رفتار ERP هیچ تغییری نمی‌کند. فقط وقتی سایت تازه آمادهٔ آزمایش یا راه‌اندازی است روشنش کنید.
          </p>
        </section>
        <section aria-label="پرداخت کارت به کارت" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">پرداخت کارت به کارت</h3>
          <p className={hint}>این‌ها پس از ثبت سفارش به خریدار نشان داده می‌شوند. تا وقتی کارت یا شبا خالی است، سایت سفارش پرداختی نمی‌گیرد.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-card`} className={label}>شماره کارت</label>
              <input id={`${id}-card`} dir="ltr" inputMode="numeric" autoComplete="off" className={field} value={form.cardNumber} onChange={e => set('cardNumber', e.target.value)} />
              {form.cardNumber && cardProblem && <p className="mt-1 text-xs text-rose-700">{cardProblem}</p>}
            </div>
            <div>
              <label htmlFor={`${id}-iban`} className={label}>شماره شبا</label>
              <input id={`${id}-iban`} dir="ltr" autoComplete="off" placeholder="IR…" className={field} value={form.iban} onChange={e => set('iban', e.target.value)} />
              {form.iban && ibanProblem && <p className="mt-1 text-xs text-rose-700">{ibanProblem}</p>}
            </div>
            <div>
              <label htmlFor={`${id}-holder`} className={label}>نام صاحب حساب</label>
              <input id={`${id}-holder`} className={field} value={form.cardHolder} onChange={e => set('cardHolder', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-bank`} className={label}>نام بانک</label>
              <input id={`${id}-bank`} className={field} value={form.bankName} onChange={e => set('bankName', e.target.value)} />
            </div>
          </div>
        </section>

        <section aria-label="ثبت سفارش" className={`rounded-2xl border p-5 space-y-3 ${form.ordersEnabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
          <label className="inline-flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" checked={form.ordersEnabled} onChange={e => set('ordersEnabled', e.target.checked)} />
            سایت سفارش می‌گیرد
          </label>
          <p className={hint}>
            تا خاموش است، سایت فقط کالاها را نشان می‌دهد و سفارشی ثبت نمی‌شود. برای روشن کردن، کارت یا شبا، لیست قیمت تکی و حساب دریافت لازم است.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-treasury`} className={label}>حساب دریافت کارت‌به‌کارت</label>
              <select id={`${id}-treasury`} className={field} value={form.treasuryAccountId} onChange={e => set('treasuryAccountId', Number(e.target.value) || 0)}>
                <option value={0}>انتخاب نشده</option>
                {view.treasuryAccounts.map(a => <option key={a.id} value={a.id}>{a.bankName ? `${a.title} (${a.bankName})` : a.title}</option>)}
              </select>
              <p className={hint}>حساب خزانه‌ای که کارت یا شبای بالا به آن وصل است. با تأیید هر پرداخت، دریافت در همین حساب ثبت می‌شود.</p>
            </div>
            <div>
              <label htmlFor={`${id}-open`} className={label}>سقف سفارش پرداخت‌نشدهٔ هر شماره همراه</label>
              <DecimalInput id={`${id}-open`} className={field} grouped={false} value={form.openOrdersPerPhone} min={1} max={OPEN_ORDERS_PER_PHONE_MAX} step={1}
                onValueChange={v => set('openOrdersPerPhone', Number(v) || 0)} />
              <p className={hint}>جلوی سفارش‌های ساختگی را می‌گیرد که فقط موجودی را قفل می‌کنند.</p>
            </div>
          </div>
        </section>

        <section aria-label="ارسال و رزرو" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">ارسال رایگان و رزرو موجودی</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-free`} className={label}>سقف ارسال رایگان (ریال)</label>
              <DecimalInput id={`${id}-free`} className={field} value={form.freeShippingThreshold} onValueChange={v => set('freeShippingThreshold', v)} min={0} step={1} />
              <RialEquivalent value={form.freeShippingThreshold} />
              <p className={hint}>
                {form.freeShippingThreshold ? `خرید از ${rial.amount(form.freeShippingThreshold)} به بالا با روش‌هایی که «ارسال رایگان» دارند رایگان است.` : 'خالی یعنی ارسال رایگان خاموش است.'}
              </p>
            </div>
            <div>
              <label htmlFor={`${id}-hold`} className={label}>مهلت پرداخت و رزرو (ساعت)</label>
              <DecimalInput id={`${id}-hold`} className={field} grouped={false} value={form.reservationHours} min={1} max={RESERVATION_HOURS_MAX} step={1}
                onValueChange={v => set('reservationHours', Number(v) || 0)} />
              <p className={hint}>سفارش پرداخت‌نشده تا این مدت موجودی را نگه می‌دارد و بعد آزاد می‌شود.</p>
            </div>
          </div>
        </section>

        <section aria-label="قیمت و موجودی" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-800">قیمت و موجودی</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-retail`} className={label}>لیست قیمت تکی سایت</label>
              <select id={`${id}-retail`} className={field} value={form.retailPriceList} onChange={e => set('retailPriceList', e.target.value)}>
                <option value="">انتخاب نشده</option>
                {view.priceLists.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <p className={hint}>کالایی که در این لیست قیمت ریالی ندارد روی سایت نمی‌آید.</p>
            </div>
            <div>
              <label htmlFor={`${id}-wholesale`} className={label}>لیست قیمت عمده (خریداران عمده)</label>
              <select id={`${id}-wholesale`} className={field} value={form.wholesalePriceList} onChange={e => set('wholesalePriceList', e.target.value)}>
                <option value="">انتخاب نشده</option>
                {view.priceLists.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <p className={hint}>فقط به خریداران عمدهٔ تأییدشده نشان داده می‌شود.</p>
            </div>
            <div>
              <label htmlFor={`${id}-warehouse`} className={label}>انبار فروشگاه سایت</label>
              <select id={`${id}-warehouse`} className={field} value={form.warehouseCode} onChange={e => set('warehouseCode', e.target.value)}>
                <option value="">همان انبار فروشگاه ووکامرس</option>
                {view.warehouses.map(w => <option key={w.code} value={w.code}>{w.name}</option>)}
              </select>
              <p className={hint}>سایت موجودی قابل فروش همین انبار را می‌فروشد{effective ? `؛ اکنون «${effective.name}»` : ''}.</p>
            </div>
            <div>
              <label htmlFor={`${id}-low`} className={label}>آستانه «تعداد کم»</label>
              <DecimalInput id={`${id}-low`} className={field} grouped={false} value={form.lowStockThreshold} min={0} max={LOW_STOCK_THRESHOLD_MAX} step={1}
                onValueChange={v => set('lowStockThreshold', Number(v) || 0)} />
              <p className={hint}>
                {form.lowStockThreshold > 0 ? `موجودی ${formatPersianNumber(form.lowStockThreshold)} عدد و کمتر «تعداد کم» دیده می‌شود.` : '۰ یعنی «تعداد کم» هرگز نشان داده نمی‌شود.'}
              </p>
            </div>
            <div className="md:col-span-2">
              <span className={label}>نمایش موجودی روی سایت</span>
              <div className="flex flex-wrap gap-4">
                {STOCK_DISPLAYS.map(mode => (
                  <label key={mode} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name={`${id}-display`} checked={form.stockDisplay === mode} onChange={() => set('stockDisplay', mode as StockDisplay)} />
                    {STOCK_DISPLAY_TITLES[mode]}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>
      </fieldset>
      {canManage && (
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Save className="w-4 h-4" />
          {save.isPending ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
        </button>
      )}
    </form>
  );
}
