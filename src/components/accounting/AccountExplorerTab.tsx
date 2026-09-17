import { useState, useEffect, useMemo } from 'react';
import { Layers, ChevronLeft, Search, Printer, Download, Eye, ArrowUpRight, ArrowDownLeft, User, Users, FolderKanban, RotateCcw, FileText, X } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatPersianPrice, formatPersianNumber, formatPersianDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { SearchableSelect } from '../SearchableSelect';
import { fetchJson } from '../../api';
import type { Account, Customer, Personnel, BankAccount, JournalVoucher } from '../../types';

interface AccountExplorerTabProps {
  accounts: Account[];
  customers: Customer[];
  personnelList: Personnel[];
  bankAccounts: BankAccount[];
  loading?: boolean;
  onRefresh?: () => void;
  onViewVoucher?: (voucher: JournalVoucher) => void;
}

interface VoucherItemRow {
  voucherId: number;
  voucherNumber: number;
  date: string;
  description: string;
  accountName: string;
  accountCode: string;
  detailedName?: string;
  detailedType?: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export function AccountExplorerTab({
  accounts = [],
  customers = [],
  personnelList = [],
  bankAccounts = [],
  loading = false,
  onRefresh,
  onViewVoucher
}: AccountExplorerTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const safeAccounts = useMemo(() => Array.isArray(accounts) ? accounts : [], [accounts]);
  
  // Navigation State
  const [activeMode, setActiveMode] = useState<'hierarchy' | 'detailed_entity'>('hierarchy');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGeneralId, setSelectedGeneralId] = useState<number | null>(null);
  const [selectedSubsidiaryId, setSelectedSubsidiaryId] = useState<number | null>(null);

  // Detailed Entity State
  const [detailedType, setDetailedType] = useState<'customer' | 'supplier' | 'personnel' | 'bank_account' | 'all'>('all');
  const [selectedDetailedEntityId, setSelectedDetailedEntityId] = useState<string>('');
  const [selectedFilterAccountId, setSelectedFilterAccountId] = useState<string>('');
  const [detailedSearchName, setDetailedSearchName] = useState<string>('');

  // Segregated customers vs suppliers
  const supplierEntities = useMemo(() => {
    return customers.filter(c => c.partyType === 'supplier' || c.partyType === 'both' || c.party_type === 'supplier' || c.party_type === 'both');
  }, [customers]);

  const customerEntities = useMemo(() => {
    return customers.filter(c => c.partyType === 'customer' || c.partyType === 'both' || c.party_type === 'customer' || c.party_type === 'both' || (!c.partyType && !c.party_type));
  }, [customers]);

