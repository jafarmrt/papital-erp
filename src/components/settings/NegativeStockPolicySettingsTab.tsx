import { useState, useEffect } from 'react';
import { Sliders, Check, ShieldAlert, Info, Lock } from 'lucide-react';
import { fetchJson, isAbortError } from '../../api';

/**
 * v7.0.22 (TD-180 / audit P0-3): منفی شدن موجودی انبار در سامانه همیشه ممنوع است
 * (هم‌راستا با قید پایگاه‌داده). این زبانه فقط وضعیت سیاست را نمایش می‌دهد و گزینه‌های
 * قدیمی «ثبت با هشدار» و «مجاز بدون محدودیت» حذف شده‌اند.
 */
export function NegativeStockPolicySettingsTab() {
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<{ policy?: string }>('/inventory/negative-stock-policy', { signal: controller.signal })
      .then((res) => {
        setPolicyConfirmed(res?.policy === 'forbidden');
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setErrorMsg(err instanceof Error && err.message ? err.message : 'خطا در دریافت وضعیت سیاست موجودی منفی');
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-6 max-w-4xl font-farsi">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Sliders size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">سیاست کنترل موجودی منفی انبار</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              شیوه برخورد سامانه در زمان صدور فاکتور فروش، حواله خروج انبار یا تخصیص به پروژه هنگام ناکافی بودن موجودی
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
            <ShieldAlert size={16} className="text-rose-600" />
            <span className="font-bold">{errorMsg}</span>
          </div>
        )}

        <div className="border-2 border-rose-500 bg-rose-50/50 shadow-sm rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
              <ShieldAlert size={20} />
            </div>
            <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              {policyConfirmed ? <Check size={10} /> : <Lock size={10} />} فعال و ثابت
            </span>
          </div>
          <h3 className="font-bold text-slate-800 text-sm mb-1">ممنوعیت کامل</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            هر سندی که موجودی کالا را در انبار انتخابی کمتر از صفر کند، ثبت نمی‌شود و پیام کسری موجودی همراه با موجودی فعلی انبار به کاربر نمایش داده می‌شود.
          </p>
        </div>
      </div>

      <div className="bg-blue-50/60 border border-blue-200 rounded-2xl p-5 text-xs text-blue-900 leading-relaxed space-y-2">
        <div className="font-bold flex items-center gap-2 text-sm text-blue-950">
          <Info size={16} className="text-blue-600" />
          <span>چرا این سیاست قابل تغییر نیست؟</span>
        </div>
        <p>
          • موجودی هر کالا در هر انبار در پایگاه‌داده با قید «موجودی منفی ممنوع» نگهداری می‌شود تا گزارش‌های انبار، بهای تمام‌شده و اسناد حسابداری همیشه با موجودی واقعی سازگار بمانند. به همین دلیل گزینه‌های «ثبت با هشدار» و «مجاز بدون محدودیت» از سامانه حذف شده‌اند.
        </p>
        <p>
          • در صورت کسری موجودی، ابتدا رسید ورود کالا یا انتقال بین انبارها را ثبت کنید و سپس سند خروج را صادر نمایید.
        </p>
        <p>
          • برای مشاهده ماتریس سه‌جانبه سلامت انبار، تطبیق دفتر کالا و ثبت شمارش‌های عینی به بخش «انبارگردانی و تطبیق سه‌جانبه» در منوی اصلی مراجعه نمایید.
        </p>
      </div>
    </div>
  );
}
