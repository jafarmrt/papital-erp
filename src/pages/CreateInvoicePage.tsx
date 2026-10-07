import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isCancelledError } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Item, User } from '../types';
import { Plus, Trash2, Printer, X } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatPersianPrice, formatPersianNumber, formatPersianCode, formatCurrencyLabel, extractDateString, getTodayJalaliDate, getTodayIsoDate } from '../utils';
import InvoicePrintView from '../components/InvoicePrintView';
import { SearchableSelect } from '../components/SearchableSelect';
import { OpenProformasPanel } from '../components/invoices/create/OpenProformasPanel';
import { useServerDraft } from '../hooks/useServerDraft';
import { isEmptyInvoiceDraft } from '../lib/invoices/invoiceForm';
import { useInvoiceReferenceData, useItemPricesQuery } from '../hooks/invoices/useInvoiceReferenceData';
import { useInvoiceBuyer } from '../hooks/invoices/useInvoiceBuyer';
import { useInvoiceSave } from '../hooks/invoices/useInvoiceSave';
import { getSellableStock } from '../lib/stockAvailability';
import { computeInvoiceTotals } from '../lib/invoiceTotals';
import { currencyChangeError, lineDiscountError, pricesForCurrency } from '../lib/invoices/invoiceLine';
import { printLineAmounts } from '../lib/invoices/invoicePrintTotals';
import { amountDecimalsOf } from '../lib/invoices/invoiceListDocuments';
import { addInvoiceLine, customerLocationLabel, EDIT_FINAL_REFUSED, finalStatusOptionNote, invoiceFormFromDocument, invoiceLineLocations, isSalesFormDocType, lineLocationOf, type BuyerSource, type InvoiceDocItem, type InvoiceDocumentDetails } from '../lib/invoices/invoiceForm';
import type { InvoiceListDocument } from '../lib/invoices/invoiceListDocuments';
import { Sparkles } from 'lucide-react';
import { ExchangeRateField, exchangeRateError } from '../components/documents/ExchangeRateField';
import { useHasPermission } from '../contexts/AuthContext';
import { SYSTEM_ADMIN_ROLE } from '../lib/permissions/permissionCatalog';
import { SALES_FINALIZE_PERMISSION } from '../lib/permissions/documentPermissions';
import { PICK_LIST_URLS } from '../lib/permissions/pickLists';