  // Date Filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Search Filter
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Transactions Data & Loading State
  const [transactions, setTransactions] = useState<VoucherItemRow[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState<boolean>(false);
  const [summaryStats, setSummaryStats] = useState({ totalDebit: 0, totalCredit: 0, finalBalance: 0 });

  // Single Voucher Detail View Modal State
  const [selectedVoucherModal, setSelectedVoucherModal] = useState<JournalVoucher | null>(null);
  const [, setIsLoadingVoucherDetail] = useState<boolean>(false);

  // Fetch Ledger / Transactions Data when selection changes
  useEffect(() => {
    let targetAccountId: number | undefined = undefined;
    let targetDetailedType: string | undefined = undefined;
    let targetDetailedId: number | undefined = undefined;

    if (activeMode === 'hierarchy') {
      if (selectedSubsidiaryId) {
        targetAccountId = selectedSubsidiaryId;
      } else if (selectedGeneralId) {
        targetAccountId = selectedGeneralId;
      } else if (selectedGroupId) {
        targetAccountId = selectedGroupId;
      }
    } else {
      if (selectedFilterAccountId) {
        targetAccountId = Number(selectedFilterAccountId);
      }
      if (detailedType !== 'all') {
        targetDetailedType = detailedType;
      }
      if (selectedDetailedEntityId) {
        targetDetailedId = Number(selectedDetailedEntityId);
      }
    }

    const loadTransactions = async () => {
      setIsLoadingTransactions(true);
      try {
        const queryParams = new URLSearchParams();
        if (targetAccountId) queryParams.set('accountId', targetAccountId.toString());
        if (targetDetailedType) queryParams.set('detailedType', targetDetailedType);
        if (targetDetailedId) queryParams.set('detailedId', targetDetailedId.toString());
        if (detailedSearchName) queryParams.set('detailedName', detailedSearchName);
        if (startDate) queryParams.set('startDate', startDate);
        if (endDate) queryParams.set('endDate', endDate);

        const res = await fetchJson<{ items: VoucherItemRow[]; totalDebit: number; totalCredit: number; finalBalance: number }>(
          `/accounting/reports/ledger?${queryParams.toString()}`
        );
        if (res) {
          setTransactions(Array.isArray(res.items) ? res.items : []);
          setSummaryStats({
            totalDebit: res.totalDebit || 0,
            totalCredit: res.totalCredit || 0,
            finalBalance: res.finalBalance || 0
          });
        }
      } catch (err) {
        console.error('Error fetching explorer transactions:', err);
      } finally {
        setIsLoadingTransactions(false);
      }
    };

    loadTransactions();
  }, [
    activeMode, 
    selectedGroupId, 
    selectedGeneralId, 
    selectedSubsidiaryId, 
    detailedType, 
    selectedDetailedEntityId, 
    selectedFilterAccountId,
    detailedSearchName,
    startDate, 
    endDate
  ]);

  // Load Voucher details for Drill-down modal
  const handleOpenVoucherModal = async (voucherId: number) => {
    setIsLoadingVoucherDetail(true);
    try {
      const v = await fetchJson<JournalVoucher>(`/accounting/vouchers/${voucherId}`);
      if (v) {
        setSelectedVoucherModal(v);
      }
    } catch (err) {
      console.error('Error fetching voucher detail:', err);
    } finally {
      setIsLoadingVoucherDetail(false);
    }
  };

  // Build Accounts Map and Calculation Trees
  const groupsList = useMemo(() => safeAccounts.filter(a => a.level === 'group'), [safeAccounts]);
  const generalsList = useMemo(() => {
    if (!selectedGroupId) return [];
    return safeAccounts.filter(a => a.level === 'general' && a.parentId === selectedGroupId);
  }, [safeAccounts, selectedGroupId]);

  const subsidiariesList = useMemo(() => {
    if (!selectedGeneralId) return [];
    return safeAccounts.filter(a => (a.level === 'subsidiary' || a.level === 'detailed') && a.parentId === selectedGeneralId);
  }, [safeAccounts, selectedGeneralId]);

  // Breadcrumbs text
  const selectedGroupObj = useMemo(() => safeAccounts.find(a => a.id === selectedGroupId), [safeAccounts, selectedGroupId]);
  const selectedGeneralObj = useMemo(() => safeAccounts.find(a => a.id === selectedGeneralId), [safeAccounts, selectedGeneralId]);
  const selectedSubsidiaryObj = useMemo(() => safeAccounts.find(a => a.id === selectedSubsidiaryId), [safeAccounts, selectedSubsidiaryId]);

  // Reset drilldown
  const handleResetBreadcrumbs = () => {
    setSelectedGroupId(null);
    setSelectedGeneralId(null);
    setSelectedSubsidiaryId(null);
  };

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // Export CSV function
  const handleExportCSV = () => {
    if (!transactions.length) return;
    const headers = ["شماره سند", "تاریخ", "کد حساب", "نام حساب", "تفصیلی", "شرح آرتیکل", "بدهکار", "بستانکار", "مانده"];
    const rows = transactions.map(t => [
      t.voucherNumber,
      formatPersianDate(t.date, { englishDigits: true }),
      t.accountCode,
      t.accountName,
      t.detailedName || '-',
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.debit,
      t.credit,
      t.runningBalance
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `مرور_حساب‌ها_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 font-farsi text-right">
      {/* Top Header & View Modes Switcher */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-4 no-print">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <span>مرور حساب‌ها و کاوشگر اسناد دوبل مالی</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              کاوش سلسله‌مراتبی از گروه و کل تا معین، تفصیلی و ریز ردیف‌های اسناد حسابداری
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveMode('hierarchy');
                setSelectedDetailedEntityId('');
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeMode === 'hierarchy'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Layers size={16} />
              <span>مرور درختی و سطحی حساب‌ها</span>
            </button>

            <button
              onClick={() => {
                setActiveMode('detailed_entity');
                handleResetBreadcrumbs();
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeMode === 'detailed_entity'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Users size={16} />
              <span>کارت حساب تفصیلی شناور (اشخاص / بانک)</span>
            </button>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
          {/* Detailed Entity Selectors (Only shown in detailed_entity mode) */}
          {activeMode === 'detailed_entity' ? (
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <select
                value={detailedType}
                onChange={(e) => {
                  setDetailedType(e.target.value as any);
                  setSelectedDetailedEntityId('');
                }}
                className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white font-medium"
              >
                <option value="all">همه انواع تفصیلی‌ها</option>
                <option value="customer">مشتریان و خریداران</option>
                <option value="supplier">تامین‌کنندگان و فروشندگان مواد اولیه</option>
                <option value="personnel">پرسنل و همکاران کارگاه</option>
                <option value="bank_account">حساب‌های بانکی و صندوق‌ها</option>
              </select>

              {/* Specific Entity Select */}
              {detailedType === 'customer' && (
                <SearchableSelect
                  value={selectedDetailedEntityId}
                  onChange={(val) => setSelectedDetailedEntityId(val)}
                  className="w-64"
                  placeholder="جستجو یا انتخاب مشتری..."
                  options={((customerEntities.length > 0 ? customerEntities : customers)).map((c) => ({
                    value: String(c.id),
                    label: `${c.name} ${c.city ? `(${c.city})` : ''}`
                  }))}
                />
              )}

              {detailedType === 'supplier' && (
                <SearchableSelect
                  value={selectedDetailedEntityId}
                  onChange={(val) => setSelectedDetailedEntityId(val)}
                  className="w-64"
                  placeholder="جستجو یا انتخاب تامین‌کننده..."
                  options={((supplierEntities.length > 0 ? supplierEntities : customers)).map((c) => ({
                    value: String(c.id),
                    label: `${c.name} ${c.city ? `(${c.city})` : ''} ${c.supplierCategory ? `[${c.supplierCategory}]` : ''}`
                  }))}
                />
              )}

              {detailedType === 'personnel' && (
                <SearchableSelect
                  value={selectedDetailedEntityId}
                  onChange={(val) => setSelectedDetailedEntityId(val)}
                  className="w-64"
                  placeholder="جستجو یا انتخاب پرسنل..."
                  options={(Array.isArray(personnelList) ? personnelList : []).map((p) => ({
                    value: String(p.id),
                    label: `${p.fullName} (${p.jobTitle || 'پرسنل'})`
                  }))}
                />
              )}

              {detailedType === 'bank_account' && (
                <SearchableSelect
                  value={selectedDetailedEntityId}
                  onChange={(val) => setSelectedDetailedEntityId(val)}
                  className="w-64"
                  placeholder="جستجو یا انتخاب حساب بانکی..."
                  options={(Array.isArray(bankAccounts) ? bankAccounts : []).map((b) => ({
                    value: String(b.id),
                    label: `${b.bankName} - ${b.accountNumber}`
                  }))}
                />
              )}

              {/* Optional Account Filter */}
              <select
                value={selectedFilterAccountId}
                onChange={(e) => setSelectedFilterAccountId(e.target.value)}
                className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white font-medium max-w-[200px] truncate"
              >
                <option value="">همه سرفصل‌های کدینگ</option>
                {safeAccounts
                  .filter(a => a.level === 'subsidiary' || a.level === 'general')
                  .map((a, idx) => (
                    <option key={`acc-flt-${a.id || idx}-${idx}`} value={a.id}>{a.code} - {a.name}</option>
                  ))
                }
              </select>

              {/* Free Text Detailed Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="جستجوی نام تفصیلی..."
                  value={detailedSearchName}
                  onChange={(e) => setDetailedSearchName(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white w-48"
                />
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              </div>
            </div>
          ) : (
            /* Search in Hierarchy Mode */
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="جستجو در کد یا عنوان حساب..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-700/80 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
              />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            </div>
          )}

          {/* Date Range Pickers & Export Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <DatePicker
                value={startDate}
                onChange={(date: any) => setStartDate(extractDateString(date))}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                placeholder="از تاریخ..."
                inputClass="w-28 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-center text-slate-800 dark:text-white outline-none"
              />
              <span className="text-slate-400 text-xs">تا</span>
              <DatePicker
                value={endDate}
                onChange={(date: any) => setEndDate(extractDateString(date))}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                placeholder="تا تاریخ..."
                inputClass="w-28 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-center text-slate-800 dark:text-white outline-none"
              />
            </div>

            {(startDate || endDate) && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                title="پاکسازی تاریخ"
                className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <RotateCcw size={14} />
              </button>
            )}

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 my-auto hidden sm:block" />

            <button
              onClick={handlePrint}
              className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Printer size={14} />
              <span className="hidden sm:inline">چاپ</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download size={14} />
              <span className="hidden sm:inline">خروجی اکسل</span>
            </button>
          </div>
        </div>
      </div>

      {/* Hierarchy Mode: Breadcrumb Navigation Bar */}
      {activeMode === 'hierarchy' && (
        <div className="bg-white dark:bg-slate-800 px-5 py-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-2xs flex flex-wrap items-center gap-2 text-xs no-print">
          <button
            onClick={handleResetBreadcrumbs}
            className={`font-bold transition flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer ${
              !selectedGroupId
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Layers size={14} />
            <span>همه گروه‌های حساب</span>
          </button>

          {selectedGroupObj && (
            <>
              <ChevronLeft size={14} className="text-slate-400" />
              <button
                onClick={() => {
                  setSelectedGeneralId(null);
                  setSelectedSubsidiaryId(null);
                }}
                className={`font-bold transition flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer ${
                  selectedGroupId && !selectedGeneralId
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <span className="font-mono text-[11px] text-indigo-500">[{selectedGroupObj.code}]</span>
                <span>{selectedGroupObj.name}</span>
              </button>
            </>
          )}

          {selectedGeneralObj && (
            <>
              <ChevronLeft size={14} className="text-slate-400" />
              <button
                onClick={() => setSelectedSubsidiaryId(null)}
                className={`font-bold transition flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer ${
                  selectedGeneralId && !selectedSubsidiaryId
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <span className="font-mono text-[11px] text-indigo-500">[{selectedGeneralObj.code}]</span>
                <span>{selectedGeneralObj.name}</span>
              </button>
            </>
          )}

          {selectedSubsidiaryObj && (
            <>
              <ChevronLeft size={14} className="text-slate-400" />
              <div className="font-bold bg-indigo-600 text-white px-2.5 py-1 rounded-lg flex items-center gap-1">
                <span className="font-mono text-[11px]">[{selectedSubsidiaryObj.code}]</span>
                <span>{selectedSubsidiaryObj.name}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main Account Tree Selector Grid (Only when hierarchy mode & not at deepest subsidiary level) */}
      {activeMode === 'hierarchy' && !selectedSubsidiaryId && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-indigo-500" />
              <span>
                {!selectedGroupId
                  ? 'انتخاب گروه حساب جهت مرور (سطح ۱)'
                  : !selectedGeneralId
                  ? `حساب‌های کل در گروه «${selectedGroupObj?.name}» (سطح ۲)`
                  : `حساب‌های معین در کل «${selectedGeneralObj?.name}» (سطح ۳)`}
              </span>
            </h3>
            <span className="text-xs text-slate-400">
              برای مشاهده زیرمجموعه‌ها یا تراکنش‌ها روی سرفصل کلیک کنید
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Level 1: Groups */}
            {!selectedGroupId && groupsList.map((grp) => (
              <div
                key={grp.id}
                onClick={() => setSelectedGroupId(grp.id)}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition cursor-pointer group space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md">
                    کد {grp.code}
                  </span>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-transform group-hover:-translate-x-1" />
                </div>
                <div className="font-bold text-slate-800 dark:text-white text-sm">
                  {grp.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60">
                  <span>نوع: {grp.accountType === 'asset' ? 'دارایی' : grp.accountType === 'liability' ? 'بدهی' : grp.accountType === 'equity' ? 'سرمایه' : grp.accountType === 'revenue' ? 'درآمد' : 'هزینه'}</span>
                  <span>سطح: گروه</span>
                </div>
              </div>
            ))}

            {/* Level 2: General Accounts under selected Group */}
            {selectedGroupId && !selectedGeneralId && generalsList.map((gen) => (
              <div
                key={gen.id}
                onClick={() => setSelectedGeneralId(gen.id)}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition cursor-pointer group space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md">
                    کد کل {gen.code}
                  </span>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-transform group-hover:-translate-x-1" />
                </div>
                <div className="font-bold text-slate-800 dark:text-white text-sm">
                  {gen.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60">
                  <span>ماهیت: {gen.nature === 'debit' ? 'بدهکار' : gen.nature === 'credit' ? 'بستانکار' : 'دوگانه'}</span>
                  <span className="text-indigo-600 font-medium">مشاهده معین‌ها ➔</span>
                </div>
              </div>
            ))}

            {/* Level 3: Subsidiary Accounts under selected General Account */}
            {selectedGeneralId && !selectedSubsidiaryId && subsidiariesList.map((sub) => (
              <div
                key={sub.id}
                onClick={() => setSelectedSubsidiaryId(sub.id)}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition cursor-pointer group space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">
                    کد معین {sub.code}
                  </span>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-transform group-hover:-translate-x-1" />
                </div>
                <div className="font-bold text-slate-800 dark:text-white text-sm">
                  {sub.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60">
                  <span>سطح: معین</span>
                  <span className="text-emerald-600 font-bold">مشاهده کاردکس گردش ➔</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary KPI Cards for Active Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
            <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
            <span>جمع گردش بدهکار (دریافت‌ها)</span>
          </div>
          <div className="text-lg font-black text-slate-900 dark:text-white font-mono">
            {formatPersianPrice(summaryStats.totalDebit, appCurrency)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
            <ArrowUpRight className="w-4 h-4 text-rose-500" />
            <span>جمع گردش بستانکار (پرداخت‌ها)</span>
          </div>
          <div className="text-lg font-black text-slate-900 dark:text-white font-mono">
            {formatPersianPrice(summaryStats.totalCredit, appCurrency)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-2xs space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span className="font-medium">مانده نهایی حساب</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              summaryStats.finalBalance > 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : summaryStats.finalBalance < 0
                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
            }`}>
              {summaryStats.finalBalance > 0 ? 'بدهکار' : summaryStats.finalBalance < 0 ? 'بستانکار' : 'تسویه'}
            </span>
          </div>
          <div className={`text-lg font-black font-mono ${
            summaryStats.finalBalance > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : summaryStats.finalBalance < 0
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-900 dark:text-white'
          }`}>
            {formatPersianPrice(Math.abs(summaryStats.finalBalance), appCurrency)}
          </div>
        </div>
      </div>

      {/* Main Ledger & Transactions Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-500" />
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">
              کاردکس و ریز آرتیکل‌های اسناد حسابداری ({formatPersianNumber(transactions.length)} ردیف)
            </h3>
          </div>
          {isLoadingTransactions && (
            <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span>در حال به‌روزرسانی تراکنش‌ها...</span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-100/80 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-3 w-12 text-center">#</th>
                <th className="py-3 px-3 w-20 text-center">شماره سند</th>
                <th className="py-3 px-3 w-24 text-center">تاریخ</th>
                <th className="py-3 px-3 min-w-[140px]">کد و نام حساب</th>
                <th className="py-3 px-3 min-w-[130px]">طرف حساب / تفصیلی</th>
                <th className="py-3 px-3 min-w-[200px]">شرح آرتیکل سند</th>
                <th className="py-3 px-3 w-28 text-left">{`بدهکار (${curLbl})`}</th>
                <th className="py-3 px-3 w-28 text-left">{`بستانکار (${curLbl})`}</th>
                <th className="py-3 px-3 w-32 text-left">مانده لحظه‌ای</th>
                <th className="py-3 px-3 w-16 text-center no-print">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-slate-700 dark:text-slate-300">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      <span>هیچ تراکنش یا سند حسابداری برای این فیلترها ثبت نشده است</span>
                    </div>
                  </td>
                </tr>
              ) : (
                transactions.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition">
                    <td className="py-3 px-3 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {formatPersianNumber(item.voucherNumber)}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-600 dark:text-slate-400">
                      {formatPersianDate(item.date)}
                    </td>
                    <td className="py-3 px-3 font-medium">
                      <span className="font-mono text-[11px] text-slate-500 ml-1">[{item.accountCode}]</span>
                      <span>{item.accountName}</span>
                    </td>
                    <td className="py-3 px-3">
                      {item.detailedName ? (
                        <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                          <User size={12} className="text-slate-400" />
                          <span>{item.detailedName}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate" title={item.description}>
                      {item.description || '-'}
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {item.debit ? formatPersianPrice(item.debit) : '-'}
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-bold text-rose-600 dark:text-rose-400">
                      {item.credit ? formatPersianPrice(item.credit) : '-'}
                    </td>
                    <td className={`py-3 px-3 text-left font-mono font-bold ${
                      item.runningBalance > 0 ? 'text-emerald-600 dark:text-emerald-400' : item.runningBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600'
                    }`}>
                      {formatPersianPrice(Math.abs(item.runningBalance))}
                      <span className="text-[10px] text-slate-400 mr-1 font-farsi font-normal">
                        {item.runningBalance > 0 ? 'بد' : item.runningBalance < 0 ? 'بس' : 'تسویه'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center no-print">
                      <button
                        onClick={() => handleOpenVoucherModal(item.voucherId)}
                        title="مشاهده کامل سند حسابداری"
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition cursor-pointer"
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down Voucher Detail Modal */}
      {selectedVoucherModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-farsi text-right">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    سند حسابداری شماره {formatPersianNumber(selectedVoucherModal.voucherNumber)}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    تاریخ ثبت: {formatPersianDate(selectedVoucherModal.date)} | وضعیت: {selectedVoucherModal.status === 'permanent' ? 'دائمی' : 'تاییدشده'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedVoucherModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="bg-slate-50 dark:bg-slate-700/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                <span className="font-bold text-slate-900 dark:text-white ml-1">شرح کلی سند:</span>
                <span>{selectedVoucherModal.description || 'بدون شرح'}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <thead className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold">
                    <tr>
                      <th className="p-2.5 w-10 text-center">ردیف</th>
                      <th className="p-2.5">کد و عنوان حساب</th>
                      <th className="p-2.5">طرف حساب / تفصیلی</th>
                      <th className="p-2.5">شرح آرتیکل</th>
                      <th className="p-2.5 text-left">{`بدهکار (${curLbl})`}</th>
                      <th className="p-2.5 text-left">{`بستانکار (${curLbl})`}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-slate-800 dark:text-slate-200">
                    {selectedVoucherModal.items?.map((it, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                        <td className="p-2.5 font-medium">
                          <span className="font-mono text-[11px] text-indigo-600 ml-1">[{it.accountCode}]</span>
                          <span>{it.accountName}</span>
                        </td>
                        <td className="p-2.5">{it.detailedName || '-'}</td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-300">{it.description || '-'}</td>
                        <td className="p-2.5 text-left font-mono font-bold text-emerald-600">
                          {it.debit ? formatPersianPrice(it.debit) : '-'}
                        </td>
                        <td className="p-2.5 text-left font-mono font-bold text-rose-600">
                          {it.credit ? formatPersianPrice(it.credit) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end gap-2">
              <button
                onClick={() => setSelectedVoucherModal(null)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
