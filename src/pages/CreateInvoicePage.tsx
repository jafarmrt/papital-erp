import React, { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchJson } from '../api';
import { toast } from 'react-hot-toast';
import { Item, User, Customer } from '../types';
import { Plus, Trash2, Printer, Edit3, X, GitBranch } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { cn, formatPersianPrice, formatPersianNumber, formatPersianCode, formatPersianDate, formatCurrencyLabel, extractDateString, getTodayJalaliDate } from '../utils';
import InvoicePrintView from '../components/InvoicePrintView';
import { SearchableSelect } from '../components/SearchableSelect';
import { WorkflowStepperWidget } from '../components/workflow/WorkflowStepperWidget';
import { useServerDraft } from '../hooks/useServerDraft';
import { Sparkles } from 'lucide-react';

// Print styles are added globally or inline
export default function CreateInvoicePage({ user: currentUser }: { user: User }) {
  const isSalesUser = currentUser.role === 'sales_manager' || (currentUser.role !== 'admin' && currentUser.role !== 'manager' && currentUser.role !== 'warehouse_keeper' && currentUser.role !== 'accountant');

  const [itemPrices, setItemPrices] = useState<any[]>([]);
  const [docType, setDocType] = useState('invoice');
  const [status, setStatus] = useState(isSalesUser ? 'proforma' : 'final'); // 'proforma' or 'final'
  const [location, setLocation] = useState<string>('');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  
  const [refNumber, setRefNumber] = useState('');
  const [date, setDate] = useState<any>(() => getTodayJalaliDate());
  
  // Buyer fields
  const [buyerName, setBuyerName] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [crmLeadId, setCrmLeadId] = useState<number | null>(null);
  const [currency, setCurrency] = useState('IRR');

  // VAT & Tax states
  const [applyVat, setApplyVat] = useState(false);
  const [vatRate, setVatRate] = useState<number>(10);

  const [selectedItem, setSelectedItem] = useState('');
  const [selectedItemObj, setSelectedItemObj] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [discount, setDiscount] = useState<number | ''>(0);
  const [isSaving, setIsSaving] = useState(false);
  
  const [docItems, setDocItems] = useState<{item: Item, quantity: number, unitPrice: number, discount: number}[]>([]);
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  const [workflowModalDoc, setWorkflowModalDoc] = useState<any | null>(null);

  // Print view state
  const [printedDoc, setPrintedDoc] = useState<any>(null);

  // Server draft data builder
  const currentInvoiceData = {
    docType,
    status,
    location,
    currency,
    buyerName,
    buyerCity,
    buyerPhone,
    buyerAddress,
    notes,
    applyVat,
    vatRate,
    docItems
  };

  const {
    hasServerDraft,
    serverDraftData,
    draftStatusText,
    discardDraft,
    restoreDraft
  } = useServerDraft(currentInvoiceData, {
    entityType: 'invoice',
    draftKey: 'new_invoice',
    enabled: !editingDocId,
    onDraftLoaded: (loaded) => {
      if (loaded.docType) setDocType(loaded.docType);
      if (loaded.status) setStatus(loaded.status);
      if (loaded.location) setLocation(loaded.location);
      if (loaded.currency) setCurrency(loaded.currency);
      if (loaded.buyerName) setBuyerName(loaded.buyerName);
      if (loaded.buyerCity) setBuyerCity(loaded.buyerCity);
      if (loaded.buyerPhone) setBuyerPhone(loaded.buyerPhone);
      if (loaded.buyerAddress) setBuyerAddress(loaded.buyerAddress);
      if (loaded.notes) setNotes(loaded.notes);
      if (typeof loaded.applyVat === 'boolean') setApplyVat(loaded.applyVat);
      if (loaded.vatRate) setVatRate(loaded.vatRate);
      if (Array.isArray(loaded.docItems) && loaded.docItems.length > 0) {
        setDocItems(loaded.docItems);
      }
    }
  });

  const fetchNextRef = async (signal?: AbortSignal) => {
    try {
      const { nextRef } = await fetchJson(`/documents/next-ref?type=${docType}`, { signal });
      setRefNumber(nextRef);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      console.error(e);
    }
  };

  const [proformas, setProformas] = useState<any[]>([]);
  const loadProformas = (signal?: AbortSignal) => {
    fetchJson('/documents?status=proforma&limit=1000', { signal }).then(res => {
      const rawData = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setProformas(rawData);
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      console.error(err);
    });
  };

  const handleEditProforma = async (p: any) => {
    try {
      const doc = await fetchJson(`/documents/${p.id}`);
      if (!doc) return;
      setEditingDocId(p.id);
      setDocType(doc.type || 'invoice');
      setStatus(doc.status || 'proforma');
      setRefNumber(doc.ref_number || p.ref_number || '');
      if (doc.date) setDate(formatPersianDate(doc.date, { englishDigits: true }));
      setBuyerName(doc.buyer_name || '');
      setBuyerCity(doc.buyer_city || '');
      setBuyerPhone(doc.buyer_phone || '');
      setBuyerAddress(doc.buyer_address || '');
      setNotes(doc.notes || '');
      setCurrency(doc.currency || 'IRR');
      if (doc.location) setLocation(doc.location);

      if (Array.isArray(doc.items)) {
        const mappedItems = doc.items.map((it: any) => ({
          item: {
            id: it.itemId || it.item_id,
            code: it.itemCode || it.item_code || '',
            name: it.itemName || it.item_name || 'کالا',
            unit: it.itemUnit || it.unit || 'عدد',
            current_stock: it.current_stock || 0
          },
          quantity: Number(it.quantity || 0),
          unitPrice: Number(it.unitPrice || it.unit_price || 0),
          discount: Number(it.discount || 0)
        }));
        setDocItems(mappedItems);
      }
      toast.success(`پیش‌فاکتور شماره ${p.ref_number} جهت ویرایش بارگذاری شد.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error('خطا در دریافت اطلاعات پیش‌فاکتور جهت ویرایش');
    }
  };

  const handleCancelEdit = () => {
    setEditingDocId(null);
    setDocItems([]);
    setSelectedCustomerId('');
    setBuyerName('');
    setBuyerCity('');
    setBuyerPhone('');
    setBuyerAddress('');
    setNotes('');
    setApplyVat(false);
    fetchNextRef();
    toast('ویرایش پیش‌فاکتور لغو شد.');
  };

  const loadCustomers = (signal?: AbortSignal) => {
    fetchJson('/customers', { signal }).then(res => {
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setCustomersList(list);
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      console.error(err);
    });
  };

  const locationState = useLocation();

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/warehouses', { signal: controller.signal }).then(whs => {
      const safeWhs = Array.isArray(whs) ? whs : [];
      setWarehouses(safeWhs);
      if (safeWhs.length > 0) {
        setLocation(safeWhs[0].code);
      }
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      console.error(err);
    });
    fetchNextRef(controller.signal);
    loadProformas(controller.signal);
    loadCustomers(controller.signal);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (buyerName && customersList.length > 0 && !selectedCustomerId) {
      const match = customersList.find(c => c.name.trim().toLowerCase() === buyerName.trim().toLowerCase());
      if (match) {
        setSelectedCustomerId(match.id.toString());
      }
    } else if (!buyerName && selectedCustomerId) {
      setSelectedCustomerId('');
    }
  }, [buyerName, customersList, selectedCustomerId]);

  useEffect(() => {
    if (locationState.state) {
      const s = locationState.state as any;
      if (s.buyerName) setBuyerName(s.buyerName);
      if (s.buyerPhone) setBuyerPhone(s.buyerPhone);
      if (s.buyerAddress) setBuyerAddress(s.buyerAddress);
      if (s.buyerCity) setBuyerCity(s.buyerCity);
      if (s.notes) setNotes(s.notes);
      if (s.crmLeadId) setCrmLeadId(s.crmLeadId);
      if (s.type) { setDocType(s.type); setStatus('proforma'); }
      if (s.status) setStatus(s.status);
      if (s.currency) setCurrency(s.currency);
      toast.success('اطلاعات خریدار و پرونده فروش CRM با موفقیت منتقل شد.');
    }
  }, [locationState.state]);

  const handleCustomerSelect = (val: string, rawC?: any) => {
    setSelectedCustomerId(val);
    if (!val) {
      setBuyerName(''); setBuyerCity(''); setBuyerPhone(''); setBuyerAddress('');
      return;
    }
    const customer = rawC || customersList.find(c => String(c.id) === String(val));
    if (customer) {
      setBuyerName(customer.name);
      setBuyerCity(customer.city || '');
      setBuyerPhone(customer.phone || '');
      setBuyerAddress(customer.address || '');
    }
  };

  const handleItemSelect = (val: string, rawItem?: any) => {
    setSelectedItem(val);
    setSelectedItemObj(rawItem || null);
    setDiscount(0);
    setUnitPrice(0);
    setItemPrices([]);
    if (val) {
      fetchJson(`/items/${val}/prices`)
        .then(res => setItemPrices(Array.isArray(res) ? res : []))
        .catch(err => {
          console.error(`Failed to load prices for item ${val}:`, err);
          toast.error('خطا در دریافت قیمت‌های کالا');
          setItemPrices([]);
        });
    }
  };

  const handleAddItem = () => {
    if (!selectedItem || !selectedItemObj) {
      toast.error('لطفاً ابتدا کالا را انتخاب کنید.');
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      toast.error('لطفاً تعداد کالا را وارد کنید (باید بیشتر از صفر باشد).');
      return;
    }
    const it = selectedItemObj;

    if (status === 'final' && docType === 'invoice') {
      const locationStock = (it as any)[`stock_${location}`] || 0;
      if (locationStock < Number(quantity)) {
        const whName = warehouses.find(w => w.code === location)?.name || location;
        toast.error(`عدم موجودی کافی در انبار انتخابی! موجودی ${whName}: ${locationStock} ${it.unit}`);
        return;
      }
    }

    setDocItems(prev => {
      const existing = prev.find(p => p.item.id === it.id);
      if (existing) {
        return prev.map(p => p.item.id === it.id ? { ...p, quantity: p.quantity + Number(quantity) } : p);
      }
      return [...prev, { item: it, quantity: Number(quantity), unitPrice: Number(unitPrice || 0), discount: Number(discount || 0) }];
    });
    setSelectedItem('');
    setSelectedItemObj(null);
    setQuantity('');
    setUnitPrice('');
    setDiscount(0);
  };

  const handleRemove = (id: number) => {
    setDocItems(prev => prev.filter(p => p.item.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyerName || !buyerName.trim()) {
      toast.error('لطفاً خریدار / طرف حساب فاکتور را حتماً از لیست طرفین حساب انتخاب کنید.');
      return;
    }
    if (docItems.length === 0) {
      toast.error('هیچ کالایی اضافه نشده است.');
      return;
    }

    if (status === 'final' && warehouses.length === 0) {
      toast.error('هیچ انباری در سیستم تعریف نشده است. لطفاً ابتدا از بخش تنظیمات > مدیریت انبارها، حداقل یک انبار تعریف نمایید.');
      return;
    }

    setIsSaving(true);
    try {
      const formattedDate = extractDateString(date) || new Date().toISOString().split('T')[0];

      const payload = {
        docType,
        status,
        refNumber,
        date: formattedDate,
        user: currentUser.full_name,
        inOut: 'out',
        buyer_name: buyerName,
        buyer_city: buyerCity,
        buyer_phone: buyerPhone,
        buyer_address: buyerAddress,
        notes: applyVat ? (notes ? `${notes}\n[ارزش افزوده: ${vatAmount.toLocaleString('fa-IR')} ${currency} (${vatRate}٪)]` : `[ارزش افزوده: ${vatAmount.toLocaleString('fa-IR')} ${currency} (${vatRate}٪)]`) : notes,
        location,
        currency,
        crmLeadId: crmLeadId ? Number(crmLeadId) : undefined,
        vatPercent: applyVat ? vatRate : 0,
        vatAmount: vatAmount,
        items: docItems.map(d => ({ itemId: d.item.id, quantity: d.quantity, unit_price: d.unitPrice, discount: d.discount }))
      };

      let res;
      if (editingDocId) {
        res = await fetchJson(`/documents/${editingDocId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        toast.success('پیش‌فاکتور با موفقیت به‌روزرسانی شد!');
      } else {
        res = await fetchJson('/documents', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        toast.success(status === 'final' ? 'فاکتور و سند حسابداری دوبل آن با موفقیت ثبت شدند!' : 'پیش‌فاکتور با موفقیت ثبت شد و وارد چرخه تاییدات گردید!');
        
        // Auto-start Document Approval Workflow for newly created proforma
        if (status === 'proforma' && res?.docId) {
          try {
            await fetchJson('/workflow/start', {
              method: 'POST',
              body: JSON.stringify({
                workflowCode: 'DOC_APPROVAL_WORKFLOW',
                entityType: 'document',
                entityId: res.docId
              })
            });
          } catch (wfErr) {
            console.warn('Could not auto-start workflow for proforma:', wfErr);
          }
        }
      }
      
      const targetDocId = editingDocId || res?.docId;
      if (targetDocId) {
        const docDetails = await fetchJson(`/documents/${targetDocId}`);
        setPrintedDoc(docDetails);
      }
      
      // Reset form
      if (!editingDocId) {
        await discardDraft();
      }
      setEditingDocId(null);
      setDocItems([]);
      setBuyerName('');
      setBuyerCity('');
      setBuyerPhone('');
      setBuyerAddress('');
      setNotes('');
      setApplyVat(false);
      fetchNextRef();
      loadProformas();
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت سند');
    } finally {
      setIsSaving(false);
    }
  };

  const totalSum = docItems.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);
  const totalDiscount = docItems.reduce((acc, curr) => acc + curr.discount, 0);
  const netSubtotal = Math.max(0, totalSum - totalDiscount);
  const vatAmount = applyVat ? Math.round((netSubtotal * vatRate) / 100) : 0;
  const finalPrice = netSubtotal + vatAmount;

  if (printedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4 mb-4 print:hidden">
          <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center gap-2 font-bold">
            <Printer size={18} /> چاپ فاکتور (A4)
          </button>
          <button onClick={() => setPrintedDoc(null)} className="border px-4 py-2 rounded hover:bg-slate-50 font-medium">
            بازگشت به فرم ثبت
          </button>
        </div>
        
        <InvoicePrintView printedDoc={printedDoc} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto print:hidden">
      <div className="bg-white border rounded-xl shadow-sm flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-white rounded-t-xl">
          <div className="flex items-center gap-2">
            <h3 className="font-bold flex items-center gap-2">📑 ثبت فاکتور فروش (پیش فاکتور/فاکتور)</h3>
            {draftStatusText && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 animate-pulse border">
                {draftStatusText}
              </span>
            )}
          </div>
        </div>

        {/* Server Draft Recovery Banner */}
        {hasServerDraft && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span>یک پیش‌نویس ذخیره‌شده در سرور برای فاکتور فروش وجود دارد. مایل به بازیابی اقلام و مشخصات هستید؟</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={restoreDraft}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-xs shadow-xs transition"
              >
                بازیابی پیش‌نویس
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 rounded border border-slate-300 text-xs transition"
              >
                نادیده گرفتن
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Header Info */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-50 p-4 rounded-lg border">
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">وضعیت سند</label>
              <select className="w-full border rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-bold text-slate-700" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="proforma">پیش فاکتور (رزرو موقت)</option>
                <option value="final" disabled={isSalesUser}>
                  فاکتور نهایی (کسر قطعی از انبار){isSalesUser ? ' - فقط انباردار/مدیر' : ''}
                </option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">واحد پول (ارز)</label>
              <select className="w-full border rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-bold text-slate-700" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="IRR">ریال</option>
                <option value="USD">دلار (USD)</option>
                <option value="EUR">یورو (EUR)</option>
                <option value="AED">درهم (AED)</option>
                <option value="GBP">پوند (GBP)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">محل خروج قلم کالا (انبار مبدا)</label>
              {warehouses.length > 0 ? (
                <select className="w-full border rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-bold text-slate-700" value={location} onChange={e => setLocation(e.target.value)}>
                  {warehouses.map(w => (
                    <option key={w.code} value={w.code}>📦 {w.name}</option>
                  ))}
                </select>
              ) : (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded font-medium">
                  ⚠️ هیچ انباری تعریف نشده است (تنظیمات &gt; انبارها)
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">شماره سند / رفرنس (اتومات)</label>
              <input required type="text" value={refNumber} onChange={e => setRefNumber(e.target.value)} className="w-full border shadow-sm rounded text-sm px-3 py-1.5 text-left font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">تاریخ</label>
              <DatePicker 
                value={date} 
                onChange={(dateObj: any) => setDate(extractDateString(dateObj))} 
                calendar={persian} 
                locale={persian_fa} 
                calendarPosition="bottom-right"
                inputClass="w-full border shadow-sm rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" 
                containerClassName="w-full"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-800">مشخصات خریدار (طرف حساب)</h3>
              <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                🔒 انتخاب الزاماً از دفتر مشتریان و طرفین حساب (عدم امکان ورود دستی)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="col-span-1 md:col-span-4 bg-blue-50/80 p-3 rounded-xl border border-blue-100 flex flex-col md:flex-row md:items-center gap-3">
                <label className="text-sm font-bold text-blue-900 shrink-0 min-w-[170px]">انتخاب خریدار از لیست طرفین حساب:*</label>
                <SearchableSelect 
                  className="w-full"
                  fetchUrl="/customers"
                  mapResultToOption={(c: any) => ({
                    value: c.id.toString(),
                    label: `👤 ${c.name} ${c.phone ? `(${c.phone})` : ''} ${c.city ? `- ${c.city}` : ''}`
                  })}
                  value={selectedCustomerId}
                  onChange={handleCustomerSelect}
                  placeholder="-- جهت انتخاب خریدار، کلیک کرده یا نام/تلفن وی را تایپ کنید --"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-slate-600 font-bold">نام خریدار (طرف حساب)</label>
                <input 
                  type="text" 
                  value={buyerName} 
                  readOnly 
                  placeholder="از لیست طرفین حساب انتخاب کنید" 
                  className="w-full border rounded text-sm px-3 py-1.5 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed border-slate-200 shadow-2xs" 
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-slate-600 font-bold">استان / شهر</label>
                <input 
                  type="text" 
                  value={buyerCity} 
                  readOnly 
                  placeholder="خودکار از پرونده" 
                  className="w-full border rounded text-sm px-3 py-1.5 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed border-slate-200 shadow-2xs" 
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-slate-600 font-bold">تلفن</label>
                <input 
                  type="text" 
                  value={buyerPhone} 
                  readOnly 
                  placeholder="خودکار از پرونده" 
                  className="w-full border rounded text-sm px-3 py-1.5 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed border-slate-200 shadow-2xs" 
                  dir="ltr" 
                />
              </div>
              <div className="col-span-1 md:col-span-3">
                <label className="block text-xs mb-1 text-slate-600 font-bold">نشانی تحویل / اقامتگاه</label>
                <input 
                  type="text" 
                  value={buyerAddress} 
                  readOnly 
                  placeholder="خودکار از پرونده" 
                  className="w-full border rounded text-sm px-3 py-1.5 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed border-slate-200 shadow-2xs" 
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-bold mb-3 text-slate-800">اقلام فاکتور</h3>
            <div className="flex flex-wrap gap-3 items-end bg-slate-50 p-3 rounded-lg border">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs mb-1 text-slate-500">انتخاب کالا</label>
                <SearchableSelect
                  className="w-full shadow-sm rounded"
                  fetchUrl="/items"
                  mapResultToOption={(it: any) => ({
                    value: it.id.toString(),
                    label: `${it.code} - ${it.name} (موجودی: ${it.current_stock} ${it.unit})`,
                    disabled: status === 'final' && it.current_stock <= 0
                  })}
                  value={selectedItem}
                  onChange={handleItemSelect}
                  placeholder="انتخاب کالا / ماده اولیه"
                />
              </div>
              <div className="w-48">
                <label className="block text-xs mb-1 text-slate-500">سیاست قیمتی از پیش تعریف شده</label>
                <select 
                  className="w-full border shadow-sm rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  onChange={e => e.target.value && setUnitPrice(Number(e.target.value))}
                  disabled={!selectedItem || itemPrices.length === 0}
                  defaultValue=""
                >
                  <option value="">-- ورود دستی قیمت --</option>
                  {itemPrices.filter(p => Number(p.price) > 0).map(p => (
                    <option key={p.id} value={p.price}>{p.title} - {formatPersianPrice(p.price)} {p.currency}</option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <label className="block text-xs mb-1 text-slate-500">تعداد</label>
                <input type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value ? Number(e.target.value) : '')} className="w-full shadow-sm border rounded text-sm px-3 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-blue-500" dir="ltr" />
              </div>
              <div className="w-32">
                <label className="block text-xs mb-1 text-slate-500">مبلغ واحد ({currency})</label>
                <input type="number" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value ? Number(e.target.value) : '')} className="w-full border shadow-sm rounded text-sm px-3 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-blue-500" dir="ltr" />
              </div>
              <div className="w-32">
                <label className="block text-xs mb-1 text-slate-500">تخفیف کلی ردیف ({currency})</label>
                <input type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value ? Number(e.target.value) : '')} className="w-full border shadow-sm rounded text-sm px-3 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-blue-500" dir="ltr" />
              </div>
              <button type="button" onClick={handleAddItem} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1 text-sm h-[34px] transition-colors shadow-sm">
                <Plus size={16} /> افزودن به لیست
              </button>
            </div>
          </div>

          {docItems.length > 0 && (
            <div className="border rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#6c74ad] text-white">
                  <tr>
                    <th className="p-3 font-medium">کد</th>
                    <th className="p-3 font-medium text-right">شرح کالا</th>
                    <th className="p-3 font-medium text-center">تعداد / مقدار</th>
                    <th className="p-3 font-medium text-center">مبلغ واحد ({currency})</th>
                    <th className="p-3 font-medium text-center">مبلغ کل ({currency})</th>
                    <th className="p-3 font-medium text-center">تخفیف ({currency})</th>
                    <th className="p-3 font-medium text-center">مبلغ نهایی ({currency})</th>
                    <th className="p-3 font-medium text-center">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {docItems.map((d, i) => {
                    const rowTotal = d.quantity * d.unitPrice;
                    const rowFinal = rowTotal - d.discount;
                    return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500" dir="ltr">{formatPersianCode(d.item.code)}</td>
                      <td className="p-3 font-bold text-slate-800">{d.item.name}</td>
                      <td className="p-3 text-center">
                        <span className="font-bold">{formatPersianNumber(d.quantity)}</span> <span className="text-slate-500 text-xs">{d.item.unit}</span>
                      </td>
                      <td className="p-3 text-center text-slate-700">{formatPersianPrice(d.unitPrice)}</td>
                      <td className="p-3 text-center font-bold text-slate-700">{formatPersianPrice(rowTotal)}</td>
                      <td className="p-3 text-center text-rose-600">{d.discount > 0 ? formatPersianPrice(d.discount) : '-'}</td>
                      <td className="p-3 text-center font-bold text-indigo-700">{formatPersianPrice(rowFinal)}</td>
                      <td className="p-3 text-center">
                        <button type="button" onClick={() => handleRemove(d.item.id)} className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded transition-colors inline-block">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              <div className="bg-slate-50 p-4 border-t flex flex-wrap items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-3 bg-white p-2.5 rounded-lg border shadow-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700">
                    <input 
                      type="checkbox" 
                      checked={applyVat} 
                      onChange={e => setApplyVat(e.target.checked)} 
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer" 
                    />
                    <span>محاسبه مالیات بر ارزش افزوده (VAT)</span>
                  </label>
                  {applyVat && (
                    <div className="flex items-center gap-1.5 border-r pr-3 mr-1">
                      <span className="text-xs text-slate-500">نرخ:</span>
                      <input 
                        type="number" 
                        min="0" 
                        max="100" 
                        value={vatRate} 
                        onChange={e => setVatRate(Number(e.target.value) || 0)} 
                        className="w-14 border rounded px-2 py-1 text-center text-xs font-bold bg-slate-50 focus:bg-white" 
                        dir="ltr" 
                      />
                      <span className="text-xs text-slate-500">٪</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-6">
                  <div className="text-center font-medium text-slate-500 text-xs">
                    مبلغ ناخالص: 
                    <span className="text-slate-800 font-bold block mt-0.5 text-base">{formatPersianPrice(totalSum)}</span>
                  </div>
                  <div className="text-center font-medium text-slate-500 text-xs">
                    تخفیفات: 
                    <span className="text-rose-600 font-bold block mt-0.5 text-base">{formatPersianPrice(totalDiscount)}</span>
                  </div>
                  {applyVat && (
                    <div className="text-center font-medium text-slate-500 text-xs">
                      ارزش افزوده ({vatRate}٪): 
                      <span className="text-amber-700 font-bold block mt-0.5 text-base">{formatPersianPrice(vatAmount)}</span>
                    </div>
                  )}
                  <div className="text-center font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-lg text-xs">
                    مبلغ نهایی قابل پرداخت: 
                    <span className="font-bold block mt-0.5 text-lg text-indigo-900">{formatPersianPrice(finalPrice)} {formatCurrencyLabel(currency)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1 text-slate-500">توضیحات تکمیلی</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} className="w-full border rounded text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"></textarea>
          </div>

          <div className="border-t pt-4 flex items-center justify-between">
            {editingDocId ? (
              <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 text-xs font-bold">
                <span>در حال ویرایش پیش‌فاکتور کد {refNumber}</span>
                <button type="button" onClick={handleCancelEdit} className="text-slate-600 hover:text-slate-900 bg-white border px-2 py-0.5 rounded text-xs flex items-center gap-1 font-normal">
                  <X size={12} /> انصراف
                </button>
              </div>
            ) : <div />}
            <div className="flex items-center gap-3">
              {editingDocId && (
                <button type="button" onClick={handleCancelEdit} className="border border-slate-300 hover:bg-slate-100 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-all">
                  انصراف
                </button>
              )}
              <button type="submit" disabled={docItems.length === 0 || currentUser.role === 'viewer' || isSaving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1">
                {isSaving ? 'در حال ثبت...' : editingDocId ? 'ذخیره تغییرات پیش‌فاکتور' : 'ثبت و صدور فاکتور'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {proformas.length > 0 && (
        <div className="bg-white border rounded-xl shadow-sm flex flex-col p-6 mt-8">
          <h3 className="font-bold flex items-center gap-2 mb-4">⏳ پیش فاکتورهای باز ({proformas.length})</h3>
          <div className="border rounded-xl flex overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-500 border-b">
                <tr>
                  <th className="p-3 font-medium">شماره سند</th>
                  <th className="p-3 font-medium">تاریخ</th>
                  <th className="p-3 font-medium">نام خریدار</th>
                  <th className="p-3 font-medium text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {proformas.map((p) => (
                  <tr key={p.id} className={cn("hover:bg-slate-50", editingDocId === p.id && "bg-amber-50/60 font-bold")}>
                    <td className="p-3 font-mono font-bold">{p.ref_number}</td>
                    <td className="p-3 font-mono">{formatPersianDate(p.date)}</td>
                    <td className="p-3">{p.buyer_name || '-'}</td>
                    <td className="p-3 text-center">
                      <div className="flex justify-center items-center gap-2">
                        <button 
                          type="button" 
                          onClick={() => setWorkflowModalDoc(p)} 
                          className="text-purple-700 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer border border-purple-200 shadow-xs"
                          title="مشاهده وضعیت تاییدات و پیگیری در کارتابل گردش‌کار"
                        >
                          <GitBranch size={13} /> گردش‌کار و تاییدات
                        </button>
                        <button type="button" onClick={async () => {
                          const doc = await fetchJson(`/documents/${p.id}`);
                          setPrintedDoc(doc);
                        }} className="text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-blue-200">نمایش / چاپ</button>
                        <button type="button" onClick={() => handleEditProforma(p)} className="text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-amber-200">
                          <Edit3 size={13} /> ویرایش
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Workflow Stepper Action Modal */}
      {workflowModalDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 my-auto">
            <div className="bg-slate-900 text-white p-4 shrink-0 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-purple-400 shrink-0" />
                <h3 className="font-bold text-xs sm:text-sm">
                  چرخه تاییدات و گردش‌کار پیش‌فاکتور {formatPersianCode(workflowModalDoc.ref_number)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWorkflowModalDoc(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
              <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4 text-purple-900 leading-relaxed">
                <p className="font-medium">
                  از طریق گام‌های زیر می‌توانید پیش‌فاکتور را بررسی کرده و با دکمه <strong className="text-purple-950 font-black">«ارسال به انبار»</strong>، وضعیت گردش‌کار را جهت تایید موجودی و آماده‌سازی به کارتابل انباردار ارسال نمایید.
                </p>
              </div>

              <WorkflowStepperWidget
                entityType="document"
                entityId={workflowModalDoc.id}
                workflowCode="DOC_APPROVAL_WORKFLOW"
                title="اقدامات و ترنزیشن‌های گردش‌کار"
                onStateChange={() => {
                  loadProformas();
                }}
              />
            </div>
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkflowModalDoc(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