// Print styles are added globally or inline
export default function CreateInvoicePage({ user: currentUser }: { user: User }) {
  // v9.0.125 (TD-541 / TD-771): گزینه «فاکتور نهایی» با همان مجوزی که سرور می‌سنجد، نه کد نقش (documentPermissions.ts)
  const isSystemAdmin = currentUser.role === SYSTEM_ADMIN_ROLE;
  const holdsFinalize = useHasPermission(SALES_FINALIZE_PERMISSION);
  const holdsCreate = useHasPermission('documents.create');
  const canFinalizeSales = holdsFinalize || isSystemAdmin;
  const canRecordSales = canFinalizeSales || holdsCreate;

  const [docType, setDocType] = useState('invoice');
  const initialStatus = canFinalizeSales ? 'final' : 'proforma';
  const [status, setStatus] = useState(initialStatus); // 'proforma' or 'final'

  // خواندنی‌های صفحه با React Query (انبارها، مشتریان، پیش‌فاکتورهای باز، شماره بعدی سند)
  const { warehouses, customersList, proformas, proformasTotal, proformasPage, setProformasPage, nextRef, loadDocument, refreshProformas, refetchNextRef } = useInvoiceReferenceData(docType);

  // انبار پیش‌فرض = اولین انبار برگشتی (مثل قبل) تا وقتی کاربر، پیش‌نویس یا سند ویرایشی انبار دیگری انتخاب نکرده باشد
  const [locationOverride, setLocation] = useState<string | null>(null);
  const location = locationOverride ?? warehouses[0]?.code ?? '';
  // v9.0.276 (TD-790): پیش‌فاکتور چندانباره در ویرایش؛ هر ردیف انبار خودش را نگه می‌دارد
  const [multiWarehouseEdit, setMultiWarehouseEdit] = useState(false);

  // شماره سند = شماره بعدی سرور تا وقتی کاربر یا پیش‌فاکتور ویرایشی شماره دیگری نگذاشته باشد (null = شماره سرور)
  const [refOverride, setRefNumber] = useState<string | null>(null);
  const refNumber = refOverride ?? nextRef;
  const [date, setDate] = useState<string>(() => getTodayJalaliDate());

  // Buyer fields
  const buyer = useInvoiceBuyer(customersList);
  const { buyerName, setBuyerName, buyerCity, setBuyerCity, buyerPhone, setBuyerPhone, buyerAddress, setBuyerAddress, selectedCustomerId, setSelectedCustomerId, handleCustomerSelect } = buyer;
  const [notes, setNotes] = useState('');
  const [crmLeadId, setCrmLeadId] = useState<number | null>(null);
  const [currency, setCurrency] = useState('IRR');
  const [exchangeRate, setExchangeRate] = useState(0);

  // VAT & Tax states
  const [applyVat, setApplyVat] = useState(false);
  const [vatRate, setVatRate] = useState<number>(10);

  const [selectedItem, setSelectedItem] = useState('');
  const [selectedItemObj, setSelectedItemObj] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [discount, setDiscount] = useState<number | ''>(0);
  const itemPricesQuery = useItemPricesQuery(selectedItem);
  const itemPrices = selectedItem ? (itemPricesQuery.data ?? []) : [];

  const [docItems, setDocItems] = useState<InvoiceDocItem[]>([]);
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  const isEditing = editingDocId !== null;
  const finalOptionNote = finalStatusOptionNote(canFinalizeSales, isEditing);

  // Print view state
  const [printedDoc, setPrintedDoc] = useState<InvoiceDocumentDetails | null>(null);

  // Server draft data builder
  const currentInvoiceData = {
    docType,
    status,
    location,
    currency,
    exchangeRate,
    buyerName,
    buyerCity,
    buyerPhone,
    buyerAddress,
    notes,
    applyVat,
    vatRate,
    docItems,
    // v8.0.111 (TD-388): پیوند پرونده CRM با پیش‌نویس نگه داشته می‌شود
    crmLeadId
  };

  const {
    hasServerDraft,
    draftStatusText,
    discardDraft,
    restoreDraft
  } = useServerDraft(currentInvoiceData, {
    entityType: 'invoice',
    draftKey: 'new_invoice',
    enabled: !editingDocId,
    // v8.0.111 (TD-388): فرم بی ردیف و بی خریدار (مثلاً پس از ثبت) پیش‌نویس نمی‌سازد
    isEmpty: isEmptyInvoiceDraft,
    onDraftLoaded: (loaded) => {
      if (isSalesFormDocType(loaded.docType)) setDocType(loaded.docType);
      if (loaded.status) setStatus(loaded.status);
      if (loaded.location) setLocation(loaded.location);
      if (loaded.currency) setCurrency(loaded.currency);
      if (Number(loaded.exchangeRate) > 0) setExchangeRate(Number(loaded.exchangeRate));
      if (loaded.buyerName) setBuyerName(loaded.buyerName);
      if (loaded.buyerCity) setBuyerCity(loaded.buyerCity);
      if (loaded.buyerPhone) setBuyerPhone(loaded.buyerPhone);
      if (loaded.buyerAddress) setBuyerAddress(loaded.buyerAddress);
      if (loaded.notes) setNotes(loaded.notes);
      if (typeof loaded.applyVat === 'boolean') setApplyVat(loaded.applyVat);
      if (loaded.vatRate) setVatRate(loaded.vatRate);
      if (Number(loaded.crmLeadId) > 0) setCrmLeadId(Number(loaded.crmLeadId));
      if (Array.isArray(loaded.docItems) && loaded.docItems.length > 0) {
        setDocItems(loaded.docItems);
      }
    }
  });

  const saveMutation = useInvoiceSave({ loadDocument, discardDraft });
  const isSaving = saveMutation.isPending;

  const handleEditProforma = async (p: InvoiceListDocument) => {
    try {
      const doc = await loadDocument(p.id);
      if (!doc) return;
      const form = invoiceFormFromDocument(doc, p.ref_number);
      // v9.0.275 (TD-789): این فرم فقط سند فروش را ویرایش می‌کند
      if (!isSalesFormDocType(form.docType)) {
        toast.error(`سند شماره ${p.ref_number} سند فروش نیست و در این فرم ویرایش نمی‌شود.`);
        return;
      }
      resetForm();
      setEditingDocId(p.id);
      setDocType(form.docType);
      setStatus(form.status);
      setCrmLeadId(form.crmLeadId);
      setRefNumber(form.refNumber);
      if (form.date) setDate(form.date);
      buyer.setBuyer(form);
      setNotes(form.notes);
      setCurrency(form.currency);
      setExchangeRate(form.exchangeRate);
      setApplyVat(form.vatPercent > 0);
      if (form.vatPercent > 0) setVatRate(form.vatPercent);
      if (form.docItems) {
        const located = invoiceLineLocations(form.docItems, warehouses.map(w => w.code));
        if (located.header) setLocation(located.header);
        setMultiWarehouseEdit(located.multiWarehouse);
        setDocItems(located.lines);
      }
      toast.success(`پیش‌فاکتور شماره ${p.ref_number} جهت ویرایش بارگذاری شد.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (isCancelledError(err)) return;
      toast.error('خطا در دریافت اطلاعات پیش‌فاکتور جهت ویرایش');
    }
  };

  const handlePrintProforma = async (p: InvoiceListDocument) => {
    try {
      setPrintedDoc(await loadDocument(p.id));
    } catch (err) {
      if (!isCancelledError(err)) console.error(err);
    }
  };

  // پاک کردن فرم پس از ثبت یا انصراف از ویرایش؛ شماره سند به شماره بعدی سرور برمی‌گردد.
  // v9.0.275 (TD-789): همه فیلدها به مقدار آغازین برمی‌گردند (نوع، وضعیت، انبار، تاریخ، ارز، نرخ، مالیات و پرونده فروش)؛
  // پیش‌تر نوع، وضعیت و پرونده فروش سند قبلی می‌ماند و فاکتور بعدی با نوع «رسید» یا به پرونده دیگری ثبت می‌شد
  const resetForm = () => {
    setEditingDocId(null);
    setDocType('invoice');
    setStatus(initialStatus);
    setLocation(null);
    setMultiWarehouseEdit(false);
    setRefNumber(null);
    setDate(getTodayJalaliDate());
    buyer.setBuyer({ buyerName: '', buyerCity: '', buyerPhone: '', buyerAddress: '' });
    setSelectedCustomerId('');
    setNotes('');
    setCrmLeadId(null);
    setCurrency('IRR');
    setExchangeRate(0);
    setApplyVat(false);
    setVatRate(10);
    setDocItems([]);
    setSelectedItem('');
    setSelectedItemObj(null);
    setQuantity('');
    setUnitPrice('');
    setDiscount(0);
  };

  const handleCancelEdit = () => {
    resetForm();
    refetchNextRef();
    toast('ویرایش پیش‌فاکتور لغو شد.');
  };

  const locationState = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (locationState.state) {
      const s = locationState.state as Record<string, string | number | undefined>;
      const str = (v: string | number | undefined) => (v === undefined ? '' : String(v));
      if (s.buyerName) setBuyerName(str(s.buyerName));
      if (s.buyerPhone) setBuyerPhone(str(s.buyerPhone));
      if (s.buyerAddress) setBuyerAddress(str(s.buyerAddress));
      const uniqueLoc = customerLocationLabel({ province: str(s.buyerProvince || s.province), city: str(s.buyerCity || s.city) });
      if (uniqueLoc) setBuyerCity(uniqueLoc);
      else if (s.buyerCity) setBuyerCity(str(s.buyerCity));
      if (s.notes) setNotes(str(s.notes));
      if (Number(s.crmLeadId) > 0) setCrmLeadId(Number(s.crmLeadId));
      if (isSalesFormDocType(str(s.type))) { setDocType(str(s.type)); setStatus('proforma'); }
      if (s.status === 'proforma' || (s.status === 'final' && canFinalizeSales)) setStatus(s.status);
      if (s.currency) setCurrency(str(s.currency));
      toast.success('اطلاعات خریدار و پرونده فروش منتقل شد.');
      // v9.0.275 (TD-789): وضعیت مسیریابی یک بار خوانده می‌شود تا پرونده فروش به سندهای بعدی این صفحه نرسد
      void navigate(locationState.pathname, { replace: true, state: null });
    }
  }, [locationState.state, locationState.pathname, navigate, canFinalizeSales, setBuyerName, setBuyerPhone, setBuyerAddress, setBuyerCity]);

  const handleItemSelect = (val: string, rawItem?: Item) => {
    setSelectedItem(val);
    setSelectedItemObj(rawItem || null);
    setDiscount(0);
    setUnitPrice(0);
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
    // v8.0.103 (TD-380): تخفیف ردیف حداکثر برابر مبلغ همان ردیف (همان قاعده سرور)
    const discountError = lineDiscountError(Number(quantity), Number(unitPrice || 0), Number(discount || 0));
    if (discountError) {
      toast.error(discountError);
      return;
    }

    if (status === 'final' && docType === 'invoice') {
      const { loc, reserved, sellable } = getSellableStock(it, location);
      const existingInList = docItems.find(p => p.item.id === it.id && lineLocationOf(p, location) === location);
      const currentListQty = existingInList ? existingInList.quantity : 0;
      const totalRequestedQty = currentListQty + Number(quantity);

      if (sellable < totalRequestedQty) {
        const whName = warehouses.find(w => w.code === location)?.name || location || 'انبار انتخابی';
        toast.error(`عدم موجودی کافی قابل فروش! موجودی ${whName}: ${loc}، رزرو سایر مصارف: ${reserved}، قابل فروش: ${sellable} ${it.unit} (مجموع درخواستی: ${totalRequestedQty} ${it.unit})`);
        return;
      }
    }

    const newLine = { item: it, quantity: Number(quantity), unitPrice: Number(unitPrice || 0), discount: Number(discount || 0) };
    setDocItems(prev => addInvoiceLine(prev, newLine, location));
    setSelectedItem('');
    setSelectedItemObj(null);
    setQuantity('');
    setUnitPrice('');
    setDiscount(0);
  };

  // v8.0.107 (TD-384): ارز فاکتور دارای ردیف عوض نمی‌شود (فی ردیف‌ها به ارز فعلی است)
  const handleCurrencyChange = (next: string) => {
    const error = currencyChangeError(docItems.length, currency, next);
    if (error) {
      toast.error(error);
      return;
    }
    setCurrency(next);
  };

  const handleRemove = (index: number) => {
    setDocItems(prev => prev.filter((_, i) => i !== index));
  };

  // v9.0.276 (TD-790): تغییر انبار بالای فرم همه ردیف‌ها را به همان انبار می‌برد
  const handleLocationChange = (next: string) => {
    setLocation(next);
    setMultiWarehouseEdit(false);
    setDocItems(prev => prev.map(d => ({ ...d, location: undefined })));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyerName || !buyerName.trim()) {
      toast.error('لطفاً خریدار / طرف حساب فاکتور را حتماً از لیست طرفین حساب انتخاب کنید.');
      return;
    }
    if (docItems.length === 0) {
      toast.error('هیچ کالایی اضافه نشده است.');
      return;
    }

    if (!isSalesFormDocType(docType)) {
      toast.error('این فرم فقط فاکتور و پیش‌فاکتور فروش ثبت می‌کند.');
      return;
    }

    const rateError = exchangeRateError(currency, exchangeRate);
    if (rateError) {
      toast.error(rateError);
      return;
    }

    // v9.0.280 (TD-801): ویرایش پیش‌فاکتور آن را قطعی نمی‌کند (سرور وضعیت «نهایی» را در ویرایش نمی‌پذیرد)؛ قطعی شدن از گردش
    // کار تأیید آن است. پیش‌تر گزینه انتخاب‌پذیر بود و به پیام نادرست «موجودی کافی نیست» با موجودی صفر ردیف بارشده می‌رسید
    if (editingDocId && status === 'final') {
      toast.error(EDIT_FINAL_REFUSED);
      return;
    }

    if (status === 'final' && warehouses.length === 0) {
      toast.error('هیچ انباری در سیستم تعریف نشده است. لطفاً ابتدا از بخش تنظیمات > مدیریت انبارها، حداقل یک انبار تعریف نمایید.');
      return;
    }

    // Pre-flight check: validate that each line item has sufficient sellable stock in the selected warehouse for final invoices
    if (status === 'final' && docType === 'invoice') {
      const targetWh = warehouses.find(w => w.code === location);
      const whName = targetWh?.name || location || 'انبار انتخابی';

      for (const d of docItems) {
        const it = d.item;
        const { loc, reserved, sellable } = getSellableStock(it, lineLocationOf(d, location));

        if (sellable < d.quantity) {
          toast.error(`موجودی قابل فروش کالا «${it.name}» (${it.code}) در «${whName}» کافی نیست! موجودی انبار: ${loc}، رزرو سایر مصارف: ${reserved}، قابل فروش: ${sellable} ${it.unit}، درخواستی: ${d.quantity} ${it.unit}`);
          return;
        }
      }
    }

    const formattedDate = extractDateString(date) || getTodayIsoDate();

    const payload = {
      docType,
      status,
      refNumber,
      date: formattedDate,
      user: currentUser.full_name,
      inOut: 'out' as const,
      buyer_name: buyerName,
      buyer_city: buyerCity,
      buyer_phone: buyerPhone,
      buyer_address: buyerAddress,
      // v7.0.32 (TD-197): مالیات در فیلدهای ساختاریافته vatPercent/vatAmount ذخیره می‌شود، نه در متن یادداشت
      notes,
      location,
      currency,
      exchangeRate: currency !== 'IRR' ? exchangeRate : null,
      // v9.0.275 (TD-789): ویرایش پیش‌فاکتور پیوند پرونده فروش را دست نمی‌زند؛ فقط سند تازه با پرونده‌ای که از آن باز شده ثبت می‌شود
      crmLeadId: !editingDocId && crmLeadId ? Number(crmLeadId) : undefined,
      // v8.0.104 (TD-381): فقط درصد؛ مبلغ مالیات را سرور با همان قاعده جمع‌های فرم حساب می‌کند
      vatPercent: applyVat ? vatRate : 0,
      items: docItems.map(d => ({ itemId: d.item.id, quantity: d.quantity, unit_price: d.unitPrice, discount: d.discount, location: lineLocationOf(d, location) }))
    };

    // ثبت/ویرایش، شروع گردش‌کار پیش‌فاکتور تازه، بارگذاری سند برای چاپ و ابطال کش صفحات دیگر در useInvoiceSave
    saveMutation.mutate({ editingDocId, payload }, {
      onSuccess: (result) => {
        if (result.printedDoc) setPrintedDoc(result.printedDoc);
        // Reset form
        resetForm();
      },
    });
  };

  // v7.0.76 (P3-6): Decimal و همان قاعده مالیات سرور (قبلاً ضرب و جمع اعشاری جاوااسکریپت)
  const { gross: totalSum, discount: totalDiscount, vatAmount, payable: finalPrice } = computeInvoiceTotals(docItems, applyVat ? vatRate : 0, currency);
  // v8.0.106 (TD-383): مبالغ فاکتور ارزی با دو رقم اعشار، همان مقدار ذخیره‌شده (پیش‌تر ۲۰۰٫۵ دلار «۲۰۱»)
  const amountDecimals = amountDecimalsOf(currency);

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
                <option value="final" disabled={!canFinalizeSales || isEditing}>
                  فاکتور نهایی (کسر قطعی از انبار){finalOptionNote}
                </option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">واحد پول (ارز)</label>
              <select className="w-full border rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-bold text-slate-700" value={currency} onChange={e => handleCurrencyChange(e.target.value)}>
                <option value="IRR">ریال</option>
                <option value="USD">دلار (USD)</option>
                <option value="EUR">یورو (EUR)</option>
                <option value="AED">درهم (AED)</option>
                <option value="GBP">پوند (GBP)</option>
              </select>
              <ExchangeRateField currency={currency} value={exchangeRate} onChange={setExchangeRate} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-500">محل خروج قلم کالا (انبار مبدا)</label>
              {warehouses.length > 0 ? (
                <select className="w-full border rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-bold text-slate-700" value={location} onChange={e => handleLocationChange(e.target.value)}>
                  {warehouses.map(w => (
                    <option key={w.code} value={w.code}>📦 {w.name}</option>
                  ))}
                </select>
              ) : (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded font-medium">
                  ⚠️ هیچ انباری تعریف نشده است (تنظیمات &gt; انبارها)
                </div>
              )}
              {multiWarehouseEdit && (
                <p className="mt-1 text-[11px] text-amber-800">
                  ردیف‌های این پیش‌فاکتور از چند انبار است و هر ردیف از انبار خودش ذخیره می‌شود. تغییر این انبار همه ردیف‌ها را به آن می‌برد.
                </p>
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
                onChange={(dateObj) => setDate(extractDateString(dateObj))} 
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
                  fetchUrl={PICK_LIST_URLS.customers}
                  mapResultToOption={(c: BuyerSource & { id: number }) => {
                    const loc = customerLocationLabel(c);
                    return {
                      value: c.id.toString(),
                      label: `👤 ${c.name} ${c.phone ? `(${c.phone})` : ''} ${loc ? `- ${loc}` : ''}`,
                      _raw: c
                    };
                  }}
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
                  placeholder={selectedCustomerId ? (buyerName || 'بدون نام') : 'از لیست طرفین حساب انتخاب کنید'} 
                  className="w-full border rounded text-sm px-3 py-1.5 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed border-slate-200 shadow-2xs" 
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-slate-600 font-bold">استان / شهر</label>
                <input 
                  type="text" 
                  value={buyerCity} 
                  readOnly 
                  placeholder={selectedCustomerId ? (buyerCity ? '' : 'در پرونده ثبت نشده است') : 'از پرونده خریدار فراخوانی می‌شود'} 
                  className="w-full border rounded text-sm px-3 py-1.5 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed border-slate-200 shadow-2xs" 
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-slate-600 font-bold">تلفن</label>
                <input 
                  type="text" 
                  value={buyerPhone} 
                  readOnly 
                  placeholder={selectedCustomerId ? (buyerPhone ? '' : 'در پرونده ثبت نشده است') : 'از پرونده خریدار فراخوانی می‌شود'} 
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
                  placeholder={selectedCustomerId ? (buyerAddress ? '' : 'در پرونده مشتری نشانی ثبت نشده است') : 'از پرونده خریدار فراخوانی می‌شود'} 
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
                  key={`item-select-${location}-${status}`}
                  className="w-full shadow-sm rounded"
                  fetchUrl={PICK_LIST_URLS.items}
                  mapResultToOption={(it: Item) => {
                    const { loc, total, reserved, sellable } = getSellableStock(it, location);
                    const whName = warehouses.find(w => w.code === location)?.name || location || 'انبار انتخابی';

                    const stockLabel = location 
                      ? `${whName}: ${loc} | رزرو: ${reserved} | قابل فروش: ${sellable} ${it.unit}` 
                      : `کل: ${total} | رزرو: ${reserved} | قابل فروش: ${sellable} ${it.unit}`;

                    return {
                      value: it.id.toString(),
                      label: `${it.code} - ${it.name} (${stockLabel})`,
                      disabled: status === 'final' && sellable <= 0
                    };
                  }}
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
                  disabled={!selectedItem || pricesForCurrency(itemPrices, currency).length === 0}
                  defaultValue=""
                >
                  <option value="">-- ورود دستی قیمت --</option>
                  {pricesForCurrency(itemPrices, currency).map((p, pIdx) => (
                    <option key={`price-opt-${p.id || pIdx}-${pIdx}`} value={p.price}>{p.title} - {formatPersianPrice(p.price)} {p.currency}</option>
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
                    const { total: rowTotal, net: rowFinal } = printLineAmounts({ quantity: d.quantity, unit_price: d.unitPrice, discount: d.discount });
                    return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500" dir="ltr">{formatPersianCode(d.item.code)}</td>
                      <td className="p-3 font-bold text-slate-800">
                        {d.item.name}
                        {d.location && <span className="block text-[11px] font-normal text-slate-500">انبار: {warehouses.find(w => w.code === d.location)?.name || d.location}</span>}
                      </td>
                      <td className="p-3 text-center">
                        <span className="font-bold">{formatPersianNumber(d.quantity)}</span> <span className="text-slate-500 text-xs">{d.item.unit}</span>
                      </td>
                      <td className="p-3 text-center text-slate-700">{formatPersianPrice(d.unitPrice, undefined, amountDecimals)}</td>
                      <td className="p-3 text-center font-bold text-slate-700">{formatPersianPrice(rowTotal, undefined, amountDecimals)}</td>
                      <td className="p-3 text-center text-rose-600">{d.discount > 0 ? formatPersianPrice(d.discount, undefined, amountDecimals) : '-'}</td>
                      <td className="p-3 text-center font-bold text-indigo-700">{formatPersianPrice(rowFinal, undefined, amountDecimals)}</td>
                      <td className="p-3 text-center">
                        <button type="button" onClick={() => handleRemove(i)} className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded transition-colors inline-block">
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
                    <span className="text-slate-800 font-bold block mt-0.5 text-base">{formatPersianPrice(totalSum, undefined, amountDecimals)}</span>
                  </div>
                  <div className="text-center font-medium text-slate-500 text-xs">
                    تخفیفات: 
                    <span className="text-rose-600 font-bold block mt-0.5 text-base">{formatPersianPrice(totalDiscount, undefined, amountDecimals)}</span>
                  </div>
                  {applyVat && (
                    <div className="text-center font-medium text-slate-500 text-xs">
                      ارزش افزوده ({vatRate}٪): 
                      <span className="text-amber-700 font-bold block mt-0.5 text-base">{formatPersianPrice(vatAmount, undefined, amountDecimals)}</span>
                    </div>
                  )}
                  <div className="text-center font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-lg text-xs">
                    مبلغ نهایی قابل پرداخت: 
                    <span className="font-bold block mt-0.5 text-lg text-indigo-900">{formatPersianPrice(finalPrice, undefined, amountDecimals)} {formatCurrencyLabel(currency)}</span>
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
              <button type="submit" disabled={docItems.length === 0 || !canRecordSales || isSaving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1">
                {isSaving ? 'در حال ثبت...' : editingDocId ? 'ذخیره تغییرات پیش‌فاکتور' : 'ثبت و صدور فاکتور'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <OpenProformasPanel
        proformas={proformas}
        total={proformasTotal}
        page={proformasPage}
        onPageChange={setProformasPage}
        editingDocId={editingDocId}
        onPrint={handlePrintProforma}
        onEdit={handleEditProforma}
        onWorkflowStateChange={refreshProformas}
      />
    </div>
  );
}
