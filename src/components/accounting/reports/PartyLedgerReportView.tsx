import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Users, 
  Search, 
  Calendar, 
  Printer, 
  Download, 
  RefreshCw, 
  ArrowDownLeft, 
  ArrowUpRight, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  Building, 
  Briefcase, 
  Clock, 
  SlidersHorizontal,
  ChevronDown,
  X
} from 'lucide-react';
import { 
  formatPersianPrice, 
  formatPersianNumber, 
  formatPersianDate, 
  formatPersianCode 
} from '../../../utils';
import { fetchJson } from '../../../api';
import toast from 'react-hot-toast';
import type { DetailedPartyLedgerResult, DetailedPartyLedgerItem, PartyOption } from '../../../types';

interface PartyLedgerReportViewProps {
  initialPartyId?: number;
  initialPartyType?: string;
  initialPartyName?: string;
}

export function PartyLedgerReportView({
  initialPartyId,
  initialPartyType,
  initialPartyName
}: PartyLedgerReportViewProps) {
  // Party selection states
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);
  const [partyTypeFilter, setPartyTypeFilter] = useState<'all' | 'customer' | 'supplier' | 'personnel'>(() => {
    if (initialPartyType && ['customer', 'supplier', 'personnel'].includes(initialPartyType)) {
      return initialPartyType as any;
    }
    return 'all';
  });
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [selectedParty, setSelectedParty] = useState<PartyOption | null>(null);
  const [isPartyDropdownOpen, setIsPartyDropdownOpen] = useState(false);

  useEffect(() => {
    if (initialPartyType && ['customer', 'supplier', 'personnel'].includes(initialPartyType)) {
      setPartyTypeFilter(initialPartyType as any);
    }
  }, [initialPartyType]);

  // Date filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeDatePreset, setActiveDatePreset] = useState<'all' | 'month' | 'three_months' | 'year'>('all');

  // Currency & options
  const [currency, setCurrency] = useState<'all' | 'IRR' | 'USD' | 'EUR' | 'AED' | 'GBP'>('all');
  const [includeDrafts, setIncludeDrafts] = useState(false);

  // Report data & loading
  const [reportData, setReportData] = useState<DetailedPartyLedgerResult | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Load parties list on mount
  const fetchParties = useCallback(async () => {
    try {
      setLoadingParties(true);
      const res = await fetchJson('/accounting/reports/parties');
      const list: PartyOption[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setParties(list);

      // Match initial party if provided
      if (initialPartyId || initialPartyName) {
        const found = list.find(p => 
          (initialPartyId && p.id === initialPartyId) || 
          (initialPartyName && p.name.trim().toLowerCase() === initialPartyName.trim().toLowerCase())
        );
        if (found) {
          setSelectedParty(found);
        } else if (initialPartyName) {
          setSelectedParty({
            id: initialPartyId || 0,
            name: initialPartyName,
            partyType: (initialPartyType as any) || 'customer',
          });
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'خطا در بارگذاری لیست طرف‌های حساب');
    } finally {
      setLoadingParties(false);
    }
  }, [initialPartyId, initialPartyName, initialPartyType]);

  useEffect(() => {
    fetchParties();
  }, [fetchParties]);

  // Quick date presets
  const handleApplyDatePreset = (preset: 'all' | 'month' | 'three_months' | 'year') => {
    setActiveDatePreset(preset);
    const now = new Date();
    const todayIso = now.toISOString().split('T')[0];

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'month') {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(todayIso);
    } else if (preset === 'three_months') {
      const past = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(todayIso);
    } else if (preset === 'year') {
      const past = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(todayIso);
    }
  };

  // Fetch report for selected party
  const fetchLedger = useCallback(async () => {
    if (!selectedParty && !partySearchQuery.trim()) {
      toast('لطفاً یک طرف‌حساب انتخاب کنید', { icon: 'ℹ️' });
      return;
    }

    try {
      setLoadingReport(true);
      const params = new URLSearchParams();
      if (selectedParty?.id) params.append('partyId', String(selectedParty.id));
      if (selectedParty?.partyType) params.append('partyType', selectedParty.partyType);
      const partyName = selectedParty?.name || partySearchQuery.trim();
      if (partyName) params.append('partyName', partyName);

      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (currency !== 'all') params.append('currency', currency);
      if (includeDrafts) params.append('includeDrafts', 'true');

      const res = await fetchJson(`/accounting/reports/party-ledger?${params.toString()}`);
      const data: DetailedPartyLedgerResult = res?.report || res;
      setReportData(data);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در دریافت صورت‌حساب طرف‌حساب');
    } finally {
      setLoadingReport(false);
    }
  }, [selectedParty, partySearchQuery, startDate, endDate, currency, includeDrafts]);

  // Auto-fetch when selectedParty changes
  useEffect(() => {
    if (selectedParty) {
      fetchLedger();
    }
  }, [selectedParty]);

  // Filtered party list for dropdown
  const filteredParties = useMemo(() => {
    return parties.filter(p => {
      // Type filter
      if (partyTypeFilter !== 'all' && p.partyType !== partyTypeFilter) return false;
      // Search query
      if (partySearchQuery.trim()) {
        const q = partySearchQuery.trim().toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchPhone = p.phone?.toLowerCase().includes(q);
        const matchCode = p.code?.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchCode) return false;
      }
      return true;
    });
  }, [parties, partyTypeFilter, partySearchQuery]);

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // Export to CSV/Excel with UTF-8 BOM
  const handleExportExcel = () => {
    if (!reportData || !reportData.items || reportData.items.length === 0) {
      toast.error('داده‌ای برای خروجی اکسل وجود ندارد');
      return;
    }

    const partyName = reportData.party?.name || selectedParty?.name || 'طرف_حساب';
    const filename = `صورت_حساب_${partyName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;

    const headers = ['ردیف', 'تاریخ', 'شماره سند', 'شماره دستی', 'شرح عملیات', 'کد حساب', 'نام حساب معین', 'بدهکار', 'بستانکار', 'مانده لحظه‌ای', 'نوع مانده', 'ارز'];
    const rows = reportData.items.map(it => [
      it.rowNumber,
      it.date,
      it.voucherNumber || '—',
      it.manualVoucherNumber || '',
      `"${(it.description || '').replace(/"/g, '""')}"`,
      it.accountCode || '',
      `"${(it.accountName || '').replace(/"/g, '""')}"`,
      it.debit,
      it.credit,
      it.runningBalance,
      it.balanceType,
      it.currency
    ]);

    // Prepend UTF-8 BOM \uFEFF for correct Persian display in Microsoft Excel
    const csvContent = '\uFEFF' + [
      [`"صورت‌حساب تفصیلی طرف‌حساب: ${partyName}"`],
      [`"تاریخ صدور گزارش: ${new Date().toLocaleDateString('fa-IR')}"`],
      [`"مانده ابتدای دوره: ${reportData.openingBalance} (${reportData.openingBalanceType})"`],
      [`"جمع گردش بدهکار: ${reportData.totalDebit}"`, `"جمع گردش بستانکار: ${reportData.totalCredit}"`],
      [`"مانده نهایی: ${reportData.finalBalance} (${reportData.finalBalanceType})"`],
      [],
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('فایل اکسل صورت‌حساب با موفقیت دانلود شد');
  };

  const currentPartyName = reportData?.party?.name || selectedParty?.name;

  return (
    <div className="space-y-5">
      {/* 1. Filter and Control Bar (No Print) */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-4 no-print">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl text-indigo-600 dark:text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-black text-slate-900 dark:text-white">
                صورت‌حساب جامع و گردش تفصیلی اشخاص
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                مشاهده شفاف ریزگردش، مانده دفتری و چاپ سند تسویه‌حساب مشتریان، پرسنل و تامین‌کنندگان بدون درگیری با کدینگ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchLedger}
              disabled={loadingReport || (!selectedParty && !partySearchQuery.trim())}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? 'animate-spin' : ''}`} />
              <span>به‌روزرسانی گردش</span>
            </button>

            <button
              onClick={handlePrint}
              disabled={!reportData}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition disabled:opacity-40"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>چاپ رسمی</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={!reportData || !reportData.items?.length}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-40 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>خروجی اکسل</span>
            </button>
          </div>
        </div>

        {/* Party Selector and Filters */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
          {/* Party Search and Dropdown (6 cols) */}
          <div className="md:col-span-5 relative">
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              طرف‌حساب (مشتری، تامین‌کننده، پرسنل):
            </label>
            <div className="relative">
              <div 
                onClick={() => setIsPartyDropdownOpen(!isPartyDropdownOpen)}
                className="w-full flex items-center justify-between px-3.5 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-xs cursor-pointer hover:border-indigo-500 transition"
              >
                <div className="flex items-center gap-2 truncate">
                  {selectedParty ? (
                    <>
                      <span className={`p-1 rounded-md text-[10px] font-bold ${
                        selectedParty.partyType === 'supplier'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : selectedParty.partyType === 'personnel'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                          : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
                      }`}>
                        {selectedParty.partyType === 'supplier' ? 'تامین‌کننده' : selectedParty.partyType === 'personnel' ? 'پرسنل' : 'مشتری'}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white truncate">{selectedParty.name}</span>
                      {selectedParty.phone && (
                        <span className="text-[11px] text-slate-400 font-mono">({formatPersianCode(selectedParty.phone)})</span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400">جستجو و انتخاب طرف‌حساب...</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {selectedParty && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedParty(null);
                        setReportData(null);
                      }}
                      className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-slate-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </div>
              </div>

              {/* Dropdown Popup */}
              {isPartyDropdownOpen && (
                <div className="absolute z-30 mt-1.5 w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl p-3 space-y-2 max-h-80 overflow-y-auto">
                  {/* Category Filter Tabs */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-700/60 rounded-lg text-[11px]">
                    <button
                      type="button"
                      onClick={() => setPartyTypeFilter('all')}
                      className={`flex-1 py-1 rounded-md font-bold transition ${
                        partyTypeFilter === 'all' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      همه
                    </button>
                    <button
                      type="button"
                      onClick={() => setPartyTypeFilter('customer')}
                      className={`flex-1 py-1 rounded-md font-bold transition ${
                        partyTypeFilter === 'customer' ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      مشتریان
                    </button>
                    <button
                      type="button"
                      onClick={() => setPartyTypeFilter('supplier')}
                      className={`flex-1 py-1 rounded-md font-bold transition ${
                        partyTypeFilter === 'supplier' ? 'bg-white dark:bg-slate-600 text-amber-600 dark:text-amber-400 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      تامین‌کنندگان
                    </button>
                    <button
                      type="button"
                      onClick={() => setPartyTypeFilter('personnel')}
                      className={`flex-1 py-1 rounded-md font-bold transition ${
                        partyTypeFilter === 'personnel' ? 'bg-white dark:bg-slate-600 text-purple-600 dark:text-purple-400 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      پرسنل
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="جستجوی نام یا شماره تماس..."
                      value={partySearchQuery}
                      onChange={(e) => setPartySearchQuery(e.target.value)}
                      className="w-full pr-8 pl-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-hidden focus:border-indigo-500"
                      autoFocus
                    />
                  </div>

                  {/* Party List Options */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/60 max-h-52 overflow-y-auto">
                    {filteredParties.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">
                        موردی با این مشخصات یافت نشد
                      </div>
                    ) : (
                      filteredParties.map(p => (
                        <div
                          key={`${p.partyType}-${p.id}`}
                          onClick={() => {
                            setSelectedParty(p);
                            setIsPartyDropdownOpen(false);
                          }}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                            selectedParty?.id === p.id && selectedParty?.partyType === p.partyType
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 font-bold text-indigo-600 dark:text-indigo-400'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            {p.partyType === 'supplier' ? (
                              <Building className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            ) : p.partyType === 'personnel' ? (
                              <Briefcase className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                            ) : (
                              <User className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            )}
                            <span className="truncate">{p.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-400 font-mono">
                            {p.city && <span>{p.city}</span>}
                            {p.phone && <span>{formatPersianCode(p.phone)}</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Date Presets & Custom Range (5 cols) */}
          <div className="md:col-span-5 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>بازه زمانی گزارش:</span>
              </label>

              {/* Quick shortcut pills */}
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => handleApplyDatePreset('month')}
                  className={`px-2 py-0.5 rounded font-bold transition ${
                    activeDatePreset === 'month' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  ماه جاری
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyDatePreset('three_months')}
                  className={`px-2 py-0.5 rounded font-bold transition ${
                    activeDatePreset === 'three_months' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  ۳ ماه اخیر
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyDatePreset('year')}
                  className={`px-2 py-0.5 rounded font-bold transition ${
                    activeDatePreset === 'year' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  سال جاری
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyDatePreset('all')}
                  className={`px-2 py-0.5 rounded font-bold transition ${
                    activeDatePreset === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  کل سوابق
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="از تاریخ (مثلاً 1403/01/01)"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setActiveDatePreset('all'); }}
                className="w-1/2 px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white"
              />
              <span className="text-slate-400 text-xs">تا</span>
              <input
                type="text"
                placeholder="تا تاریخ (مثلاً 1403/12/29)"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); setActiveDatePreset('all'); }}
                className="w-1/2 px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Currency and Option (2 cols) */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              واحد پولی:
            </label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white"
            >
              <option value="all">همه ارزها</option>
              <option value="IRR">ریال (IRR)</option>
              <option value="USD">دلار (USD)</option>
              <option value="EUR">یورو (EUR)</option>
              <option value="AED">درهم (AED)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. Main Report Container */}
      {!reportData ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            هیچ طرف‌حسابی انتخاب نشده است
          </h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            از کادر بالا نام مشتری، تامین‌کننده یا پرسنل مورد نظر را انتخاب کنید تا صورت‌حساب مالی، گردش و مانده لحظه‌ای وی نمایش داده شود.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Printable Official Header */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-5">
            {/* Top Company & Report Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
              <div>
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 block mb-1">
                  سامانه مدیریت منابع سازمانی و حسابداری (ERP)
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">
                  صورت‌حساب مالی طرف‌حساب
                </h2>
              </div>

              <div className="text-left sm:text-right space-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                <div>تاریخ صدور گزارش: <span className="font-bold text-slate-800 dark:text-slate-200">{new Date().toLocaleDateString('fa-IR')}</span></div>
                <div>
                  بازه زمانی: <span className="font-bold text-slate-800 dark:text-slate-200">
                    {startDate ? formatPersianDate(startDate) : 'ابتدای دوره'} الی {endDate ? formatPersianDate(endDate) : 'امروز'}
                  </span>
                </div>
              </div>
            </div>

            {/* Party Profile Banner */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 dark:bg-slate-750/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div>
                <span className="text-[11px] text-slate-400 block">نام و نام‌خانوادگی:</span>
                <span className="text-sm font-black text-slate-900 dark:text-white mt-0.5 block">{currentPartyName}</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">نوع طرف‌حساب:</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5 block">
                  {reportData.party?.partyType === 'supplier' ? 'تامین‌کننده کالا و خدمات' : reportData.party?.partyType === 'personnel' ? 'پرسنل و همکار' : 'مشتری'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">شماره تماس:</span>
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5 block">
                  {reportData.party?.phone ? formatPersianCode(reportData.party.phone) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">شناسه / شهر:</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5 block">
                  {reportData.party?.code || reportData.party?.city || '—'}
                </span>
              </div>
            </div>

            {/* High Impact Account Status Card (Highlight) */}
            <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
              reportData.finalBalance > 0
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-200'
                : reportData.finalBalance < 0
                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/80 text-blue-950 dark:text-blue-200'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-200'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  reportData.finalBalance > 0
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                    : reportData.finalBalance < 0
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                }`}>
                  {reportData.finalBalance === 0 ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <span className="text-xs font-bold opacity-80 block">وضعیت فعلی حساب در این تاریخ:</span>
                  <span className="text-base font-black tracking-tight">{reportData.netStatusText}</span>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-[11px] opacity-75 block">مانده خالص قطعی:</span>
                <span className="text-lg font-black font-mono">
                  {formatPersianPrice(Math.abs(reportData.finalBalance), currency !== 'all' ? currency : 'ریال')}
                </span>
              </div>
            </div>

            {/* Financial Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 dark:bg-slate-750/50 rounded-xl border border-slate-200/60 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">مانده ابتدای دوره</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
                    {formatPersianPrice(Math.abs(reportData.openingBalance))}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    reportData.openingBalanceType === 'بدهکار'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : reportData.openingBalanceType === 'بستانکار'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {reportData.openingBalanceType}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-750/50 rounded-xl border border-slate-200/60 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">جمع گردش بدهکار</span>
                <span className="text-sm font-black text-amber-600 dark:text-amber-400 font-mono">
                  {formatPersianPrice(reportData.totalDebit)}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-750/50 rounded-xl border border-slate-200/60 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">جمع گردش بستانکار</span>
                <span className="text-sm font-black text-blue-600 dark:text-blue-400 font-mono">
                  {formatPersianPrice(reportData.totalCredit)}
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-750/50 rounded-xl border border-slate-200/60 dark:border-slate-700">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">مانده انتهای دوره</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
                    {formatPersianPrice(Math.abs(reportData.finalBalance))}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    reportData.finalBalanceType === 'بدهکار'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : reportData.finalBalanceType === 'بستانکار'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                  }`}>
                    {reportData.finalBalanceType}
                  </span>
                </div>
              </div>
            </div>

            {/* Standard 8-Column Clean Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/60 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
                    <th className="py-2.5 px-3 w-10 text-center border-l border-slate-200 dark:border-slate-700">#</th>
                    <th className="py-2.5 px-3 w-24 text-center border-l border-slate-200 dark:border-slate-700">تاریخ</th>
                    <th className="py-2.5 px-3 w-24 text-center border-l border-slate-200 dark:border-slate-700">شماره سند</th>
                    <th className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700">شرح عملیات</th>
                    <th className="py-2.5 px-3 w-36 border-l border-slate-200 dark:border-slate-700">معین درگیر</th>
                    <th className="py-2.5 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                    <th className="py-2.5 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بستانکار</th>
                    <th className="py-2.5 px-3 w-32 text-left border-l border-slate-200 dark:border-slate-700">مانده لحظه‌ای</th>
                    <th className="py-2.5 px-3 w-20 text-center">نوع مانده</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {reportData.items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-10 text-slate-400">
                        گردش حسابی در این بازه زمانی برای این طرف‌حساب ثبت نشده است
                      </td>
                    </tr>
                  ) : (
                    reportData.items.map((it, idx) => {
                      const isOpening = it.isOpening;
                      return (
                        <tr 
                          key={`${it.voucherId}-${idx}`} 
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-750/50 transition ${
                            isOpening ? 'bg-indigo-50/50 dark:bg-indigo-950/20 font-bold' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 text-slate-400 font-mono">
                            {isOpening ? '—' : formatPersianNumber(it.rowNumber)}
                          </td>
                          <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono">
                            {formatPersianDate(it.date)}
                          </td>
                          <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono">
                            {isOpening ? '—' : (
                              <span className="font-bold">
                                {formatPersianCode(it.voucherNumber)}
                                {it.manualVoucherNumber && (
                                  <span className="text-[10px] text-slate-400 block font-normal">({formatPersianCode(it.manualVoucherNumber)})</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-4 border-l border-slate-200 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200">
                            {it.description}
                          </td>
                          <td className="py-2 px-3 border-l border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 truncate">
                            {it.accountCode ? `${it.accountCode} - ${it.accountName}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-medium text-amber-700 dark:text-amber-400">
                            {it.debit > 0 ? formatPersianPrice(it.debit) : '—'}
                          </td>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-medium text-blue-700 dark:text-blue-400">
                            {it.credit > 0 ? formatPersianPrice(it.credit) : '—'}
                          </td>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-black text-slate-900 dark:text-white">
                            {formatPersianPrice(Math.abs(it.runningBalance))}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              it.balanceType === 'بدهکار'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : it.balanceType === 'بستانکار'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            }`}>
                              {it.balanceType}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 dark:bg-slate-700/80 font-black border-t-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white">
                    <td colSpan={5} className="py-3 px-4 text-left border-l border-slate-200 dark:border-slate-700">
                      جمع کل دوره مالی:
                    </td>
                    <td className="py-3 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono text-amber-700 dark:text-amber-400">
                      {formatPersianPrice(reportData.totalDebit)}
                    </td>
                    <td className="py-3 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono text-blue-700 dark:text-blue-400">
                      {formatPersianPrice(reportData.totalCredit)}
                    </td>
                    <td className="py-3 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                      {formatPersianPrice(Math.abs(reportData.finalBalance))}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        reportData.finalBalanceType === 'بدهکار'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : reportData.finalBalanceType === 'بستانکار'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                      }`}>
                        {reportData.finalBalanceType}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Official Signatures Block for Print */}
            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 dark:border-slate-700 mt-6 text-center text-xs">
              <div className="space-y-12">
                <span className="font-bold text-slate-700 dark:text-slate-300">امضا و تایید صادرکننده صورت‌حساب (امور مالی):</span>
                <div className="border-b border-dashed border-slate-300 dark:border-slate-600 w-48 mx-auto" />
              </div>
              <div className="space-y-12">
                <span className="font-bold text-slate-700 dark:text-slate-300">امضا و تایید صحت مانده توسط طرف‌حساب:</span>
                <div className="border-b border-dashed border-slate-300 dark:border-slate-600 w-48 mx-auto" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
