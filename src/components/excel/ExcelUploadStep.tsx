import React from 'react';
import { Download, Upload, Loader2, Info } from 'lucide-react';

interface ExcelUploadStepProps {
  isExporting: boolean;
  isLoadingMetadata: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDownloadExport: () => void;
  onDownloadTemplate: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ExcelUploadStep: React.FC<ExcelUploadStepProps> = ({
  isExporting,
  isLoadingMetadata,
  fileInputRef,
  onDownloadExport,
  onDownloadTemplate,
  onFileChange
}) => {
  return (
    <div className="space-y-6">
      {/* Information box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 leading-relaxed space-y-2">
        <div className="flex items-center gap-2 font-bold text-blue-900 text-sm">
          <Info size={16} />
          راهنمای سیستم جامع اکسل و کنترل کدینگ:
        </div>
        <ul className="list-disc list-inside space-y-1 text-slate-700">
          <li>سیستم پیش از ثبت نهایی، تطابق کدهای فایل را با پیشوند دسته‌بندی‌ها (مانند <span className="font-mono font-bold text-blue-900" dir="ltr">N-</span> برای گردنبند) بررسی نموده و امکان اصلاح خودکار فراهم است.</li>
          <li>جهت حفظ یکپارچگی پایگاه‌داده، ثبت دو محصول با نام مشابه اکیداً مسدود شده و در مرحله پیش‌نمایش به شما هشدار داده می‌شود.</li>
          <li>در صورت وجود کالا با کد یکسان، مشخصات پایه، موجودی انبارها و استراتژی‌های قیمت‌گذاری به‌روزرسانی خواهند شد.</li>
        </ul>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Download Export */}
        <div className="border border-slate-200 rounded-2xl p-5 hover:border-emerald-300 hover:bg-emerald-50/30 transition-all flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-1">
              <Download size={18} />
              دانلود خروجی کامل
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              دریافت فایل اکسل کامل شامل مشخصات فنی کالاها، ارزش خرید، موجودی انبارها و لیست قیمت تمام استراتژی‌ها
            </p>
          </div>
          <button
            onClick={onDownloadExport}
            disabled={isExporting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-bold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            دریافت خروجی اکسل (.xlsx)
          </button>
        </div>

        {/* Upload File */}
        <div className="border border-slate-200 rounded-2xl p-5 hover:border-purple-300 hover:bg-purple-50/30 transition-all flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-purple-700 font-bold text-sm mb-1">
              <Upload size={18} />
              بارگذاری اکسل و بررسی صحت
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              انتخاب فایل اکسل جدید جهت بررسی پیش‌نمایش، تطابق سیستم کدینگ و ثبت/به‌روزرسانی همزمان کالاها
            </p>
          </div>
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx, .xls"
              onChange={onFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoadingMetadata}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              {isLoadingMetadata ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              انتخاب و تحلیل فایل اکسل
            </button>
          </div>
        </div>
      </div>

      {/* Download sample template button */}
      <div className="flex justify-center pt-2">
        <button
          onClick={onDownloadTemplate}
          className="text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Download size={14} />
          دانلود الگوی فرمت اکسل استاندارد (Template)
        </button>
      </div>
    </div>
  );
};
