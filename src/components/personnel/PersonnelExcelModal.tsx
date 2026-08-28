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
  Users,
  Search,
  RefreshCw
} from 'lucide-react';
import * as xlsx from 'xlsx';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { formatPersianNumber } from '../../utils';
import { Personnel } from '../../types';

interface PersonnelExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingPersonnel: Personnel[];
}

interface PersonnelPreviewRow {
  index: number; // 0-based
  raw: Record<string, any>;
  firstName: string;
  lastName: string;
  fullName: string;
  personnelCode: string;
  phone: string;
  nationalId: string;
  jobTitle: string;
  gender: string;
  employmentStatus: string;
  birthDate: string;
  education: string;
  cardNumber: string;
  accountNumber: string;
  shebaNumber: string;
  bankName: string;
  specializedSkills: string;
  otherSkills: string;
  referralSource: string;
  address: string;
  notes: string;
  isDuplicateInBatch: boolean;
  isDuplicateInDb: boolean;
  issues: string[];
}

export function PersonnelExcelModal({
  isOpen,
  onClose,
  onSuccess,
  existingPersonnel
}: PersonnelExcelModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [updateIfExists, setUpdateIfExists] = useState(true);

  const [previewRows, setPreviewRows] = useState<PersonnelPreviewRow[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'issues'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [importResult, setImportResult] = useState<{
    createdCount: number;
    updatedCount: number;
    totalProcessed: number;
    errors: Array<{ row: number; code?: string; name?: string; message: string }>;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalized key mapping helper
  const normalizeKey = (key: string): string => {
    return key.replace(/[\s_\-–—:\(\)\[\]]/g, '').toLowerCase();
  };

  // Helper to extract value by multiple possible header aliases
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

  // Download complete current Personnel Excel export
  const handleDownloadExport = async () => {
    setIsExporting(true);
    try {
      const data = await fetchJson('/personnel/export');
      const rows = data.rows || [];

      if (rows.length === 0) {
        toast.error('هیچ پرسنلی برای دریافت خروجی یافت نشد.');
        return;
      }

      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'لیست_پرسنل');
      xlsx.writeFile(wb, 'گزارش_جامع_پرسنل.xlsx');
      toast.success('فایل اکسل پرسنل با موفقیت دانلود شد.');
    } catch (err) {
      console.error(err);
      toast.error('خطا در دریافت خروجی اکسل: ' + (err.message || 'خطای شبکه'));
    } finally {
      setIsExporting(false);
    }
  };

  // Download standard empty template for personnel
  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        'کد پرسنلی': 'EMP-101',
        'نام': 'علی',
        'نام خانوادگی': 'رضایی',
        'نام و نام خانوادگی': 'علی رضایی',
        'عنوان شغلی': 'سرپرست تولید',
        'شماره تماس': '09123456789',
        'کد ملی': '0012345678',
        'وضعیت همکاری': 'فعال',
        'جنسیت': 'مرد',
        'تاریخ تولد': '1370/05/12',
        'تحصیلات': 'کارشناسی مهندسی صنایع',
        'شماره شبا': 'IR120120000000001234567890',
        'شماره کارت': '6037991812345678',
        'شماره حساب': '123456789',
        'نام بانک': 'بانک ملی',
        'مهارت‌های تخصصی': 'مدیریت خط تولید، برشکاری دقیق CNC',
        'سایر مهارت‌ها': 'ICDL، زبان انگلیسی',
        'معرف': 'آقای کاظمی',
        'آدرس': 'تهران، خیابان جمهوری، پلاک ۱۲',
        'توضیحات': 'نیروی باسابقه و تایید شده'
      },
      {
        'کد پرسنلی': 'EMP-102',
        'نام': 'مریم',
        'نام خانوادگی': 'حسینی',
        'نام و نام خانوادگی': 'مریم حسینی',
        'عنوان شغلی': 'کارشناس کنترل کیفیت',
        'شماره تماس': '09198765432',
        'کد ملی': '0087654321',
        'وضعیت همکاری': 'فعال',
        'جنسیت': 'زن',
        'تاریخ تولد': '1375/08/20',
        'تحصیلات': 'کارشناسی ارشد متالورژی',
        'شماره شبا': '',
        'شماره کارت': '5892101234567890',
        'شماره حساب': '',
        'نام بانک': 'بانک سپه',
        'مهارت‌های تخصصی': 'کنترل کیفیت ابعادی، آزمایش متریال',
        'سایر مهارت‌ها': '',
        'معرف': 'استخدام از طریق آگهی',
        'آدرس': 'کرج، عظیمیه، میدان بهارستان',
        'توضیحات': ''
      }
    ];

    const ws = xlsx.utils.json_to_sheet(sampleRows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'الگوی_پرسنل');
    xlsx.writeFile(wb, 'الگوی_استاندارد_ورود_پرسنل.xlsx');
    toast.success('فایل نمونه اکسل پرسنل دانلود شد.');
  };

  // Process Excel File on upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = xlsx.read(bstr, { type: 'binary' });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawRows = xlsx.utils.sheet_to_json<any>(ws);

        if (!rawRows || rawRows.length === 0) {
          toast.error('فایل اکسل انتخاب‌شده فاقد داده است.');
          return;
        }

        // Map and validate rows
        const existingCodes = new Set(
          existingPersonnel
            .map((p) => p.personnelCode?.trim())
            .filter((c): c is string => !!c && c.length > 0)
        );

        const batchCodes = new Set<string>();
        const parsed: PersonnelPreviewRow[] = [];

        rawRows.forEach((row, idx) => {
          const firstName = getField(row, ['نام', 'firstname', 'fname', 'first_name']);
          const lastName = getField(row, ['نام خانوادگی', 'نامخانوادگی', 'lastname', 'lname', 'last_name']);
          let fullName = getField(row, ['نام و نام خانوادگی', 'نام و نامخانوادگی', 'نام کامل', 'fullname', 'full_name', 'name']);
          
          if (!fullName) {
            fullName = `${firstName} ${lastName}`.trim();
          }

          const personnelCode = getField(row, ['کد پرسنلی', 'کدپرسنلی', 'شماره پرسنلی', 'کد', 'personnelcode', 'personnel_code', 'code', 'empcode', 'id']);
          const phone = getField(row, ['شماره تماس', 'شماره همراه', 'تلفن', 'موبایل', 'phone', 'mobile', 'cellphone']);
          const nationalId = getField(row, ['کد ملی', 'کدملی', 'شماره ملی', 'nationalid', 'national_id', 'ssn']);
          const jobTitle = getField(row, ['عنوان شغلی', 'عنوانشغلی', 'شغل', 'سمت', 'سمت سازمانی', 'jobtitle', 'job_title', 'position', 'role']);
          const genderRaw = getField(row, ['جنسیت', 'gender', 'sex']);
          const gender = genderRaw === 'زن' || genderRaw.toLowerCase() === 'female' ? 'زن' : 'مرد';
          
          const statusRaw = getField(row, ['وضعیت همکاری', 'وضعیت', 'status', 'employmentstatus', 'employment_status']);
          let employmentStatus = 'فعال';
          if (statusRaw) {
            if (statusRaw.includes('قطع') || statusRaw.includes('اخراج') || statusRaw.includes('استعفا')) employmentStatus = 'قطع همکاری';
            else if (statusRaw.includes('مرخص')) employmentStatus = 'مرخصی';
            else if (statusRaw.includes('تعلیق')) employmentStatus = 'تعلیق';
          }

          const birthDate = getField(row, ['تاریخ تولد', 'تولد', 'birthdate', 'birth_date', 'dob']);
          const education = getField(row, ['تحصیلات', 'مدرک', 'مدرک تحصیلی', 'education', 'degree']);
          const cardNumber = getField(row, ['شماره کارت', 'شمارهکارت', 'کارت', 'cardnumber', 'card_number', 'card']);
          const accountNumber = getField(row, ['شماره حساب', 'شمارهحساب', 'حساب', 'accountnumber', 'account_number', 'account']);
          const shebaNumber = getField(row, ['شماره شبا', 'شمارهشبا', 'شبا', 'shebanumber', 'sheba_number', 'sheba', 'iban']);
          const bankName = getField(row, ['نام بانک', 'بانک', 'bankname', 'bank_name', 'bank']);
          const specializedSkills = getField(row, ['مهارت‌های تخصصی', 'مهارتهای تخصصی', 'مهارت تخصصی', 'مهارت', 'specializedskills', 'specialized_skills', 'skills']);
          const otherSkills = getField(row, ['سایر مهارت‌ها', 'سایر مهارتها', 'دیگر مهارت‌ها', 'otherskills', 'other_skills']);
          const referralSource = getField(row, ['معرف', 'منبع معرفی', 'referral', 'referralsource', 'referral_source']);
          const address = getField(row, ['آدرس', 'نشانی', 'address']);
          const notes = getField(row, ['توضیحات', 'یادداشت', 'notes', 'description']);

          const issues: string[] = [];

          if (!fullName) {
            issues.push('نام یا نام خانوادگی خالی است.');
          }

          let isDuplicateInBatch = false;
          if (personnelCode) {
            if (batchCodes.has(personnelCode)) {
              isDuplicateInBatch = true;
              issues.push(`کد پرسنلی «${personnelCode}» در همین فایل تکرار شده است.`);
            } else {
              batchCodes.add(personnelCode);
            }
          }

          const isDuplicateInDb = !!personnelCode && existingCodes.has(personnelCode);
          if (isDuplicateInDb) {
            issues.push(`کد پرسنلی «${personnelCode}» در سیستم موجود است (در صورت تایید، به‌روزرسانی می‌شود).`);
          }

          parsed.push({
            index: idx,
            raw: row,
            firstName,
            lastName,
            fullName: fullName || '---',
            personnelCode,
            phone,
            nationalId,
            jobTitle,
            gender,
            employmentStatus,
            birthDate,
            education,
            cardNumber,
            accountNumber,
            shebaNumber,
            bankName,
            specializedSkills,
            otherSkills,
            referralSource,
            address,
            notes,
            isDuplicateInBatch,
            isDuplicateInDb,
            issues
          });
        });

        setPreviewRows(parsed);
        setStep('preview');
        toast.success(`${formatPersianNumber(parsed.length)} ردیف از فایل اکسل با موفقیت بازخوانی شد.`);
      } catch (err) {
        console.error(err);
        toast.error('خطا در پردازش فایل اکسل: ' + err.message);
      }
    };

    reader.readAsBinaryString(file);
  };

  // Filtered preview rows
  const filteredPreviewRows = useMemo(() => {
    return previewRows.filter((r) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.fullName.toLowerCase().includes(q) ||
        r.personnelCode.toLowerCase().includes(q) ||
        r.phone.includes(q) ||
        r.nationalId.includes(q) ||
        r.jobTitle.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (filterMode === 'issues') {
        return r.issues.length > 0;
      }
      return true;
    });
  }, [previewRows, filterMode, searchQuery]);

  // Total issues
  const totalIssuesCount = useMemo(() => {
    return previewRows.filter((r) => r.issues.length > 0).length;
  }, [previewRows]);

  // Execute bulk import
  const handleConfirmImport = async () => {
    if (previewRows.length === 0) return;

    setIsImporting(true);
    try {
      const payloadRows = previewRows.map((r) => ({
        firstName: r.firstName,
        lastName: r.lastName,
        fullName: r.fullName,
        personnelCode: r.personnelCode,
        phone: r.phone,
        nationalId: r.nationalId,
        jobTitle: r.jobTitle,
        gender: r.gender,
        employmentStatus: r.employmentStatus,
        birthDate: r.birthDate,
        education: r.education,
        cardNumber: r.cardNumber,
        accountNumber: r.accountNumber,
        shebaNumber: r.shebaNumber,
        bankName: r.bankName,
        specializedSkills: r.specializedSkills,
        otherSkills: r.otherSkills,
        referralSource: r.referralSource,
        address: r.address,
        notes: r.notes
      }));

      const res = await fetchJson('/personnel/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: payloadRows,
          updateIfExists
        })
      });

      setImportResult({
        createdCount: res.createdCount || 0,
        updatedCount: res.updatedCount || 0,
        totalProcessed: res.totalProcessed || payloadRows.length,
        errors: Array.isArray(res.errors) ? res.errors : []
      });

      setStep('result');
      toast.success('عملیات ثبت اطلاعات اکسل با موفقیت انجام شد.');
      onSuccess();
    } catch (err) {
      console.error(err);
      toast.error('خطا در ثبت نهایی پرسنل: ' + (err.message || 'خطای شبکه'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleResetModal = () => {
    setStep('upload');
    setPreviewRows([]);
    setImportResult(null);
    setSearchQuery('');
    setFilterMode('all');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    handleResetModal();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      id="personnel-excel-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-farsi dir-rtl animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-l from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100/60">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
                ورود و خروجی اکسل پرسنل
                <span className="text-[11px] font-bold px-2 py-0.5 bg-emerald-100/80 text-emerald-700 rounded-lg">
                  .XLSX
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ورود دسته‌جمعی پرسنل جدید از فایل اکسل یا دریافت خروجی کامل بانک پرسنل
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* STEP 1: Upload & Initial Options */}
          {step === 'upload' && (
            <div className="space-y-6 max-w-3xl mx-auto">
              {/* Export and Template Download Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Download Template Card */}
                <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/30 p-5 rounded-2xl border border-blue-100/80 space-y-3">
                  <div className="flex items-center gap-2.5 text-blue-900 font-bold text-sm">
                    <Download size={18} className="text-blue-600" />
                    <span>دانلود الگوی نمونه اکسل</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    فایل نمونه استاندارد شامل تمام ستون‌های مشخصات فردی، تماس، شغلی و بانکی را دریافت و تکمیل نمایید.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="w-full py-2.5 px-4 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download size={16} />
                    <span>دانلود قالب آماده پرسنل (.xlsx)</span>
                  </button>
                </div>

                {/* Export Current Personnel Card */}
                <div className="bg-gradient-to-br from-emerald-50/50 to-teal-50/30 p-5 rounded-2xl border border-emerald-100/80 space-y-3">
                  <div className="flex items-center gap-2.5 text-emerald-900 font-bold text-sm">
                    <FileSpreadsheet size={18} className="text-emerald-600" />
                    <span>دریافت خروجی پرسنل موجود</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    دریافت فایل اکسل کامل شامل تمامی پرسنل ثبت‌شده، کدها، شماره‌ها، مهارت‌ها و سوابق فعلی.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadExport}
                    disabled={isExporting}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    <span>{isExporting ? 'در حال ایجاد فایل...' : 'دانلود خروجی اکسل پرسنل (.xlsx)'}</span>
                  </button>
                </div>
              </div>

              {/* Upload Zone */}
              <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/60 hover:bg-blue-50/20 rounded-3xl p-8 text-center transition-all">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="personnel-excel-file-input"
                />
                <label
                  htmlFor="personnel-excel-file-input"
                  className="flex flex-col items-center justify-center cursor-pointer space-y-3"
                >
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shadow-xs">
                    <Upload size={30} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">
                      فایل اکسل پرسنل را اینجا رها کنید یا برای انتخاب کلیک کنید
                    </span>
                    <p className="text-xs text-slate-500">پشتیبانی از پسوندهای .xlsx و .xls (حداکثر ۱۰ مگابایت)</p>
                  </div>
                </label>
              </div>

              {/* Settings and Guidelines */}
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <Info size={16} className="text-amber-600 shrink-0" />
                  <span>راهنما و نکات مهم ورود اطلاعات:</span>
                </div>
                <ul className="text-xs text-amber-800 space-y-1 mr-5 list-disc">
                  <li>ستون‌های «نام» یا «نام و نام خانوادگی» برای هر پرسنل الزامی است.</li>
                  <li>ستون «کد پرسنلی» شناسه یکتا است؛ در صورت تکرار، رکورد قبلی به‌روزرسانی می‌شود.</li>
                  <li>وضعیت همکاری می‌تواند «فعال»، «مرخصی»، «تعلیق» یا «قطع همکاری» باشد.</li>
                  <li>پیش از ثبت نهایی، پیش‌نمایش جدول اطلاعات برای تایید و بررسی شما نمایش داده می‌شود.</li>
                </ul>
              </div>
            </div>
          )}

          {/* STEP 2: Preview & Validation */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Top Banner Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 font-bold">کل ردیف‌های فایل:</span>
                    <p className="text-lg font-black text-slate-900">{formatPersianNumber(previewRows.length)}</p>
                  </div>
                  <Users size={24} className="text-slate-400" />
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs text-emerald-700 font-bold">آماده ثبت بدون خطا:</span>
                    <p className="text-lg font-black text-emerald-800">
                      {formatPersianNumber(previewRows.length - totalIssuesCount)}
                    </p>
                  </div>
                  <CheckCircle2 size={24} className="text-emerald-500" />
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs text-amber-700 font-bold">دارای هشدار / تکرار:</span>
                    <p className="text-lg font-black text-amber-800">{formatPersianNumber(totalIssuesCount)}</p>
                  </div>
                  <AlertTriangle size={24} className="text-amber-500" />
                </div>
              </div>

              {/* Filter and Search Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <div className="relative flex-1 w-full">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="جستجو در پیش‌نمایش بر اساس نام، کد پرسنلی، شماره یا شغل..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFilterMode('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterMode === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    همه ({formatPersianNumber(previewRows.length)})
                  </button>

                  <button
                    onClick={() => setFilterMode('issues')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterMode === 'issues'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-amber-200 text-amber-700 hover:bg-amber-50'
                    }`}
                  >
                    دارای هشدار ({formatPersianNumber(totalIssuesCount)})
                  </button>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center gap-2 p-3 bg-blue-50/60 rounded-xl border border-blue-100">
                <input
                  type="checkbox"
                  id="update-if-exists"
                  checked={updateIfExists}
                  onChange={(e) => setUpdateIfExists(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="update-if-exists" className="text-xs font-bold text-blue-900 cursor-pointer">
                  در صورت وجود کد پرسنلی یکسان در سیستم، اطلاعات فرد به‌روزرسانی شود (Update Existing)
                </label>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700 font-black border-b border-slate-200">
                    <tr>
                      <th className="p-3">ردیف</th>
                      <th className="p-3">کد پرسنلی</th>
                      <th className="p-3">نام و نام خانوادگی</th>
                      <th className="p-3">عنوان شغلی</th>
                      <th className="p-3">شماره تماس</th>
                      <th className="p-3">کد ملی</th>
                      <th className="p-3">وضعیت</th>
                      <th className="p-3">اعتبارسنجی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredPreviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                          هیچ موردی با فیلترهای انتخابی یافت نشد.
                        </td>
                      </tr>
                    ) : (
                      filteredPreviewRows.map((row) => (
                        <tr key={row.index} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 font-bold text-slate-400">{formatPersianNumber(row.index + 1)}</td>
                          <td className="p-3 font-mono font-bold text-blue-700">
                            {row.personnelCode || <span className="text-slate-300 font-normal">خودکار</span>}
                          </td>
                          <td className="p-3 font-black text-slate-900">{row.fullName}</td>
                          <td className="p-3 text-slate-600">{row.jobTitle || '---'}</td>
                          <td className="p-3 font-mono text-slate-600">{row.phone || '---'}</td>
                          <td className="p-3 font-mono text-slate-600">{row.nationalId || '---'}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                row.employmentStatus === 'فعال'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : row.employmentStatus === 'قطع همکاری'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
                              {row.employmentStatus}
                            </span>
                          </td>
                          <td className="p-3">
                            {row.issues.length === 0 ? (
                              <span className="flex items-center gap-1 text-emerald-600 font-bold text-[11px]">
                                <CheckCircle2 size={14} />
                                بدون خطا
                              </span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {row.issues.map((iss, i) => (
                                  <span
                                    key={i}
                                    className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-medium"
                                  >
                                    <AlertTriangle size={12} className="shrink-0 text-amber-500" />
                                    {iss}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 3: Result Summary */}
          {step === 'result' && importResult && (
            <div className="space-y-6 max-w-2xl mx-auto py-6 text-center">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 size={40} />
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-black text-slate-900">عملیات ورود اطلاعات با موفقیت انجام شد!</h3>
                <p className="text-xs text-slate-500">
                  اطلاعات پرسنل در پایگاه‌داده ذخیره شد و اکنون در تمام بخش‌های حقوق و دستمزد و تولید قابل استفاده است.
                </p>
              </div>

              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-right">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <span className="text-xs text-emerald-700 font-bold">پرسنل جدید ثبت‌شده:</span>
                  <p className="text-2xl font-black text-emerald-900 mt-1">
                    {formatPersianNumber(importResult.createdCount)} نفر
                  </p>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                  <span className="text-xs text-blue-700 font-bold">پرسنل به‌روزرسانی شده:</span>
                  <p className="text-2xl font-black text-blue-900 mt-1">
                    {formatPersianNumber(importResult.updatedCount)} نفر
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl col-span-2 sm:col-span-1">
                  <span className="text-xs text-slate-600 font-bold">کل ردیف‌های بررسی‌شده:</span>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    {formatPersianNumber(importResult.totalProcessed)} ردیف
                  </p>
                </div>
              </div>

              {/* Errors list if any */}
              {importResult.errors.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-right space-y-2">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                    <AlertCircle size={16} />
                    <span>خطاهای رخ داده در حین ثبت:</span>
                  </div>
                  <ul className="text-xs text-rose-700 space-y-1 list-disc mr-5">
                    {importResult.errors.map((e, idx) => (
                      <li key={idx}>
                        ردیف {formatPersianNumber(e.row)} {e.name ? `(${e.name})` : ''}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50">
          {step === 'upload' && (
            <>
              <span className="text-xs text-slate-500 font-medium">برای شروع، فایل اکسل را بارگذاری کنید.</span>
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                انصراف و بستن
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
              >
                <ArrowRight size={16} />
                <span>انتخاب فایل دیگر</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2.5 text-slate-500 hover:text-slate-800 text-xs font-bold cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isImporting || previewRows.length === 0}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  <span>{isImporting ? 'در حال ثبت پرسنل...' : `تایید و ثبت نهایی (${formatPersianNumber(previewRows.length)} پرسنل)`}</span>
                </button>
              </div>
            </>
          )}

          {step === 'result' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
              >
                بستن و مشاهده لیست پرسنل
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
