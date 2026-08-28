import React from 'react';
import { ShieldCheck, Check } from 'lucide-react';

export function AccountingAuditChecklistView() {
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/50 rounded-xl text-amber-600">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-base">ارزیابی تخصصی و جامع ماژول حسابداری استاندارد</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              بررسی موشکافانه بخش‌های تکمیل‌شده، گزارشات قانونی و زیرسیستم‌های موردنیاز برای تبدیل به یک سیستم حسابداری و ERP تمام‌عیار سازمانی
            </p>
          </div>
        </div>

        {/* Checklist Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
          {/* Section 1 */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-750/50 space-y-3">
            <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
              <span>۱. کدینگ و اسناد دوبل حسابداری</span>
              <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">۱۰۰٪ آماده</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                کدینگ استاندارد ۴ سطحی (گروه، کل، معین، تفصیلی)
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                اسناد دوبل حسابداری با اعتبارسنجی تراز بودن بدهکار/بستانکار
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                صدور سند اصلاحی و سند معکوس (Reversal)
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                صدور خودکار سند برای فاکتور فروش، خرید، انبار، تولید و حقوق
              </li>
            </ul>
          </div>

          {/* Section 2 */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-750/50 space-y-3">
            <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
              <span>۲. گزارشات و صورت‌های مالی قانونی</span>
              <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">۱۰۰٪ آماده</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                تراز آزمایشی ۲، ۴، ۶ و ۸ ستونی در هر ۴ سطح کدینگ
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                دفتر روزنامه قانونی، دفتر کل و دفاتر معین با گردش متوالی
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                صورت سود و زیان دوره‌ای و ترازنامه اساسی
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                داشبورد شاخص‌ها و نسبت‌های مالی
              </li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-750/50 space-y-3">
            <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
              <span>۳. خزانه‌داری، نقد و بانک و چک صیادی</span>
              <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">۱۰۰٪ آماده</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                مدیریت حساب‌های بانکی، صندوق و پوزها
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                چرخه حیات چک‌های صیادی (وصول، خرج، برگشت، در جریان)
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                صورت مغایرت بانکی خودکار (Bank Reconciliation)
              </li>
            </ul>
          </div>

          {/* Section 4 */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-750/50 space-y-3">
            <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
              <span>۴. بستن سال مالی و دوره‌های حسابداری</span>
              <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">۱۰۰٪ آماده</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                بستن حساب‌های موقت به سود و زیان انباشته
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                صدور خودکار سند اختتامیه و سند افتتاحیه سال مالی جدید
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
