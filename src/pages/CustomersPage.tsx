import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchJson } from '../api';
import { Customer, ContactPerson, User, CRMLead, CRMActivity } from '../types';
import { Search, Plus, ChevronRight, ChevronLeft, Edit2, Trash2, X, UserPlus, Phone, Building2, UserCheck, Briefcase, Truck, Users, ArrowUpRight, ArrowDownLeft, CreditCard, FileText, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSearch } from '../SearchContext';
import { CustomerDossierDrawer } from '../components/crm/CustomerDossierDrawer';
import { CRMInteractionModal } from '../components/crm/CRMInteractionModal';
import CustomerFormModal, { FormContactPerson } from '../components/customers/CustomerFormModal';
import { CustomerExcelModal } from '../components/customers/CustomerExcelModal';
import { useCRMData } from '../hooks/useCRMData';
import { useCustomersQuery, useSaveCustomerMutation, useDeleteCustomerMutation } from '../hooks/queries';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/queryKeys';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../utils';
import { useAppCurrency } from '../hooks/useAppCurrency';

export default function CustomersPage({ user }: { user: User }) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { searchQuery: search, debouncedSearchQuery, setSearchQuery: setSearch, clearSearch } = useSearch();

  // Tab filter: 'all' | 'customer' | 'supplier'
  const [activeTab, setActiveTab] = useState<'all' | 'customer' | 'supplier'>('all');
  const [showModal, setShowModal] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedDossierCustomer, setSelectedDossierCustomer] = useState<Customer | null>(null);
  const [selectedLedgerCustomer, setSelectedLedgerCustomer] = useState<Customer | null>(null);
  const [ledgerData, setLedgerData] = useState<any | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [crmLeads, setCrmLeads] = useState<CRMLead[]>([]);
  const [crmActivities, setCrmActivities] = useState<CRMActivity[]>([]);
  const [page, setPage] = useState(1);

  // Sync tab with URL query parameter (?tab=suppliers or ?type=supplier)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab') || params.get('type');
    if (tabParam === 'suppliers' || tabParam === 'supplier') {
      setActiveTab('supplier');
    } else if (tabParam === 'customers' || tabParam === 'customer') {
      setActiveTab('customer');
    } else if (tabParam === 'all') {
      setActiveTab('all');
    }
  }, [location.search]);

  // V4 Phase 6.2 (یافته U-1): تغذیه کوئری مشتریان با debouncedSearchQuery جهت ممانعت از ارسال کی‌استروک‌های تکراری به سرور
  const { data: customersData, isLoading: loading } = useCustomersQuery(page, 50, debouncedSearchQuery, activeTab === 'all' ? undefined : activeTab);
  const customers = Array.isArray(customersData?.data) ? customersData.data : [];
  const totalPages = customersData?.totalPages || 1;
  const totalItems = customersData?.total || 0;

  // Reset page to 1 on debounced search or tab change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, activeTab]);

  const saveMutation = useSaveCustomerMutation();
  const deleteMutation = useDeleteCustomerMutation();
  const isSaving = saveMutation.isPending;

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/crm/leads', { signal: controller.signal }).then((res) => {
      // V3.0.7 (TD-066): Array Safety Guard (قاعده #2 AGENTS)
      const leads = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setCrmLeads(leads);
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load CRM leads:', err);
      toast.error('خطا در دریافت سرنخ‌های CRM');
    });

    fetchJson('/crm/activities', { signal: controller.signal }).then((res) => {
      const acts = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setCrmActivities(acts);
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load CRM activities:', err);
      toast.error('خطا در دریافت فعالیت‌های CRM');
    });

    return () => controller.abort();
  }, []);
  
  const [form, setForm] = useState({
    name: '',
    country: 'ایران',
    province: '',
    city: '',
    address: '',
    notes: '',
    partyType: 'customer' as 'customer' | 'supplier' | 'both',
    supplierCategory: '',
    bankInfo: {
      bankName: '',
      accountNumber: '',
      shaba: '',
      cardNumber: ''
    }
  });

  const [contacts, setContacts] = useState<FormContactPerson[]>([
    { id: '1', name: '', role: 'مدیر خرید', phone: '', isPrimary: true }
  ]);

  useEffect(() => {
    setPage(1);
  }, [search, activeTab]);

  const addContactPerson = () => {
    const newId = Date.now().toString();
    setContacts(prev => [
      ...prev,
      { id: newId, name: '', role: form.partyType === 'supplier' ? 'مدیر فروش' : 'حسابدار', phone: '', isPrimary: prev.length === 0 }
    ]);
  };

  const removeContactPerson = (id: string) => {
    setContacts(prev => {
      const filtered = prev.filter(c => c.id !== id);
      if (filtered.length > 0 && !filtered.some(c => c.isPrimary)) {
        filtered[0].isPrimary = true;
      }
      return filtered.length ? filtered : [{ id: Date.now().toString(), name: '', role: 'رابط اصلی', phone: '', isPrimary: true }];
    });
  };

  const updateContactPerson = (id: string, field: keyof FormContactPerson, value: any) => {
    setContacts(prev => prev.map(c => {
      if (c.id === id) {
        return { ...c, [field]: value };
      }
      return c;
    }));
  };

  const setPrimaryContact = (id: string) => {
    setContacts(prev => prev.map(c => ({
      ...c,
      isPrimary: c.id === id
    })));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate phone numbers
    const phoneRegex = /^[0-9+\-\s(),]+$/;
    for (const c of contacts) {
      if (c.phone.trim() && !phoneRegex.test(c.phone.trim())) {
        toast.error(`فرمت شماره تلفن «${c.phone}» مربوط به «${c.name || 'شخص رابط'}» معتبر نیست. لطفاً فقط عدد و کاراکترهای مجاز وارد کنید.`);
        return;
      }
    }
    
    const activeContacts = contacts.filter(c => c.name.trim() || c.phone.trim());

    const finalPayload = {
      name: form.name.trim(),
      country: form.country,
      province: form.province,
      city: form.city,
      address: form.address,
      notes: form.notes,
      partyType: form.partyType,
      supplierCategory: form.partyType !== 'customer' ? form.supplierCategory : '',
      bankInfo: form.bankInfo,
      contacts: activeContacts
    };

    saveMutation.mutate({ id: editingId, payload: finalPayload }, {
      onSuccess: () => {
        setShowModal(false);
        setEditingId(null);
        resetForm();
        toast.success(editingId ? 'اطلاعات طرف حساب با موفقیت به‌روزرسانی شد.' : 'طرف حساب جدید با موفقیت ثبت شد.');
      }
    });
  };
  
  const resetForm = () => {
    setForm({
      name: '',
      country: 'ایران',
      province: '',
      city: '',
      address: '',
      notes: '',
      partyType: activeTab === 'supplier' ? 'supplier' : 'customer',
      supplierCategory: '',
      bankInfo: {
        bankName: '',
        accountNumber: '',
        shaba: '',
        cardNumber: ''
      }
    });
    setContacts([{ id: Date.now().toString(), name: '', role: activeTab === 'supplier' ? 'مدیر فروش' : 'مدیر خرید', phone: '', isPrimary: true }]);
  };

  const handleEdit = useCallback((c: Customer) => {
    const rawPartyType = (c.partyType || c.party_type || 'customer') as 'customer' | 'supplier' | 'both';
    const rawBank = c.bankInfo || c.bank_info || {};
    
    setForm({
      name: c.name,
      country: c.country || 'ایران',
      province: c.province || '',
      city: c.city || '',
      address: c.address || '',
      notes: c.notes || '',
      partyType: rawPartyType,
      supplierCategory: c.supplierCategory || c.supplier_category || '',
      bankInfo: {
        bankName: rawBank.bankName || '',
        accountNumber: rawBank.accountNumber || '',
        shaba: rawBank.shaba || '',
        cardNumber: rawBank.cardNumber || ''
      }
    });

    if (c.contacts && Array.isArray(c.contacts) && c.contacts.length > 0) {
      setContacts(c.contacts.map((contact, idx) => ({
        id: contact.id || `${idx}-${Date.now()}`,
        name: contact.name || '',
        role: contact.role || (rawPartyType === 'supplier' ? 'مدیر فروش' : 'مدیر خرید'),
        phone: contact.phone || '',
        isPrimary: contact.isPrimary ?? (idx === 0)
      })));
    } else {
      setContacts([{
        id: '1',
        name: c.contactName || '',
        role: 'رابط اصلی',
        phone: c.phone || '',
        isPrimary: true
      }]);
    }

    setEditingId(c.id);
    setShowModal(true);
  }, []);

  const crm = useCRMData(user);

  useEffect(() => {
    if (location.state && (location.state.editCustomerId || location.state.editCustomer)) {
      const targetId = location.state.editCustomerId || location.state.editCustomer?.id;
      if (location.state.editCustomer) {
        handleEdit(location.state.editCustomer);
      } else if (targetId) {
        fetchJson(`/customers/${targetId}`).then((c) => {
          if (c) handleEdit(c);
        }).catch(err => {
          console.error(`Failed to load customer ${targetId} for edit:`, err);
          toast.error('خطا در دریافت اطلاعات مشتری');
        });
      }
    }
  }, [location.state, handleEdit]);

  const handleDelete = async (id: number) => {
    if (await confirmAction({ title: 'حذف طرف حساب', message: 'آیا از حذف این حساب شخص مطمئن هستید؟' })) {
      deleteMutation.mutate(id);
    }
  };

  // Open Account Card / Ledger Report Modal
  const handleOpenLedger = async (c: Customer) => {
    setSelectedLedgerCustomer(c);
    setLoadingLedger(true);
    setLedgerData(null);
    try {
      const pType = c.partyType === 'supplier' ? 'supplier' : 'customer';
      const res = await fetchJson(`/accounting/reports/account-card?detailedType=${pType}&detailedName=${encodeURIComponent(c.name)}`);
      setLedgerData(res?.report || res);
    } catch (e) {
      toast.error('خطا در دریافت کاردکس حساب شخص');
    } finally {
      setLoadingLedger(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden min-h-[460px]">
      {/* Header with Title and Unified Create Button */}
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/70 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
              <UsersRoundIcon size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800">طرفین حساب</h2>
              <p className="text-xs text-slate-500 mt-0.5">مدیریت متمرکز خریداران، تامین‌کنندگان زنجیره متریال و اشخاص رابط</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setShowExcelModal(true)}
            className="bg-white hover:bg-emerald-50/70 text-emerald-700 border border-emerald-200 hover:border-emerald-300 px-3.5 py-2.5 rounded-xl flex items-center gap-2 text-xs font-bold shadow-2xs transition-all cursor-pointer hover:shadow-xs"
          >
            <FileSpreadsheet size={16} className="text-emerald-600" />
            <span>ورود و خروجی اکسل</span>
          </button>

          {user.role !== 'viewer' && (
            <button 
              type="button"
              onClick={() => {
                setEditingId(null);
                resetForm();
                setShowModal(true);
              }} 
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 text-xs font-bold shadow-sm transition-all cursor-pointer hover:shadow-md"
            >
              <Plus size={16} /> ثبت طرف حساب جدید
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 shrink-0">
        {/* Segmented Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users size={14} className={activeTab === 'all' ? 'text-blue-600' : 'text-slate-400'} />
            <span>همه اشخاص و طرف‌ها</span>
          </button>

          <button
            onClick={() => setActiveTab('customer')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'customer'
                ? 'bg-white text-blue-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 size={14} className={activeTab === 'customer' ? 'text-blue-600' : 'text-slate-400'} />
            <span>مشتریان و خریداران</span>
          </button>

          <button
            onClick={() => setActiveTab('supplier')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'supplier'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck size={14} className={activeTab === 'supplier' ? 'text-emerald-600' : 'text-slate-400'} />
            <span>تامین‌کنندگان متریال</span>
          </button>
        </div>

        {/* Search Field */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="جستجو نام حساب، رسته تامین، رابط، تلفن..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-3 pr-10 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-800"
          />
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-auto relative min-h-[300px]">
        {loading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0 text-center z-0">
            <tr>
              <th className="p-3 w-12 text-slate-400 font-medium">ردیف</th>
              <th className="p-3 font-bold text-right text-slate-700">نام طرف حساب / شرکت</th>
              <th className="p-3 font-bold text-center text-slate-700 w-28">نقش و رسته</th>
              <th className="p-3 font-bold text-right text-slate-700">اشخاص رابط و سمت‌ها</th>
              <th className="p-3 font-bold text-right text-slate-700">شماره‌های تماس متصل</th>
              <th className="p-3 font-bold text-center text-slate-700">موقعیت مکانی</th>
              <th className="p-3 font-bold text-right text-slate-700">آدرس / یادداشت</th>
              <th className="p-3 font-bold text-center text-slate-700 w-36">عملیات و سوابق</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((c, idx) => {
              const contactsList = Array.isArray(c.contacts) ? c.contacts : [];
              const hasContacts = contactsList.length > 0;
              const pType = c.partyType || c.party_type || 'customer';
              const sCat = c.supplierCategory || c.supplier_category;

              return (
                <tr key={c.id} className="hover:bg-blue-50/20 transition-colors">
                  <td className="p-3 text-slate-400 text-center font-mono">{((page - 1) * 50) + idx + 1}</td>
                  
                  {/* Name and Quick Details */}
                  <td className="p-3 font-bold text-slate-800 text-right">
                    <div className="flex items-center gap-2">
                      {pType === 'supplier' ? (
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                          <Truck size={14} />
                        </div>
                      ) : pType === 'both' ? (
                        <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
                          <Users size={14} />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
                          <Building2 size={14} />
                        </div>
                      )}
                      
                      <div className="flex flex-col">
                        <button
                          onClick={() => {
                            if (pType === 'customer' || pType === 'both') {
                              setSelectedDossierCustomer(c);
                            } else {
                              handleOpenLedger(c);
                            }
                          }}
                          className="font-bold text-slate-900 hover:text-blue-700 hover:underline cursor-pointer text-right transition-colors"
                        >
                          {c.name}
                        </button>
                        {sCat && (
                          <span className="text-[10px] text-slate-500 font-normal truncate max-w-[200px]" title={sCat}>
                            {sCat}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Party Role Badge */}
                  <td className="p-3 text-center">
                    {pType === 'supplier' ? (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2 py-0.5 rounded-md text-[10px] font-bold">
                        <Truck size={11} /> تامین‌کننده
                      </span>
                    ) : pType === 'both' ? (
                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200/80 px-2 py-0.5 rounded-md text-[10px] font-bold">
                        مشتری و تامین‌کننده
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 border border-blue-200/80 px-2 py-0.5 rounded-md text-[10px] font-bold">
                        <Building2 size={11} /> مشتری
                      </span>
                    )}
                  </td>

                  {/* Contacts */}
                  <td className="p-3 text-slate-700 text-right">
                    {hasContacts ? (
                      <div className="flex flex-col gap-1">
                        {contactsList.slice(0, 2).map((contact, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="font-medium text-slate-800">{contact.name || 'بدون نام'}</span>
                            {contact.role && (
                              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded text-[10px] shrink-0 font-normal">
                                {contact.role}
                              </span>
                            )}
                            {contact.isPrimary && (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1 py-0.2 rounded text-[9px] shrink-0">
                                اصلی
                              </span>
                            )}
                          </div>
                        ))}
                        {contactsList.length > 2 && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            + {contactsList.length - 2} رابط دیگر
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600">{c.contactName || '-'}</span>
                    )}
                  </td>

                  {/* Phone numbers */}
                  <td className="p-3 text-slate-700 text-right">
                    {hasContacts ? (
                      <div className="flex flex-col gap-1 font-mono">
                        {contactsList.slice(0, 2).map((contact, i) => (
                          <div key={i} className="flex items-center gap-1 text-[11px]">
                            <Phone size={11} className="text-slate-400 shrink-0" />
                            <span dir="ltr" className="text-slate-800 font-semibold">{contact.phone || '-'}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span dir="ltr" className="font-mono text-slate-800 text-[11px]">
                        {c.phone ? c.phone.split(',').map((p, i) => <span key={i} className="block">{p.trim()}</span>) : '-'}
                      </span>
                    )}
                  </td>

                  {/* Location */}
                  <td className="p-3 text-slate-600 text-center">
                    {c.country === 'ایران' ? [c.province, c.city].filter(Boolean).join(' - ') || '-' : c.country || '-'}
                  </td>

                  {/* Address & Notes */}
                  <td className="p-3 text-slate-600 text-right max-w-xs">
                    <p className="truncate text-slate-700" title={c.address}>{c.address || '-'}</p>
                    {c.notes && <p className="text-[10px] text-slate-400 truncate mt-0.5" title={c.notes}>{c.notes}</p>}
                  </td>

                  {/* Operations */}
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {/* Financial Card Button */}
                      <button
                        onClick={() => handleOpenLedger(c)}
                        className="p-1.5 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 rounded-lg transition-colors flex items-center gap-1 text-[10px] font-bold cursor-pointer"
                        title="مشاهده کاردکس و تراز مالی تفصیلی این شخص در دفاتر دوبل"
                      >
                        <FileText size={12} />
                        تراز مالی
                      </button>

                      {/* CRM Dossier Button (for customers) */}
                      {(pType === 'customer' || pType === 'both') && (
                        <button 
                          onClick={() => setSelectedDossierCustomer(c)} 
                          className="p-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200/80 rounded-lg transition-colors flex items-center gap-1 text-[10px] font-bold cursor-pointer" 
                          title="مشاهده پرونده جامع و فرصت‌های فروش"
                        >
                          <Briefcase size={12} />
                          پرونده
                        </button>
                      )}

                      {user.role !== 'viewer' && (
                        <>
                          <button onClick={() => handleEdit(c)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="ویرایش">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDelete(c.id)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer" title="حذف">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && customers.length === 0 && (
              <tr>
                <td colSpan={8} className="p-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Users size={32} className="text-slate-300" />
                    <p className="font-bold text-sm text-slate-600">هیچ طرف حسابی در این دسته‌بندی یافت نشد.</p>
                    <p className="text-xs text-slate-400">می‌توانید با استفاده از دکمه «ثبت طرف حساب جدید» شخص مورد نظر را اضافه کنید.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3.5 bg-slate-50/80 border-t border-slate-200 flex items-center justify-between mt-auto shrink-0">
        <span className="text-xs text-slate-500 font-medium">
          نمایش {customers.length} مورد {totalItems > 0 ? `از کل ${totalItems} طرف حساب` : ''}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="p-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            >
              <ChevronRight size={15} />
            </button>
            <span className="text-xs font-bold px-2 text-slate-700">
              صفحه {page} از {totalPages}
            </span>
            <button 
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer"
            >
              <ChevronLeft size={15} />
            </button>
          </div>
        )}
      </div>

      {/* V9 Phase 5.2: مودال یکپارچه ثبت/ویرایش طرف حساب — استخراج‌شده */}
      <CustomerFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        editingId={editingId}
        form={form}
        setForm={setForm as any}
        contacts={contacts}
        addContactPerson={addContactPerson}
        removeContactPerson={removeContactPerson}
        updateContactPerson={updateContactPerson}
        setPrimaryContact={setPrimaryContact}
        onSubmit={handleSubmit}
        isSaving={isSaving}
      />

      {/* Ledger / Account Card Modal */}
      {selectedLedgerCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[85] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0 bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-600/10 text-emerald-600 flex items-center justify-center font-bold">
                  <FileText size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-800">
                    کارت حساب و تراز تفصیلی: {selectedLedgerCustomer.name}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    سوابق اسناد دوبل خرید، فاکتورها و پرداخت‌های تسویه ثبت شده
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setSelectedLedgerCustomer(null)} 
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1.5 hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4 text-xs">
              {loadingLedger ? (
                <div className="p-12 flex flex-col items-center justify-center gap-2 text-slate-400">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
                  <span>در حال محاسبه تراز و بارگذاری اسناد دوبل...</span>
                </div>
              ) : ledgerData && ledgerData.items && ledgerData.items.length > 0 ? (
                <>
                  {/* Balance Summary Header Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl">
                      <span className="text-[11px] font-bold text-blue-800">مجموع بدهکار (پرداخت‌ها / فاکتور فروش)</span>
                      <p className="text-sm font-bold font-mono text-blue-900 mt-1">
                        {formatPersianPrice(ledgerData.totalDebit || 0, appCurrency)}
                      </p>
                    </div>

                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
                      <span className="text-[11px] font-bold text-amber-800">مجموع بستانکار (رسیدهای خرید)</span>
                      <p className="text-sm font-bold font-mono text-amber-900 mt-1">
                        {formatPersianPrice(ledgerData.totalCredit || 0, appCurrency)}
                      </p>
                    </div>

                    <div className={`p-3.5 rounded-xl border ${
                      (ledgerData.finalBalance || 0) < 0
                        ? 'bg-rose-50 border-rose-200 text-rose-900'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}>
                      <span className="text-[11px] font-bold">
                        {(ledgerData.finalBalance || 0) < 0 ? 'مانده بستانکار (طلب شخص از ما)' : (ledgerData.finalBalance || 0) > 0 ? 'مانده بدهکار (بدهی شخص به ما)' : 'تراز حساب (تسویه کامل)'}
                      </span>
                      <p className="text-sm font-bold font-mono mt-1">
                        {formatPersianPrice(Math.abs(ledgerData.finalBalance || 0), appCurrency)}
                      </p>
                    </div>
                  </div>

                  {/* Transactions Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-center font-bold">
                        <tr>
                          <th className="p-2.5 w-10">ردیف</th>
                          <th className="p-2.5 w-24">تاریخ</th>
                          <th className="p-2.5 w-20">سند دوبل</th>
                          <th className="p-2.5 text-right">شرح سند</th>
                          <th className="p-2.5 text-left w-28">{`بدهکار (${curLbl})`}</th>
                          <th className="p-2.5 text-left w-28">{`بستانکار (${curLbl})`}</th>
                          <th className="p-2.5 text-left w-32">{`مانده تجمعی (${curLbl})`}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {ledgerData.items.map((row: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="p-2.5 text-center text-slate-400">{i + 1}</td>
                            <td className="p-2.5 text-center text-slate-700">{row.date}</td>
                            <td className="p-2.5 text-center font-bold text-blue-700">#{row.voucherNumber}</td>
                            <td className="p-2.5 text-right font-sans text-slate-800">{row.itemDescription || row.description}</td>
                            <td className="p-2.5 text-left text-blue-700 font-bold">{row.debit > 0 ? formatPersianPrice(row.debit) : '—'}</td>
                            <td className="p-2.5 text-left text-amber-700 font-bold">{row.credit > 0 ? formatPersianPrice(row.credit) : '—'}</td>
                            <td className={`p-2.5 text-left font-bold ${row.runningBalance < 0 ? 'text-rose-600' : row.runningBalance > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {formatPersianPrice(Math.abs(row.runningBalance))} {row.runningBalance < 0 ? '(بس)' : row.runningBalance > 0 ? '(بد)' : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="p-10 text-center text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  <p className="font-bold text-sm text-slate-600">هنوز هیچ تراکنش یا سند دوبل مالی برای این شخص ثبت نشده است.</p>
                  <p className="text-xs text-slate-400 mt-1">با ثبت رسید خرید کالا یا فاکتور فروش، اسناد دوبل به صورت خودکار در این کارت نمایش می‌یابند.</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 flex justify-end bg-slate-50/80 shrink-0">
              <button 
                type="button" 
                onClick={() => setSelectedLedgerCustomer(null)} 
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Dossier Drawer */}
      <CustomerDossierDrawer
        customer={selectedDossierCustomer}
        onClose={() => setSelectedDossierCustomer(null)}
        allLeads={crm.leads.length > 0 ? crm.leads : crmLeads}
        allActivities={crm.activities.length > 0 ? crm.activities : crmActivities}
        onOpenLeadDrawer={crm.openLeadDrawer}
        onOpenLeadModal={(lead, defaultCustName) => {
          crm.openLeadModal(lead);
          if (defaultCustName) {
            crm.setLeadForm((prev: any) => ({ ...prev, customerName: defaultCustName }));
          }
        }}
        onOpenActivityModal={(lead, defaultCustName, defaultCustId) => {
          crm.openActivityModal(lead, 'call', defaultCustName, defaultCustId);
          if (defaultCustName || defaultCustId) {
            crm.setActivityForm((prev: any) => ({
              ...prev,
              customerName: defaultCustName || prev.customerName,
              customerId: defaultCustId || prev.customerId
            }));
          }
        }}
        onEditCustomer={(cust) => {
          setSelectedDossierCustomer(null);
          handleEdit(cust);
        }}
      />

      {/* Modal: Activity / Interaction Log */}
      <CRMInteractionModal
        isActivityModalOpen={crm.isActivityModalOpen}
        onCloseActivityModal={() => crm.setIsActivityModalOpen(false)}
        selectedLeadForActivity={crm.selectedLeadForActivity}
        setSelectedLeadForActivity={crm.setSelectedLeadForActivity}
        leads={crm.leads}
        activityForm={crm.activityForm}
        setActivityForm={crm.setActivityForm}
        isSavingActivity={crm.isSavingActivity}
        onSaveActivity={crm.handleSaveActivity}
        personnelList={crm.personnelList}
        mentionUsers={crm.mentionUsers}
        currentUser={user}
        currentLoggedInUser={crm.currentLoggedInUser}
        isFollowupResultModalOpen={crm.isFollowupResultModalOpen}
        onCloseFollowupResultModal={() => crm.setIsFollowupResultModalOpen(false)}
        selectedFollowupAct={crm.selectedFollowupAct}
        followupResultForm={crm.followupResultForm}
        setFollowupResultForm={crm.setFollowupResultForm}
        isSubmittingFollowupResult={crm.isSubmittingFollowupResult}
        onConfirmFollowupResult={crm.handleConfirmFollowupResult}
      />

      {/* Counterparties Excel Import, Update & Export Modal */}
      <CustomerExcelModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.customers.all });
        }}
        existingCustomers={customers}
        activeTabFilter={activeTab}
      />
    </div>
  );
}

function UsersRoundIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </svg>
  );
}


