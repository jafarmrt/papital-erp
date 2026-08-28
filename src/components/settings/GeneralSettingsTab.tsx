import React from 'react';
import { Building2, List, Download, Database, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import { compressTo300KB } from '../../utils/imageCompression';

const TIMEZONE_OPTIONS = [
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Istanbul',
  'Europe/Berlin',
  'Europe/London',
  'UTC',
  'America/New_York'
] as const;

interface GeneralSettingsTabProps {
  companyName: string;
  setCompanyName: (val: string) => void;
  companyPhone: string;
  setCompanyPhone: (val: string) => void;
  companyAddress: string;
  setCompanyAddress: (val: string) => void;
  currency: string;
  setCurrency: (val: string) => void;
  displayTimezone?: string;
  setDisplayTimezone?: (val: string) => void;
  companyLogo: string;
  setCompanyLogo: (val: string) => void;
  invoiceStartNum: string;
  setInvoiceStartNum: (val: string) => void;
  fastMovingDays: string;
  setFastMovingDays: (val: string) => void;
  slowMovingDays: string;
  setSlowMovingDays: (val: string) => void;
  deadStockDays: string;
  setDeadStockDays: (val: string) => void;
  isSaving: boolean;
  onSave: () => void;
}

export function GeneralSettingsTab({
  companyName,
  setCompanyName,
  companyPhone,
  setCompanyPhone,
  companyAddress,
  setCompanyAddress,
  currency,
  setCurrency,
  displayTimezone = 'Asia/Tehran',
  setDisplayTimezone,
  companyLogo,
  setCompanyLogo,
  invoiceStartNum,
  setInvoiceStartNum,
  fastMovingDays,
  setFastMovingDays,
  slowMovingDays,
  setSlowMovingDays,
  deadStockDays,
  setDeadStockDays,
  isSaving,
  onSave
}: GeneralSettingsTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 max-w-4xl mx-auto space-y-8 text-right font-farsi">
      {/* Section 1: Business / Store Details */}
      <div>
        <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 flex items-center gap-2 text-base">
          <Building2 size={18} className="text-blue-600" /> مشخصات کسب‌وکار و سربرگ فاکتورها
        </h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">نام فروشگاه / شرکت</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-white border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
              placeholder="نام فروشگاه..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">شماره تماس پشتیبانی</label>
            <input
              type="text"
              value={companyPhone}
              onChange={(e) => setCompanyPhone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-white border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
              placeholder="02188888888"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1 text-slate-700">آدرس فروشگاه / انبار مرکزی</label>
            <input
              type="text"
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-white border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
              placeholder="نشانی کامل..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">واحد پول اصلی فاکتورها</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-white border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
            >
              <option value="IRR">ریال (IRR)</option>
              <option value="TOMAN">تومان (Toman)</option>
              <option value="USD">دلار ($)</option>
              <option value="EUR">یورو (€)</option>
              <option value="AED">درهم (AED)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">لوگوی شرکت / برند</label>
            <div className="flex items-center gap-3">
              {companyLogo && (
                <div className="relative w-12 h-12 border rounded-lg overflow-hidden bg-white p-1 shrink-0 flex items-center justify-center">
                  <img src={companyLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setCompanyLogo('')}
                    className="absolute top-0 right-0 bg-red-600 text-white rounded-bl p-0.5 text-[9px] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
              <label className="flex-1 cursor-pointer bg-slate-50 hover:bg-slate-100 border border-slate-300 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 text-center transition-colors">
                بارگذاری لوگو جدید
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!file.type.startsWith('image/')) {
                      toast.error('لطفاً یک فایل تصویری برای لوگو انتخاب کنید');
                      return;
                    }
                    try {
                      // V10-2.3: استاندارد واحد فشرده‌سازی تصاویر (سقف ۳۰۰ کیلوبایت)
                      const dataUrl = await compressTo300KB(file);
                      setCompanyLogo(dataUrl);
                    } catch {
                      toast.error('خطا در پردازش تصویر. لطفاً فایل دیگری انتخاب کنید.');
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Circulation Days */}
      <div>
        <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 flex items-center gap-2 text-base">
          <List size={18} /> شماره‌گذاری اسناد و دوره‌های گردش
        </h3>
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">شماره شروع فاکتور چاپی</label>
            <input
              type="text"
              value={invoiceStartNum}
              onChange={(e) => setInvoiceStartNum(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 font-mono text-left bg-white border-slate-300 text-sm"
              dir="ltr"
            />
            <p className="text-xs text-slate-500 mt-1">شماره فاکتور بعدی از این عدد شروع خواهد شد.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">تند گردش (کمتر از چند روز)</label>
            <input
              type="number"
              min="1"
              value={fastMovingDays}
              onChange={(e) => setFastMovingDays(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 font-mono text-left bg-white border-slate-300 text-sm"
              dir="ltr"
            />
            <p className="text-xs text-slate-500 mt-1">کالاهایی که در این بازه خروج داشته باشند.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">کند گردش (بیشتر از چند روز)</label>
            <input
              type="number"
              min="1"
              value={slowMovingDays}
              onChange={(e) => setSlowMovingDays(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 font-mono text-left bg-white border-slate-300 text-sm"
              dir="ltr"
            />
            <p className="text-xs text-slate-500 mt-1">شروع بازه بدون خروج متوسط (مثلا ۹۰ روز).</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">کالای راکد (بیشتر از چند روز)</label>
            <input
              type="number"
              min="1"
              value={deadStockDays}
              onChange={(e) => setDeadStockDays(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 font-mono text-left bg-white border-slate-300 text-sm"
              dir="ltr"
            />
            <p className="text-xs text-slate-500 mt-1">شروع بازه بدون خروج طولانی (مثلا ۱۸۰ روز).</p>
          </div>
        </div>
      </div>

      {/* V10-1.1: ساعت توافقی واحد */}
      <div>
        <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 flex items-center gap-2 text-base">
          <Globe size={18} className="text-indigo-600" /> منطقه زمانی و ساعت توافقی سیستم
        </h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">منطقه زمانی رسمی سامانه</label>
            <select
              value={displayTimezone}
              onChange={(e) => setDisplayTimezone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-white border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
              dir="ltr"
            >
              {TIMEZONE_OPTIONS.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              مرجع واحد تاریخ/ساعت سرور و نمایش همه کاربران. تاریخ‌ها بر اساس تقویم جلالی همین ساعت توافقی نمایش داده می‌شوند. تغییر پس از ذخیره، بلافاصله اعمال می‌شود.
            </p>
          </div>
        </div>
      </div>

      {/* کارت پشتیبان‌گیری و خروجی دیتابیس */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5 space-y-3 shadow-2xs">
        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
          <Database className="text-emerald-600" size={18} /> پشتیبان‌گیری و خروجی کامل اطلاعات برنامه (JSON Backup)
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          جهت نصب نسخه جدید برنامه با تمامی اطلاعات فعلی (کاربران، مشتریان، انبار، کالاها، پروژه‌ها و فاکتورها) بر روی سرور یا سیستم دیگر، فایل پشتیبان زیر را دانلود کنید.
        </p>

        <div className="pt-2">
          <a
            href="/api/system/export-backup"
            download={`erp-backup-${new Date().toISOString().split('T')[0]}.json`}
            className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-md w-full sm:w-auto inline-flex"
          >
            <Download size={18} /> دانلود فایل پشتیبان کامل دیتابیس
          </a>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-200">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
        >
          {isSaving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
        </button>
      </div>
    </div>
  );
}
