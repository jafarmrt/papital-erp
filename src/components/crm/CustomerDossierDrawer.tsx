import { useState, useEffect } from 'react';
import { Building2, Users, Briefcase, Plus, PhoneCall, FileText, X, Edit2, TrendingUp, Award, ExternalLink, BookOpen, ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { Customer, CRMLead, CRMActivity } from '../../types';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel, formatPersianDate, formatPersianPhone } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { STAGES } from '../../hooks/useCRMData';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';

interface CustomerDossierDrawerProps {
  customer: Customer | null;
  onClose: () => void;
  allLeads: CRMLead[];
  allActivities: CRMActivity[];
  onOpenLeadDrawer: (lead: CRMLead) => void;
  onOpenLeadModal: (lead?: CRMLead, defaultCustomerName?: string) => void;
  onOpenActivityModal: (lead?: CRMLead, defaultCustomerName?: string, defaultCustomerId?: number) => void;
  onEditCustomer?: (customer: Customer) => void;
}

export function CustomerDossierDrawer({
  customer,
  onClose,
  allLeads = [],
  allActivities = [],
  onOpenLeadDrawer,
  onOpenLeadModal,
  onOpenActivityModal,
  onEditCustomer
}: CustomerDossierDrawerProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const [activeTab, setActiveTab] = useState<'overview' | 'leads' | 'activities' | 'documents' | 'financials' | 'contacts'>('overview');
  const [documents, setDocuments] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [financialReport, setFinancialReport] = useState<any | null>(null);
  const [loadingFinancials, setLoadingFinancials] = useState(false);

  // Filter leads and activities belonging to this customer
  const customerLeads = allLeads.filter(
    (l) => l.customerId === customer?.id || (l.customerName && customer?.name && l.customerName.trim().toLowerCase() === customer.name.trim().toLowerCase())
  );

  const leadIds = new Set(customerLeads.map((l) => l.id));
  const customerActivities = allActivities.filter(
    (a) => a.customerId === customer?.id || (a.leadId && leadIds.has(a.leadId))
  );

  // Stats
  const totalLeadsCount = customerLeads.length;
  const totalPipelineValue = customerLeads.reduce((acc, l) => acc + (l.estimatedValue || 0), 0);
  const wonLeads = customerLeads.filter((l) => l.stage === 'won');
  const wonValue = wonLeads.reduce((acc, l) => acc + (l.estimatedValue || 0), 0);

  // Load documents and accounting read model for this customer
  useEffect(() => {
    if (!customer) return;
    const controller = new AbortController();

    setLoadingDocs(true);
    fetchJson(`/documents?search=${encodeURIComponent(customer.name)}&limit=50`, { signal: controller.signal })
      .then((res) => {
        // V3.0.7 (TD-066): Array Safety Guard (قاعده #2 AGENTS)
        const docs = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        setDocuments(docs);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load customer documents:', err);
        toast.error('خطا در دریافت اسناد مشتری');
        setDocuments([]);
      })
      .finally(() => setLoadingDocs(false));

    // Load double-entry accounting read model (Subphase 11.2)
    setLoadingFinancials(true);
    fetchJson(`/accounting/reports/account-card?detailedType=customer&detailedId=${customer.id}&detailedName=${encodeURIComponent(customer.name)}`, { signal: controller.signal })
      .then((rep) => {
        setFinancialReport(rep || null);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load customer accounting card:', err);
        toast.error('خطا در دریافت کارت حساب و صورت‌حساب مالی مشتری');
        setFinancialReport(null);
      })
      .finally(() => setLoadingFinancials(false));

    return () => controller.abort();
  }, [customer]);

  if (!customer) return null;

  const contactsList = customer.contacts && Array.isArray(customer.contacts) && customer.contacts.length > 0
    ? customer.contacts
    : [
        {
          id: '1',
          name: customer.contactName || 'رابط اصلی',
          role: 'رابط اصلی',
          phone: customer.phone || '',
          isPrimary: true,
        },
      ];

  const customerCurrency = (customer as any)?.currency || 'IRR';
  const rawBalance = financialReport?.finalBalance || 0;
  const netBalance = Math.abs(rawBalance);
  const balanceType = financialReport 
    ? (rawBalance > 0 ? 'debit' : rawBalance < 0 ? 'credit' : 'settled') 
    : 'settled';
  const rawLedger = financialReport?.items || financialReport?.entries;
  const ledgerItems = Array.isArray(rawLedger) ? rawLedger : [];
  const totalDebit = financialReport?.totalDebit ?? financialReport?.debitTurnover ?? 0;
  const totalCredit = financialReport?.totalCredit ?? financialReport?.creditTurnover ?? 0;

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs flex justify-end">
      <div className="bg-white w-full md:w-[65%] lg:w-[65%] max-w-[65vw] h-full shadow-2xl flex flex-col p-6 overflow-y-auto custom-scrollbar animate-in slide-in-from-left duration-200 text-right font-farsi">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shrink-0">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-black rounded-md">
                  پرونده جامع مشتری
                </span>
                <span className="text-xs text-slate-400 font-mono">کد #{customer.id}</span>
              </div>
              <h2 className="text-lg font-black text-slate-900 mt-0.5">{customer.name}</h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onEditCustomer && (
              <button
                onClick={() => onEditCustomer(customer)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Edit2 size={14} />
                ویرایش حساب
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Quick KPI Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 shrink-0">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
            <span className="text-[10px] font-bold text-slate-500 block mb-1">فرصت‌های فروش (CRM)</span>
            <div className="flex items-center gap-1.5">
              <Briefcase size={16} className="text-blue-600" />
              <span className="text-base font-black text-slate-900">{formatPersianNumber(totalLeadsCount)} پرونده</span>
            </div>
          </div>

          <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3">
            <span className="text-[10px] font-bold text-emerald-800 block mb-1">معاملات موفق (Won)</span>
            <div className="flex items-center gap-1.5">
              <Award size={16} className="text-emerald-600" />
              <span className="text-base font-black text-emerald-900">
                {formatPersianNumber(wonLeads.length)} مورد ({formatPersianPrice(wonValue)})
              </span>
            </div>
          </div>

          <div className="bg-purple-50/60 border border-purple-200/80 rounded-xl p-3">
            <span className="text-[10px] font-bold text-purple-800 block mb-1">ارزش کل قیف مشتری</span>
            <div className="flex items-center gap-1.5">
              <TrendingUp size={16} className="text-purple-600" />
              <span className="text-base font-black text-purple-900">{formatPersianPrice(totalPipelineValue)}</span>
            </div>
          </div>

          {/* Real-time Accounting Balance Metric (Subphase 11.2) */}
          <div className={`rounded-xl p-3 border ${
            balanceType === 'debit'
              ? 'bg-rose-50/70 border-rose-200/80'
              : balanceType === 'credit'
              ? 'bg-emerald-50/70 border-emerald-200/80'
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-600">مانده حساب مالی (حسابداری)</span>
              <Scale size={13} className={balanceType === 'debit' ? 'text-rose-600' : balanceType === 'credit' ? 'text-emerald-600' : 'text-slate-400'} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-base font-black font-mono ${
                balanceType === 'debit' ? 'text-rose-700' : balanceType === 'credit' ? 'text-emerald-700' : 'text-slate-800'
              }`}>
                {formatPersianPrice(netBalance)} {formatCurrencyLabel(customerCurrency)}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                balanceType === 'debit'
                  ? 'bg-rose-100 text-rose-800'
                  : balanceType === 'credit'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
              }`}>
                {balanceType === 'debit' ? 'بدهکار' : balanceType === 'credit' ? 'بستانکار' : 'تسویه'}
              </span>
            </div>
          </div>
        </div>

        {/* Dossier Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-slate-200 pb-3 mb-4 overflow-x-auto custom-scrollbar shrink-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <Briefcase size={14} />
            خلاصه و فرصت‌های فروش ({customerLeads.length})
          </button>

          <button
            onClick={() => setActiveTab('activities')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'activities'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <PhoneCall size={14} />
            سوابق تعاملات ({customerActivities.length})
          </button>

          <button
            onClick={() => setActiveTab('documents')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'documents'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <FileText size={14} />
            پیش‌فاکتورها و اسناد ({documents.length})
          </button>

          <button
            onClick={() => setActiveTab('financials')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'financials'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <BookOpen size={14} />
            گردش و تراز مالی حسابداری
          </button>

          <button
            onClick={() => setActiveTab('contacts')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'contacts'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <Users size={14} />
            اشخاص رابط و آدرس ({contactsList.length})
          </button>
        </div>

        {/* Tab 1: Sales Leads & Opportunities */}
        {activeTab === 'overview' && (
          <div className="space-y-4 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-xs text-slate-800 flex items-center gap-1.5">
                <Briefcase size={15} className="text-blue-600" />
                لیست فرصت‌ها و پرونده‌های فروش این مشتری
              </h3>
              <button
                onClick={() => onOpenLeadModal(undefined, customer.name)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <Plus size={14} />
                ثبت فرصت فروش جدید
              </button>
            </div>

            {customerLeads.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl space-y-2">
                <Briefcase size={32} className="mx-auto text-slate-300" />
                <p className="text-xs font-bold text-slate-600">هنوز هیچ فرصت فروشی برای این مشتری ایجاد نشده است.</p>
                <button
                  onClick={() => onOpenLeadModal(undefined, customer.name)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-xl inline-flex items-center gap-1"
                >
                  <Plus size={14} /> ایجاد اولین فرصت فروش
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {customerLeads.map((lead) => {
                  const stageObj = STAGES.find((s) => s.key === lead.stage);
                  return (
                    <div
                      key={lead.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs hover:border-blue-300 transition-all space-y-3 relative group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${stageObj?.color || 'bg-slate-100 text-slate-700'}`}>
                            {stageObj?.title || lead.stage}
                          </span>
                          <h4 className="font-black text-sm text-slate-900 mt-1">{lead.title}</h4>
                        </div>
                        <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                          {formatPersianPrice(lead.estimatedValue || 0)} {formatCurrencyLabel(lead.currency)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                        <div>
                          <span>مسئول فروش: </span>
                          <span className="font-bold text-slate-700">{lead.assignedTo || 'تعیین نشده'}</span>
                        </div>
                        <div>
                          <span>تاریخ بسته‌شدن: </span>
                          <span className="font-bold text-slate-700">{lead.expectedCloseDate || '-'}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          onClick={() => onOpenActivityModal(lead, customer.name)}
                          className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <PhoneCall size={12} /> ثبت اقدام
                        </button>
                        <button
                          onClick={() => onOpenLeadDrawer(lead)}
                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <ExternalLink size={12} /> مشاهده پرونده
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Activity History */}
        {activeTab === 'activities' && (
          <div className="space-y-4 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-xs text-slate-800 flex items-center gap-1.5">
                <PhoneCall size={15} className="text-amber-600" />
                تاریخچه کامل تماس‌ها و پیگیری‌های این مشتری
              </h3>
              <button
                onClick={() => onOpenActivityModal(undefined, customer.name, customer.id)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <Plus size={14} />
                ثبت تماس / تعامل جدید
              </button>
            </div>

            {customerActivities.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl space-y-2">
                <PhoneCall size={32} className="mx-auto text-slate-300" />
                <p className="text-xs font-bold text-slate-600">هیچ سابقه تماس یا اقدامی برای این مشتری ثبت نشده است.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {customerActivities.map((act) => (
                  <div key={act.id} className="bg-slate-50/80 rounded-2xl border border-slate-200 p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-800 font-bold text-[10px] rounded-md">
                          {act.type === 'call' ? 'تماس تلفنی' : act.type === 'meeting' ? 'جلسه حضوری' : act.type === 'whatsapp' ? 'واتساپ/پیام' : act.type === 'quote' ? 'پیش‌فاکتور' : 'یادداشت'}
                        </span>
                        <span className="font-bold text-slate-900">{act.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{formatPersianDate(act.activityDate || act.createdAt)}</span>
                    </div>

                    {act.description && <p className="text-slate-600 leading-relaxed text-[11px] bg-white p-2.5 rounded-xl border border-slate-100">{act.description}</p>}

                    {act.result && (
                      <div className="p-2 bg-emerald-50 text-emerald-900 border border-emerald-200/60 rounded-xl text-[11px] font-medium">
                        نتیجه: {act.result}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-200/60">
                      <span>ثبت‌کننده: {act.loggedBy || 'فروشنده'}</span>
                      {act.nextFollowUpDate && (
                        <span className="font-bold text-amber-800 bg-amber-100/60 px-2 py-0.5 rounded-md">
                          پیگیری بعدی: {act.nextFollowUpDate} ({act.isFollowUpCompleted ? 'انجام شده' : 'معوقه'})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Documents & Invoices */}
        {activeTab === 'documents' && (
          <div className="space-y-4 flex-1">
            <h3 className="font-black text-xs text-slate-800 flex items-center gap-1.5">
              <FileText size={15} className="text-blue-600" />
              پیش‌فاکتورها و فاکتورهای فروش صادرشده
            </h3>

            {loadingDocs ? (
              <div className="p-8 text-center text-slate-400 text-xs animate-pulse">در حال دریافت فاکتورهای مشتری...</div>
            ) : documents.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-xs text-slate-500">
                هیچ پیش‌فاکتور یا فاکتوری برای این خریدار صادر نشده است.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 text-slate-500 border-b">
                    <tr>
                      <th className="p-2.5">شماره سند</th>
                      <th className="p-2.5">نوع سند</th>
                      <th className="p-2.5">تاریخ</th>
                      <th className="p-2.5">مبلغ کل</th>
                      <th className="p-2.5">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-slate-700">
                    {documents.map((doc: any) => (
                      <tr key={doc.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold font-mono text-blue-700">#{doc.refNumber || doc.ref_number || doc.id}</td>
                        <td className="p-2.5 font-bold">
                          {doc.type === 'proforma' ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-md text-[10px]">پیش‌فاکتور</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded-md text-[10px]">فاکتور نهایی</span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono">{formatPersianDate(doc.date)}</td>
                        <td className="p-2.5 font-bold font-mono text-emerald-800">{formatPersianPrice(doc.totalAmount || doc.net_amount || 0)} {formatCurrencyLabel(doc.currency)}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded text-[10px]">{doc.status || 'نهایی'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Double-entry Accounting Read Model (Subphase 11.2) */}
        {activeTab === 'financials' && (
          <div className="space-y-4 flex-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-black text-xs text-slate-900 flex items-center gap-1.5">
                  <BookOpen size={16} className="text-blue-600" />
                  کارت تفصیلی و گردش مالی حسابداری (Double-Entry Ledger)
                </h3>
                <p className="text-[11px] text-slate-500">
                  اطلاعات مستقیم و بدون واسطه از دفتر کل و اسناد حسابداری دوبل صادرشده
                </p>
              </div>
            </div>

            {loadingFinancials ? (
              <div className="p-8 text-center text-slate-400 text-xs animate-pulse">در حال فراخوانی دفتر تفصیلی حسابداری...</div>
            ) : !financialReport ? (
              <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-xs text-slate-500">
                اطلاعات گردش حسابداری برای این حساب یافت نشد.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Financial Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                    <span className="text-[10px] font-bold text-slate-500 block mb-1">مجموع گردش بدهکار (خرید/فاکتورها)</span>
                    <div className="flex items-center gap-1 text-rose-700 font-mono font-black text-sm">
                      <ArrowUpRight size={14} />
                      <span>{formatPersianPrice(totalDebit)}</span>
                      <span className="text-[10px] font-normal">{formatCurrencyLabel(customerCurrency)}</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                    <span className="text-[10px] font-bold text-slate-500 block mb-1">مجموع گردش بستانکار (دریافتی‌ها/واریز)</span>
                    <div className="flex items-center gap-1 text-emerald-700 font-mono font-black text-sm">
                      <ArrowDownLeft size={14} />
                      <span>{formatPersianPrice(totalCredit)}</span>
                      <span className="text-[10px] font-normal">{formatCurrencyLabel(customerCurrency)}</span>
                    </div>
                  </div>

                  <div className={`border p-3.5 rounded-xl ${
                    balanceType === 'debit'
                      ? 'bg-rose-50/60 border-rose-200'
                      : balanceType === 'credit'
                      ? 'bg-emerald-50/60 border-emerald-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    <span className="text-[10px] font-bold text-slate-600 block mb-1">مانده نهایی دفتر تفصیلی</span>
                    <div className="flex items-center gap-1.5 font-mono font-black text-sm">
                      <span className={
                        balanceType === 'debit'
                          ? 'text-rose-700'
                          : balanceType === 'credit'
                          ? 'text-emerald-700'
                          : 'text-slate-800'
                      }>
                        {formatPersianPrice(netBalance)} {formatCurrencyLabel(customerCurrency)}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                        balanceType === 'debit'
                          ? 'bg-rose-100 text-rose-800'
                          : balanceType === 'credit'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}>
                        {balanceType === 'debit' ? 'بدهکار' : balanceType === 'credit' ? 'بستانکار' : 'تسویه'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ledger Entries Table */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-black text-xs text-slate-700">
                    ریز گردش ردیف‌های اسناد حسابداری ({ledgerItems.length} ردیف)
                  </div>
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-xs text-right border-collapse">
                      <thead className="bg-slate-100/70 text-slate-600 sticky top-0 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2.5">ردیف</th>
                          <th className="p-2.5">شماره سند</th>
                          <th className="p-2.5">تاریخ سند</th>
                          <th className="p-2.5">شرح آرتیکل حسابداری</th>
                          <th className="p-2.5 text-center">{`بدهکار (${curLbl})`}</th>
                          <th className="p-2.5 text-center">{`بستانکار (${curLbl})`}</th>
                          <th className="p-2.5 text-center">مانده پس از ردیف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                        {ledgerItems.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-400 font-normal">
                              ردیف سندی برای این حساب تفصیلی ثبت نشده است.
                            </td>
                          </tr>
                        ) : (
                          ledgerItems.map((entry: any, idx: number) => (
                            <tr key={entry.id || idx} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-2.5 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                              <td className="p-2.5 font-mono text-blue-700 font-black">
                                #{entry.voucherNumber || entry.voucherId}
                              </td>
                              <td className="p-2.5 font-mono text-slate-600 text-[11px]">
                                {formatPersianDate(entry.voucherDate || entry.date)}
                              </td>
                              <td className="p-2.5 text-slate-800 text-[11px] max-w-[220px] truncate" title={entry.description}>
                                {entry.description || '-'}
                              </td>
                              <td className="p-2.5 text-center font-mono text-rose-600">
                                {entry.debit > 0 ? formatPersianPrice(entry.debit) : '-'}
                              </td>
                              <td className="p-2.5 text-center font-mono text-emerald-600">
                                {entry.credit > 0 ? formatPersianPrice(entry.credit) : '-'}
                              </td>
                              <td className="p-2.5 text-center font-mono text-slate-900 font-black">
                                {formatPersianPrice(Math.abs(entry.runningBalance || 0))}
                                <span className="text-[10px] text-slate-400 font-normal mr-1">
                                  {entry.runningBalance > 0 ? '(بد)' : entry.runningBalance < 0 ? '(بس)' : '(تس)'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Account & Contact Persons */}
        {activeTab === 'contacts' && (
          <div className="space-y-4 flex-1">
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
              <h4 className="font-black text-xs text-slate-800 border-b border-slate-200 pb-2">اطلاعات جغرافیایی و آدرس</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px]">کشور / استان / شهر:</span>
                  <span className="font-bold text-slate-800">
                    {[customer.country, customer.province, customer.city].filter(Boolean).join(' - ') || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">شماره تماس اصلی:</span>
                  <span className="font-bold font-mono text-slate-800" dir="ltr">
                    {customer.phone ? formatPersianPhone(customer.phone) : '-'}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">آدرس کامل:</span>
                <span className="text-slate-700">{customer.address || '-'}</span>
              </div>
              {customer.notes && (
                <div>
                  <span className="text-slate-400 block text-[10px]">یادداشت‌های حساب:</span>
                  <p className="text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200 text-[11px]">{customer.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="font-black text-xs text-slate-800 flex items-center gap-1">
                <Users size={14} className="text-blue-600" />
                اشخاص رابط متصل به این حساب ({contactsList.length} نفر)
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {contactsList.map((contact, i) => (
                  <div key={contact.id || i} className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-slate-900">{contact.name || 'بدون نام'}</span>
                      {contact.isPrimary && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-bold rounded-md">
                          رابط اصلی
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 flex items-center gap-2">
                      <span className="bg-blue-50 text-blue-800 px-2 py-0.5 rounded text-[10px] font-bold">{contact.role || 'مدیر خرید'}</span>
                      <span dir="ltr" className="font-mono font-bold text-slate-800">
                        {contact.phone ? formatPersianPhone(contact.phone) : '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
