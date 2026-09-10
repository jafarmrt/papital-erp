import React from 'react';
import { ShieldAlert, AlertTriangle, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';

interface SystemOperationsTabProps {
  onOpenClearModal: () => void;
}

export function SystemOperationsTab({ onOpenClearModal }: SystemOperationsTabProps) {
  return (
    <div className="space-y-6 max-w-4xl mx-auto text-right font-farsi">
      {/* Critical Operations Box */}
      <div className="bg-white border text-red-700 border-red-200 rounded-2xl shadow-xs p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-red-100 pb-4 mb-4">
          <ShieldAlert size={24} />
          <h3 className="font-bold text-lg m-0 p-0 border-0">عملیات سیستمی و پاکسازی پایگاه‌داده</h3>
        </div>
        <div className="bg-red-50 p-5 rounded-2xl border border-red-200 space-y-3">
          <div className="flex items-center gap-2 text-red-800 font-bold text-sm">
            <Trash2 size={18} />
            <h4>پاکسازی کامل سیستم، حذف کاربران و بازنشانی به سناریوی شروع اولیه</h4>
          </div>
          <p className="text-xs text-red-700 leading-relaxed">
            این عملیات تمامی اطلاعات عملیاتی سامانه (کالاها، انبارها، فاکتورها، اسناد دوبل مالی، چک‌ها، پروژه‌ها، CRM، کارکرد و کلیه حساب‌های کاربری) را به‌طور کامل پاک کرده و ساختارهای استاندارد پایه (۲۲ دسته‌بندی اصلی، نقش‌های سیستمی، کدینگ حسابداری و گردش‌کارها) را بازنشانی می‌کند. پس از اتمام، سیستم فوراً به صفحه راه‌اندازی و شروع به کار اولیه (Setup Wizard) هدایت می‌شود. این عملیات غیرقابل بازگشت است.
          </p>
          <div className="pt-2">
            <button
              onClick={onOpenClearModal}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm hover:shadow-md flex items-center gap-2"
            >
              <RotateCcw size={16} />
              <span>اجرای عملیات پاکسازی کامل سیستم</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ClearDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  deleteConfirmText: string;
  setDeleteConfirmText: (val: string) => void;
  isSaving: boolean;
  onConfirmClear: () => void;
}

export function ClearDataModal({
  isOpen,
  onClose,
  deleteConfirmText,
  setDeleteConfirmText,
  isSaving,
  onConfirmClear
}: ClearDataModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-farsi text-right">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-red-400 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-red-200 bg-red-50 text-red-700 flex items-center gap-2.5">
          <AlertTriangle size={22} className="shrink-0 text-red-600" />
          <div>
            <h3 className="font-bold text-base border-0 p-0 m-0">تایید نهایی پاکسازی کامل اطلاعات سیستم</h3>
            <p className="text-[11px] text-red-600/80 mt-0.5">بازنشانی به وضعیت اولیه کارخانه</p>
          </div>
        </div>

        <div className="p-6 space-y-4 text-xs overflow-y-auto">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <Trash2 size={14} className="text-red-500" />
              <span>ماژول‌ها و اطلاعاتی که به‌طور کامل حذف خواهند شد:</span>
            </div>
            <ul className="text-slate-600 list-disc list-inside space-y-1 text-[11px] pr-1 leading-relaxed">
              <li>کلیه حساب‌های کاربری و دسترسی‌های کاربران (سامانه بدون کاربر خواهد شد)</li>
              <li>کلیه کالاها، موجودی انبارها، قیمت‌ها و فایل‌های پیوست</li>
              <li>کلیه فاکتورها، اسناد انبارداری و پیش‌فاکتورها</li>
              <li>اسناد حسابداری دوبل روزنامه، خزانه‌داری، دریافت/پرداخت‌ها و چک‌های صیادی</li>
              <li>پروژه‌ها و مراحل تولید کارگاهی، کنترل موجودی پروژه و قطعات</li>
              <li>پرونده‌های پرسنل، کارمزدها، لاگ‌های کارمزدی و تسویه‌حساب‌ها</li>
              <li>مشتریان، سرنخ‌ها و فعالیت‌های پیگیری CRM</li>
              <li>گزارش‌های روزانه ثبت کارکرد، لاگ‌های رویدادها و کارتابل تاییدات</li>
            </ul>
          </div>

          <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200 space-y-1 text-emerald-800">
            <div className="font-bold flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <span>ساختارهای اولیه‌ای که خودکار بازنشانی و آماده‌سازی می‌شوند:</span>
            </div>
            <p className="text-[11px] text-emerald-700 leading-relaxed pr-1">
              ۲۲ دسته‌بندی استاندارد کارگاه، انبار اصلی، کدینگ استاندارد حسابداری و نقش‌های سیستمی بازنشانی شده و سامانه بلافاصله شما را به ویزارد راه‌اندازی اولیه جهت تعریف حساب مدیر ارشد هدایت می‌کند.
            </p>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block font-medium mb-1.5 text-slate-700">
              برای تایید حذف غیرقابل بازگشت، کلمه <span className="font-mono text-red-600 font-bold select-all bg-red-50 px-1.5 py-0.5 rounded border border-red-200">DELETE</span> را با حروف بزرگ وارد کنید:
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="w-full border border-red-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none font-mono text-left tracking-wider"
              dir="ltr"
              placeholder="DELETE"
              autoFocus
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-100 transition-all font-medium cursor-pointer"
            >
              انصراف
            </button>
            <button
              onClick={onConfirmClear}
              disabled={deleteConfirmText !== 'DELETE' || isSaving}
              className="px-5 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed font-bold transition-all shadow-sm cursor-pointer flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>در حال پاکسازی کامل سیستم...</span>
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  <span>تایید و پاکسازی کامل اطلاعات</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

