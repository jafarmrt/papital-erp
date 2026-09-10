import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Check,
  UsersRound,
  Search,
  RefreshCw,
  Building2,
  Truck
} from 'lucide-react';
import * as xlsx from 'xlsx';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { formatPersianNumber } from '../../utils';
import { Customer } from '../../types';

interface CustomerExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingCustomers?: Customer[];
  activeTabFilter?: 'all' | 'customer' | 'supplier';
}

interface CounterpartyPreviewRow {
  index: number;
  raw: Record<string, any>;
  id?: number;
  name: string;
  contactName: string;
  phone: string;
  partyType: 'customer' | 'supplier' | 'both';
  partyTypeLabel: string;
  supplierCategory: string;
  province: string;
  city: string;
  address: string;
  bankName: string;
  accountNumber: string;
  cardNumber: string;
  shaba: string;
  notes: string;
  isExistingMatch: boolean;
  matchType?: 'id' | 'name' | 'phone';
  issues: string[];
}

export function CustomerExcelModal({
  isOpen,
  onClose,
  onSuccess,
  existingCustomers = [],
  activeTabFilter = 'all'
}: CustomerExcelModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [updateIfExists, setUpdateIfExists] = useState(true);

  const [previewRows, setPreviewRows] = useState<CounterpartyPreviewRow[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'issues'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [importResult, setImportResult] = useState<{
    createdCount: number;
    updatedCount: number;
    totalProcessed: number;
    errors: Array<{ row: number; name?: string; message: string }>;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalization helper
  const normalizeKey = (key: string): string => {
    return key.replace(/[\s_\-–—:\(\)\[\]]/g, '').toLowerCase();
  };

  // Extract cell value matching alias list
  const getField = (row: Record<string, any>, aliases: string[]): string => {
    const rowKeys = Object.keys(row);
    for (const alias of aliases) {
      const normAlias = normalizeKey(alias);
      for (const k of rowKeys) {
        if (normalizeKey(k) === normAlias) {
          const val = row[k];
          return val !== undefined && val !== null ? String(val).trim() : '';
        }
      }
    }
    return '';
  };

  // Download complete export
  const handleDownloadExport = async (filterType?: 'all' | 'customer' | 'supplier') => {
    setIsExporting(true);
    try {
      const queryParam = filterType && filterType !== 'all' ? `?partyType=${filterType}` : '';
      const data = await fetchJson(`/customers/export-excel${queryParam}`);
      const rows = data.rows || [];

      if (rows.length === 0) {
        toast.error('هیچ طرف حسابی جهت دریافت خروجی یافت نشد.');
        return;
      }

      const ws = xlsx.utils.json_to_sheet(rows);
      // Auto-fit column widths
      const colWidths = [
        { wch: 8 },  // شناسه
        { wch: 28 }, // نام طرف حساب
        { wch: 20 }, // شخص رابط
        { wch: 16 }, // شماره تماس
        { wch: 15 }, // نوع طرف حساب
        { wch: 18 }, // دسته تامین
        { wch: 12 }, // کشور
        { wch: 14 }, // استان
        { wch: 14 }, // شهر
        { wch: 35 }, // آدرس
        { wch: 15 }, // نام بانک
        { wch: 18 }, // شماره حساب
        { wch: 20 }, // شماره کارت
        { wch: 26 }, // شماره شبا
        { wch: 25 }, // یادداشت
      ];
      ws['!cols'] = colWidths;

      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'طرفین_حساب');
      const filenameSuffix = filterType === 'supplier' ? 'تامین_کنندگان' : (filterType === 'customer' ? 'مشتریان' : 'جامع');
      xlsx.writeFile(wb, `گزارش_${filenameSuffix}_طرفین_حساب.xlsx`);
      toast.success('فایل اکسل طرفین حساب با موفقیت دانلود شد.');
    } catch (err: any) {
      console.error(err);
      toast.error('خطا در دریافت خروجی اکسل: ' + (err.message || 'خطای سرور'));
    } finally {
      setIsExporting(false);
    }
  };

  // Download standard empty/sample template
  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        'شناسه': '',
        'نام طرف حساب': 'شرکت بازرگانی آریان نگین',
        'شخص رابط': 'مهندس محمدی',
        'شماره تماس': '09121112233',
        'نوع طرف حساب': 'مشتری',
        'دسته تامین': '',
        'استان': 'تهران',
        'شهر': 'تهران',
        'آدرس کامل': 'میدان ونک، خیابان ملاصدرا، پلاک ۴۲',
        'نام بانک': 'ملت',
        'شماره حساب': '1234567890',
        'شماره کارت': '6104337890123456',
        'شماره شبا': 'IR120120000000001234567890',
        'یادداشت': 'خریدار عمده زیورآلات فانتزی'
      },
      {
        'شناسه': '',
        'نام طرف حساب': 'تامین متریال البرز (سنگ و عقیق)',
        'شخص رابط': 'آقای شریفی',
        'شماره تماس': '09355556677',
        'نوع طرف حساب': 'تامین‌کننده',
        'دسته تامین': 'سنگ، مهره و عقیق',
        'استان': 'البرز',
        'شهر': 'کرج',
        'آدرس کامل': 'شهرک صنعتی بهارستان، بلوار تلاش، کوچه گلستان',
        'نام بانک': 'سامان',
        'شماره حساب': '987654321',
        'شماره کارت': '6219861012345678',
        'شماره شبا': 'IR560560000000009876543210',
        'یادداشت': 'تامین‌کننده اصلی سنگ‌های ژئود و مهره‌ها'
      }
    ];

    const ws = xlsx.utils.json_to_sheet(sampleRows);
    ws['!cols'] = [
      { wch: 10 }, { wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 15 },
      { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 35 }, { wch: 15 },
      { wch: 18 }, { wch: 20 }, { wch: 26 }, { wch: 28 }
    ];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'الگوی_طرفین_حساب');
    xlsx.writeFile(wb, 'الگوی_استاندارد_ورود_طرفین_حساب.xlsx');
    toast.success('الگوی استاندارد اکسل دانلود شد.');
  };

  // Parse Excel file from buffer
  const processExcelFile = (file: File) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const bstr = e.target?.result;
        const wb = xlsx.read(bstr, { type: 'binary' });
        const firstSheetName = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheetName];
        const rawRows = xlsx.utils.sheet_to_json<any>(ws);

        if (!rawRows || rawRows.length === 0) {
          toast.error('فایل انتخاب‌شده خالی است یا سطری در آن یافت نشد.');
          return;
        }

        // Build existing lookup maps
        const existingNameMap = new Map<string, Customer>();
        const existingPhoneMap = new Map<string, Customer>();
        const existingIdMap = new Map<number, Customer>();

        existingCustomers.forEach((c) => {
          if (c.id) existingIdMap.set(c.id, c);
          if (c.name) existingNameMap.set(c.name.trim().toLowerCase(), c);
          if (c.phone) existingPhoneMap.set(c.phone.trim(), c);
        });

        const seenNamesInBatch = new Set<string>();

        const parsed: CounterpartyPreviewRow[] = rawRows.map((row, idx) => {
          const rawId = getField(row, ['شناسه', 'کد', 'id', 'شناسه شخص']);
          const id = rawId && !isNaN(Number(rawId)) ? Number(rawId) : undefined;
          const name = getField(row, ['نام طرف حساب', 'نام', 'طرف حساب', 'نام مشتری', 'نام تامین کننده', 'نام شرکت', 'عنوان', 'name']);
          const contactName = getField(row, ['شخص رابط', 'مدیر', 'نام رابط', 'رابط', 'contact', 'contactname']);
          const phone = getField(row, ['شماره تماس', 'تلفن', 'موبایل', 'تلفن همراه', 'phone', 'mobile']);

          const rawType = getField(row, ['نوع طرف حساب', 'نوع', 'نقش', 'نوع شخص', 'partytype', 'type']).toLowerCase();
          let partyType: 'customer' | 'supplier' | 'both' = 'customer';
          let partyTypeLabel = 'مشتری';

          if (rawType.includes('تامین') || rawType === 'supplier') {
            partyType = 'supplier';
            partyTypeLabel = 'تامین‌کننده';
          } else if (rawType.includes('هر دو') || rawType.includes('مشتری و تامین') || rawType === 'both') {
            partyType = 'both';
            partyTypeLabel = 'هر دو (مشتری و تامین‌کننده)';
          }

          const supplierCategory = getField(row, ['دسته تامین', 'دسته تامین متریال', 'دسته', 'رسته', 'suppliercategory']);
          const province = getField(row, ['استان', 'province']);
          const city = getField(row, ['شهر', 'city']);
          const address = getField(row, ['آدرس کامل', 'آدرس', 'نشانی', 'address']);
          const bankName = getField(row, ['نام بانک', 'بانک', 'bank', 'bankname']);
          const accountNumber = getField(row, ['شماره حساب', 'حساب', 'accountnumber']);
          const cardNumber = getField(row, ['شماره کارت', 'کارت', 'cardnumber']);
          const shaba = getField(row, ['شماره شبا', 'شبا', 'sheba', 'shaba']);
          const notes = getField(row, ['یادداشت', 'توضیحات', 'notes', 'description']);

          const issues: string[] = [];
          if (!name) {
            issues.push('نام طرف حساب الزامی است و خالی می‌باشد.');
          }

          if (name && seenNamesInBatch.has(name.toLowerCase())) {
            issues.push('نام طرف حساب در همین فایل تکرار شده است.');
          }
          if (name) seenNamesInBatch.add(name.toLowerCase());

          let isExistingMatch = false;
          let matchType: 'id' | 'name' | 'phone' | undefined;

          if (id && existingIdMap.has(id)) {
            isExistingMatch = true;
            matchType = 'id';
          } else if (name && existingNameMap.has(name.toLowerCase())) {
            isExistingMatch = true;
            matchType = 'name';
          } else if (phone && existingPhoneMap.has(phone)) {
            isExistingMatch = true;
            matchType = 'phone';
          }

          return {
            index: idx + 1,
            raw: row,
            id,
            name,
            contactName,
            phone,
            partyType,
            partyTypeLabel,
            supplierCategory,
            province,
            city,
            address,
            bankName,
            accountNumber,
            cardNumber,
            shaba,
            notes,
            isExistingMatch,
            matchType,
            issues
          };
        });

        setPreviewRows(parsed);
        setStep('preview');
        toast.success(`${formatPersianNumber(parsed.length)} سطر با موفقیت از فایل اکسل استخراج شد.`);
      } catch (err: any) {
        console.error(err);
        toast.error('خطا در خواندن فایل اکسل. لطفاً از سالم بودن فایل مطمئن شوید.');
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processExcelFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        processExcelFile(file);
      } else {
        toast.error('لطفاً فقط فایل اکسل با فرمت xlsx یا xls آپلود کنید.');
      }
    }
  };

  // Submit bulk import to API
  const handleConfirmImport = async () => {
    const validRows = previewRows.filter((r) => r.issues.length === 0);
    if (validRows.length === 0) {
      toast.error('هیچ سطر معتبری برای ثبت یا به‌روزرسانی وجود ندارد.');
      return;
    }

    setIsImporting(true);
    try {
      const payloadRows = validRows.map((r) => ({
        id: r.id,
        name: r.name,
        contactName: r.contactName,
        phone: r.phone,
        partyType: r.partyType,
        supplierCategory: r.supplierCategory,
        province: r.province,
        city: r.city,
        address: r.address,
        notes: r.notes,
        bankName: r.bankName,
        accountNumber: r.accountNumber,
        cardNumber: r.cardNumber,
        shaba: r.shaba,
      }));

      const res = await fetchJson('/customers/bulk-import', {
        method: 'POST',
        body: JSON.stringify({
          rows: payloadRows,
          updateIfExists
        })
      });

      setImportResult(res);
      setStep('result');
      toast.success('عملیات بارگذاری و همگام‌سازی اکسل طرفین حساب انجام شد.');
      onSuccess();
    } catch (err: any) {
      console.error(err);
      toast.error('خطا در ثبت نهایی: ' + (err.message || 'خطای شبکه'));
    } finally {
      setIsImporting(false);
    }
  };

  // Filtered rows in preview
  const filteredPreviewRows = useMemo(() => {
    return previewRows.filter((r) => {
      if (filterMode === 'issues' && r.issues.length === 0) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = r.name.toLowerCase().includes(q);
        const matchesPhone = r.phone.includes(q);
        const matchesContact = r.contactName.toLowerCase().includes(q);
        const matchesCity = r.city.toLowerCase().includes(q);
        return matchesName || matchesPhone || matchesContact || matchesCity;
      }
      return true;
    });
  }, [previewRows, filterMode, searchQuery]);

  const summaryStats = useMemo(() => {
    const total = previewRows.length;
    const withIssues = previewRows.filter((r) => r.issues.length > 0).length;
    const toUpdate = previewRows.filter((r) => r.issues.length === 0 && r.isExistingMatch).length;
    const toCreate = previewRows.filter((r) => r.issues.length === 0 && !r.isExistingMatch).length;
    return { total, withIssues, toUpdate, toCreate };
  }, [previewRows]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-right font-farsi">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center font-bold">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">مدیریت و همگام‌سازی اکسل طرفین حساب</h3>
              <p className="text-xs text-slate-500 mt-0.5">دریافت خروجی جامع یا به‌روزرسانی و ثبت انبوه اطلاعات طرفین حساب</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {/* STEP 1: UPLOAD & EXPORT CHOICES */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Quick Actions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Download Standard Template */}
                <div className="border border-slate-200 rounded-2xl p-4 bg-white hover:border-blue-300 hover:shadow-xs transition-all flex flex-col justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Download size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">دانلود قالب آماده اکسل</h4>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        فایل خام با ستون‌های استاندارد و سطرهای نمونه (مشتری و تامین‌کننده) جهت تکمیل سریع
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="mt-4 w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-blue-200/60"
                  >
                    <Download size={14} />
                    <span>دانلود قالب نمونه (.xlsx)</span>
                  </button>
                </div>

                {/* Export Current Counterparties */}
                <div className="border border-slate-200 rounded-2xl p-4 bg-white hover:border-emerald-300 hover:shadow-xs transition-all flex flex-col justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <FileSpreadsheet size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">دانلود خروجی کامل طرفین حساب</h4>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        دریافت کل اطلاعات ثبت‌شده در سیستم با تمام جزئیات مالی، آدرس و مشخصات تماس
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => handleDownloadExport('all')}
                      className="flex-1 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-emerald-200/60 disabled:opacity-50"
                    >
                      {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      <span>خروجی همه طرف‌ها</span>
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => handleDownloadExport(activeTabFilter === 'all' ? undefined : activeTabFilter)}
                      title="خروجی فیلتر تب فعال"
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>تب جاری</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Upload Drop Zone */}
              <div className="border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-2xl p-8 bg-slate-50/50 hover:bg-emerald-50/30 transition-all text-center flex flex-col items-center justify-center cursor-pointer group"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={handleFileInputChange}
                />
                <div className="w-14 h-14 rounded-2xl bg-emerald-100/70 text-emerald-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <Upload size={26} />
                </div>
                <h4 className="text-sm font-bold text-slate-800 mb-1">
                  فایل اکسل خود را بکشید و اینجا رها کنید
                </h4>
                <p className="text-xs text-slate-500 mb-4">
                  یا برای انتخاب فایل از رایانه کلیک کنید (فرمت‌های .xlsx و .xls)
                </p>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 shadow-2xs">
                  <span>پشتیبانی هوشمند از نام ستون‌های فارسی و انگلیسی</span>
                </div>
              </div>

              {/* Options */}
              <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl flex items-start gap-3">
                <input
                  type="checkbox"
                  id="updateIfExistsCheckbox"
                  checked={updateIfExists}
                  onChange={(e) => setUpdateIfExists(e.target.checked)}
                  className="mt-1 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="updateIfExistsCheckbox" className="text-xs text-slate-700 leading-relaxed cursor-pointer select-none">
                  <span className="font-bold text-blue-900 block mb-0.5">به‌روزرسانی رکوردهای موجود در صورت تطابق شناسه، نام یا شماره تماس</span>
                  در صورتی که تیک فعال باشد، اطلاعات طرف‌های حسابی که قبلاً در سیستم ثبت شده‌اند با مقادیر جدید اکسل به‌روزرسانی می‌شوند. در صورت غیرفعال بودن، رکوردهای تکراری نادیده گرفته خواهند شد.
                </label>
              </div>
            </div>
          )}

          {/* STEP 2: PREVIEW & VALIDATION */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Stats Summary Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <span className="text-[11px] text-slate-500 block mb-0.5">کل سطرهای فایل</span>
                  <span className="text-base font-black text-slate-800">{formatPersianNumber(summaryStats.total)}</span>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <span className="text-[11px] text-emerald-700 block mb-0.5">آماده ثبت جدید</span>
                  <span className="text-base font-black text-emerald-700">{formatPersianNumber(summaryStats.toCreate)}</span>
                </div>
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-center">
                  <span className="text-[11px] text-sky-700 block mb-0.5">آماده به‌روزرسانی</span>
                  <span className="text-base font-black text-sky-700">{formatPersianNumber(summaryStats.toUpdate)}</span>
                </div>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
                  <span className="text-[11px] text-rose-700 block mb-0.5">خطا یا نیازمند اصلاح</span>
                  <span className="text-base font-black text-rose-700">{formatPersianNumber(summaryStats.withIssues)}</span>
                </div>
              </div>

              {/* Filter and Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      filterMode === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    همه سطرها ({formatPersianNumber(previewRows.length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('issues')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      filterMode === 'issues' ? 'bg-white text-rose-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>موارد دارای هشدار</span>
                    {summaryStats.withIssues > 0 && (
                      <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-700 text-[10px] flex items-center justify-center font-bold">
                        {summaryStats.withIssues}
                      </span>
                    )}
                  </button>
                </div>

                <div className="relative flex-1 sm:max-w-xs">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="جستجو در سطرهای پیش‌نمایش..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-hidden"
                  />
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                </div>
              </div>

              {/* Table of Rows */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="overflow-x-auto max-h-[360px]">
                  <table className="w-full text-right border-collapse text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 text-slate-600 font-bold">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center">ردیف</th>
                        <th className="py-2.5 px-3">وضعیت عملیات</th>
                        <th className="py-2.5 px-3">نام طرف حساب</th>
                        <th className="py-2.5 px-3">نوع</th>
                        <th className="py-2.5 px-3">شماره تماس</th>
                        <th className="py-2.5 px-3">شخص رابط</th>
                        <th className="py-2.5 px-3">شهر / استان</th>
                        <th className="py-2.5 px-3">اعتبارسنجی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPreviewRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                            سطری مطابق فیلتر جاری یافت نشد.
                          </td>
                        </tr>
                      ) : (
                        filteredPreviewRows.map((r) => {
                          const hasErrors = r.issues.length > 0;
                          return (
                            <tr key={`row-${r.index}`} className={`hover:bg-slate-50/80 transition-colors ${hasErrors ? 'bg-rose-50/30' : ''}`}>
                              <td className="py-2 px-3 text-center text-slate-400 font-mono">
                                {formatPersianNumber(r.index)}
                              </td>
                              <td className="py-2 px-3">
                                {hasErrors ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[11px] font-bold">
                                    <AlertCircle size={12} /> خطا
                                  </span>
                                ) : r.isExistingMatch ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[11px] font-bold">
                                    <RefreshCw size={11} /> به‌روزرسانی
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                                    <Check size={11} /> ثبت جدید
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-800">
                                {r.name || <span className="text-rose-500 font-normal">نامشخص</span>}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${
                                  r.partyType === 'supplier'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : r.partyType === 'both'
                                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                                }`}>
                                  {r.partyType === 'supplier' ? <Truck size={10} /> : <Building2 size={10} />}
                                  {r.partyTypeLabel}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-600 font-mono text-[11px] dir-ltr text-right">
                                {r.phone || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {r.contactName || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {[r.province, r.city].filter(Boolean).join(' - ') || '—'}
                              </td>
                              <td className="py-2 px-3">
                                {r.issues.length > 0 ? (
                                  <span className="text-rose-600 text-[11px] leading-tight block">
                                    {r.issues.join(' | ')}
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 text-[11px] flex items-center gap-1">
                                    <CheckCircle2 size={12} /> معتبر
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: RESULT SUMMARY */}
          {step === 'result' && importResult && (
            <div className="py-8 text-center space-y-5">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 size={36} />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-800">پردازش فایل اکسل با موفقیت پایان یافت</h4>
                <p className="text-xs text-slate-500 mt-1">اطلاعات طرفین حساب همگام‌سازی گردید</p>
              </div>

              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span className="text-xs text-emerald-700 block mb-0.5">ثبت جدید</span>
                  <span className="text-lg font-black text-emerald-800">{formatPersianNumber(importResult.createdCount)}</span>
                </div>
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl">
                  <span className="text-xs text-sky-700 block mb-0.5">به‌روزرسانی</span>
                  <span className="text-lg font-black text-sky-800">{formatPersianNumber(importResult.updatedCount)}</span>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-xs text-slate-600 block mb-0.5">کل پردازش‌شده</span>
                  <span className="text-lg font-black text-slate-800">{formatPersianNumber(importResult.totalProcessed)}</span>
                </div>
              </div>

              {importResult.errors && importResult.errors.length > 0 && (
                <div className="text-right max-w-md mx-auto p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs space-y-1">
                  <span className="font-bold text-rose-800 block mb-1">خطاهای پردازش ({importResult.errors.length}):</span>
                  {importResult.errors.slice(0, 5).map((err, i) => (
                    <p key={`err-${i}`} className="text-rose-700 text-[11px]">
                      سطر {formatPersianNumber(err.row)}: {err.message}
                    </p>
                  ))}
                  {importResult.errors.length > 5 && (
                    <p className="text-rose-600 text-[10px]">و {formatPersianNumber(importResult.errors.length - 5)} خطای دیگر...</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
          {step === 'upload' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
              >
                انصراف و بستن
              </button>
              <span className="text-[11px] text-slate-400">یک فایل اکسل جهت شروع انتخاب کنید</span>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <ArrowRight size={14} />
                <span>انتخاب فایل دیگر</span>
              </button>

              <button
                type="button"
                disabled={isImporting || summaryStats.toCreate + summaryStats.toUpdate === 0}
                onClick={handleConfirmImport}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>در حال اعمال تغییرات...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>تایید و اعمال نهایی در سیستم ({formatPersianNumber(summaryStats.toCreate + summaryStats.toUpdate)} سطر)</span>
                  </>
                )}
              </button>
            </>
          )}

          {step === 'result' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                بستن و مشاهده فهرست طرفین حساب
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
