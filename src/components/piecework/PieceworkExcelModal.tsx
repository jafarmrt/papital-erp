import React, { useState, useRef } from 'react';
import { X, FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, Loader2, Check } from 'lucide-react';
import { PieceworkTask } from '../../types';
import { formatPersianNumber, formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import {
  downloadPieceworkTemplate,
  exportPieceworkTasksToExcel,
  parsePieceworkExcelFile,
  ParsedPieceworkRow
} from './pieceworkExcelUtils';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';

interface PieceworkExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasksList: PieceworkTask[];
  onSuccess: () => void;
}

export function PieceworkExcelModal({
  isOpen,
  onClose,
  tasksList,
  onSuccess
}: PieceworkExcelModalProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);

  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedPieceworkRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importMode, setImportMode] = useState<'upsert' | 'replace'>('upsert');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    createdCount: number;
    updatedCount: number;
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const validRows = parsedRows.filter(r => r.isValid);
  const invalidRows = parsedRows.filter(r => !r.isValid);
  const categoriesDetected = Array.from(new Set(validRows.map(r => r.category).filter(Boolean)));

  const filteredPreviewRows = parsedRows.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q)
    );
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileName(file.name);
    try {
      const rows = await parsePieceworkExcelFile(file);
      setParsedRows(rows);
      setStep('preview');
      toast.success(`${formatPersianNumber(rows.length)} ردیف با موفقیت از فایل اکسل استخراج شد.`);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در خواندن فایل اکسل. لطفاً ساختار فایل را بررسی کنید.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileName(file.name);
    try {
      const rows = await parsePieceworkExcelFile(file);
      setParsedRows(rows);
      setStep('preview');
      toast.success(`${formatPersianNumber(rows.length)} ردیف با موفقیت از فایل اکسل استخراج شد.`);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در خواندن فایل اکسل.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (validRows.length === 0) {
      toast.error('هیچ ردیف معتبری برای بارگذاری وجود ندارد.');
      return;
    }

    setIsImporting(true);
    try {
      const payload = {
        rows: validRows.map(r => ({
          code: r.code,
          title: r.title,
          category: r.category,
          defaultRate: r.defaultRate,
          unit: r.unit,
          description: r.description
        })),
        mode: importMode
      };

      const res = await fetchJson<{
        status: string;
        message: string;
        createdCount: number;
        updatedCount: number;
      }>('/piecework/tasks/import-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setImportResult({
        createdCount: res.createdCount,
        updatedCount: res.updatedCount,
        message: res.message
      });
      setStep('result');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ذخیره‌سازی داده‌های اکسل در دیتابیس.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setParsedRows([]);
    setFileName('');
    setImportResult(null);
    setSearchQuery('');
  };

  const handleExportExisting = () => {
    try {
      exportPieceworkTasksToExcel(tasksList);
      toast.success('فایل اکسل عناوین کاری دانلود شد.');
    } catch (err: any) {
      toast.error('خطا در خروجی فایل اکسل: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[90] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/30 text-blue-400 rounded-2xl border border-blue-500/30">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3 className="font-black text-base">مدیریت اکسل عناوین و نرخ‌های پایه کارها</h3>
              <p className="text-xs text-slate-300 font-medium mt-0.5">
                {step === 'upload' && 'بارگذاری، دریافت فایل الگو یا استخراج اکسل عناوین پرکیسی'}
                {step === 'preview' && `پیش‌نمایش داده‌های استخراج‌شده از «${fileName}»`}
                {step === 'result' && 'نتیجه نهایی بارگذاری و ثبت در دیتابیس'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* STEP 1: UPLOAD & ACTIONS */}
          {step === 'upload' && (
            <div className="space-y-6">
              
              {/* Quick Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Download Template Card */}
                <div className="p-5 bg-blue-50/70 border border-blue-200/80 rounded-2xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-blue-900 font-black text-sm mb-1.5">
                      <Download size={18} className="text-blue-600" />
                      <span>دانلود فایل الگوی خام (Template)</span>
                    </div>
                    <p className="text-xs text-blue-700 leading-relaxed font-medium">
                      جهت ورود داده‌ها بدون خطا، می‌توانید فایل نمونه آماده اکسل با ستون‌های استاندارد را دانلود کرده و مقادیر خود را در آن وارد نمایید.
                    </p>
                  </div>
                  <button
                    onClick={downloadPieceworkTemplate}
                    className="mt-4 w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download size={16} />
                    <span>دانلود قالب اکسل</span>
                  </button>
                </div>

                {/* Export Existing Tasks Card */}
                <div className="p-5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-emerald-900 font-black text-sm mb-1.5">
                      <FileSpreadsheet size={18} className="text-emerald-600" />
                      <span>استخراج خروجی اکسل از عناوین موجود</span>
                    </div>
                    <p className="text-xs text-emerald-700 leading-relaxed font-medium">
                      دریافت تمام عناوین و نرخ‌های پایه‌ای که هم‌اکنون در سیستم ثبت شده‌اند در قالب یک فایل اکسل کامل ({formatPersianNumber(tasksList.length)} عنوان).
                    </p>
                  </div>
                  <button
                    onClick={handleExportExisting}
                    disabled={tasksList.length === 0}
                    className="mt-4 w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 active:scale-98 text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet size={16} />
                    <span>استخراج {formatPersianNumber(tasksList.length)} عنوان به اکسل</span>
                  </button>
                </div>

              </div>

              {/* Upload Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/80 hover:bg-blue-50/30 transition-all rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer group space-y-3"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                />
                
                <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-200 group-hover:scale-105 group-hover:border-blue-400 transition-all text-blue-600">
                  {isProcessing ? (
                    <Loader2 size={32} className="animate-spin text-blue-600" />
                  ) : (
                    <Upload size={32} />
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-black text-slate-800">
                    برای بارگذاری، فایل اکسل را اینجا بکشید یا کلیک کنید
                  </h4>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    فرمت‌های مجاز: XLSX, XLS, CSV
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-400 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                  <span>ستون‌های شناسایی‌شده:</span>
                  <span className="text-slate-600">کد کار، عنوان کار، دسته‌بندی، نرخ پایه، واحد سنجش، توضیحات</span>
                </div>
              </div>

            </div>
          )}

          {/* STEP 2: PREVIEW */}
          {step === 'preview' && (
            <div className="space-y-4">
              
              {/* Summary Badges & Mode Switch */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-[11px] text-slate-500 font-bold">کل ردیف‌های فایل</div>
                  <div className="text-base font-black text-slate-800 mt-0.5">
                    {formatPersianNumber(parsedRows.length)} ردیف
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <div className="text-[11px] text-emerald-700 font-bold">ردیف‌های معتبر جهت ثبت</div>
                  <div className="text-base font-black text-emerald-800 mt-0.5">
                    {formatPersianNumber(validRows.length)} عنوان
                  </div>
                </div>

                <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl">
                  <div className="text-[11px] text-blue-700 font-bold">دسته‌بندی‌های جدید</div>
                  <div className="text-base font-black text-blue-800 mt-0.5">
                    {formatPersianNumber(categoriesDetected.length)} گروه
                  </div>
                </div>
              </div>

              {invalidRows.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2 text-xs font-bold text-amber-800">
                  <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                  <span>
                    توجه: {formatPersianNumber(invalidRows.length)} ردیف به دلیل خالی بودن عنوان نادیده گرفته خواهند شد.
                  </span>
                </div>
              )}

              {/* Import Mode Switch */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <label className="text-xs font-black text-slate-800 block">
                  شیوه اعمال داده‌ها بر سیستم:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode('upsert')}
                    className={`p-3 rounded-xl border text-right transition-all flex items-start gap-3 cursor-pointer ${
                      importMode === 'upsert'
                        ? 'bg-white border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                        : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className={`p-1 rounded-full mt-0.5 ${importMode === 'upsert' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-transparent'}`}>
                      <Check size={12} />
                    </div>
                    <div>
                      <div className="text-xs font-black text-slate-900">افزودن و به‌روزرسانی (پیشنهادی)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        عناوین جدید اضافه شده و موارد هم‌کد/هم‌نام به‌روزرسانی می‌شوند.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`p-3 rounded-xl border text-right transition-all flex items-start gap-3 cursor-pointer ${
                      importMode === 'replace'
                        ? 'bg-rose-50/50 border-rose-500 ring-2 ring-rose-500/20 shadow-xs'
                        : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className={`p-1 rounded-full mt-0.5 ${importMode === 'replace' ? 'bg-rose-600 text-white' : 'bg-slate-200 text-transparent'}`}>
                      <Check size={12} />
                    </div>
                    <div>
                      <div className="text-xs font-black text-rose-900">جایگزینی کامل (حذف قبلی‌ها)</div>
                      <div className="text-[11px] text-rose-600 mt-0.5">
                        تمام عناوین قبلی حذف شده و فقط اطلاعات این فایل اکسل ثبت می‌شود.
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Search in Preview */}
              <div className="flex items-center justify-between gap-3">
                <input
                  type="text"
                  placeholder="جستجو در ردیف‌های پیش‌نمایش..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-72 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                />
                <span className="text-xs font-bold text-slate-500 shrink-0">
                  نمایش {formatPersianNumber(filteredPreviewRows.length)} از {formatPersianNumber(parsedRows.length)}
                </span>
              </div>

              {/* Table Preview */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-right text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-black sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 w-12 text-center">#</th>
                      <th className="p-2.5 w-24">کد</th>
                      <th className="p-2.5">عنوان کاری</th>
                      <th className="p-2.5">دسته‌بندی</th>
                      <th className="p-2.5 text-center">واحد</th>
                      <th className="p-2.5 text-left">{`نرخ پایه (${curLbl})`}</th>
                      <th className="p-2.5">توضیحات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    {filteredPreviewRows.map((r) => (
                      <tr
                        key={r.index}
                        className={r.isValid ? 'hover:bg-slate-50/70' : 'bg-rose-50/60 text-rose-700'}
                      >
                        <td className="p-2.5 text-center text-slate-400">{formatPersianNumber(r.index)}</td>
                        <td className="p-2.5 font-mono text-slate-600">{r.code || 'خودکار'}</td>
                        <td className="p-2.5 text-slate-900">{r.title || '—'}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-[11px]">
                            {r.category}
                          </span>
                        </td>
                        <td className="p-2.5 text-center text-slate-600">{r.unit}</td>
                        <td className="p-2.5 text-left font-mono text-blue-700">
                          {formatPersianPrice(r.defaultRate)}
                        </td>
                        <td className="p-2.5 text-slate-500 text-[11px] truncate max-w-xs">{r.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* STEP 3: RESULT */}
          {step === 'result' && (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-4 bg-emerald-100 text-emerald-600 rounded-3xl animate-bounce">
                <CheckCircle2 size={48} />
              </div>
              <div>
                <h4 className="text-lg font-black text-slate-900">
                  بارگذاری داده‌ها با موفقیت انجام شد!
                </h4>
                <p className="text-xs text-slate-600 font-bold mt-1">
                  {importResult?.message}
                </p>
              </div>

              <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 px-6 py-3 rounded-2xl">
                <div className="text-center">
                  <div className="text-xs text-slate-500 font-bold">عناوین جدید</div>
                  <div className="text-base font-black text-emerald-600">
                    +{formatPersianNumber(importResult?.createdCount || 0)}
                  </div>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div className="text-center">
                  <div className="text-xs text-slate-500 font-bold">عناوین به‌روزرسانی‌شده</div>
                  <div className="text-base font-black text-blue-600">
                    {formatPersianNumber(importResult?.updatedCount || 0)}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0">
          {step === 'upload' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                بستن
              </button>
              <div className="text-xs text-slate-500 font-bold">
                تعداد کل عناوین فعلی در سیستم: {formatPersianNumber(tasksList.length)}
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={handleReset}
                disabled={isImporting}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                انتخاب فایل دیگر
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isImporting}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isImporting || validRows.length === 0}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer"
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>در حال ثبت اطلاعات...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>تایید و ثبت {formatPersianNumber(validRows.length)} عنوان در سیستم</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'result' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black transition-all shadow-md cursor-pointer"
              >
                متوجه شدم و بازگشت به لیست
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
