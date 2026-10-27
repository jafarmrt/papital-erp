import React, { useEffect, useState, useId } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isCancelledError } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Item, User } from '../types';
import { Package, Printer, ReceiptText, Sparkles } from 'lucide-react';
import { formatPersianNumber, getTodayIsoDate, toStorageDate, formatPersianCode } from '../utils';
import InvoicePrintView from '../components/InvoicePrintView';
import { OpenProformasPanel } from '../components/invoices/create/OpenProformasPanel';
import { InvoiceFormSection } from '../components/invoices/create/InvoiceFormSection';
import { InvoiceHeaderFields } from '../components/invoices/create/InvoiceHeaderFields';
import { InvoiceBuyerFields } from '../components/invoices/create/InvoiceBuyerFields';
import { InvoiceLinePicker } from '../components/invoices/create/InvoiceLinePicker';
import { InvoiceLinesList } from '../components/invoices/create/InvoiceLinesList';
import { InvoiceTotalsPanel } from '../components/invoices/create/InvoiceTotalsPanel';
import { InvoiceSubmitBar } from '../components/invoices/create/InvoiceSubmitBar';
import { INVOICE_FIELD, INVOICE_LABEL } from '../components/invoices/create/invoiceFormStyles';
import { useServerDraft } from '../hooks/useServerDraft';
import { isEmptyInvoiceDraft } from '../lib/invoices/invoiceForm';
import { useInvoiceReferenceData, useItemPricesQuery } from '../hooks/invoices/useInvoiceReferenceData';
import { recordedSalesType } from '../lib/documents/recordedSalesType';
import { useInvoiceBuyer } from '../hooks/invoices/useInvoiceBuyer';
import { useInvoiceSave } from '../hooks/invoices/useInvoiceSave';
import { getSellableStock } from '../lib/stockAvailability';
import { ownReservationOf, proformaLineShortages } from '../lib/invoices/proformaLineShortage';
import { isReservingDocument } from '../lib/documents/reservingDocuments';
import { computeInvoiceTotals } from '../lib/invoiceTotals';
import { serviceChargeInputOf } from '../lib/invoices/serviceChargeInput';
import { InvoiceServiceChargeField } from '../components/invoices/create/InvoiceServiceChargeField';
import { currencyChangeError, lineDiscountError, pricesForCurrency } from '../lib/invoices/invoiceLine';
import { amountDecimalsOf } from '../lib/invoices/invoiceListDocuments';
import { addInvoiceLine, customerLocationLabel, EDIT_FINAL_REFUSED, finalStatusOptionNote, invoiceFormFromDocument, invoiceLineLocations, isSalesFormDocType, lineLocationOf, type InvoiceDocItem, type InvoiceDocumentDetails } from '../lib/invoices/invoiceForm';
import { selectedPartyId } from '../lib/documents/partySelection';
import type { InvoiceListDocument } from '../lib/invoices/invoiceListDocuments';
import { exchangeRateError } from '../components/documents/ExchangeRateField';
import { useHasPermission } from '../contexts/AuthContext';
import { SYSTEM_ADMIN_ROLE } from '../lib/permissions/permissionCatalog';
import { SALES_FINALIZE_PERMISSION } from '../lib/permissions/documentPermissions';
import { scrollAppToTop } from '../components/layout/appScroll';

// v10.2.4 (گزینه «ج»): فرم در بخش‌های سرتیتردار components/invoices/create؛ این صفحه وضعیت فرم و ثبت را نگه می‌دارد
export default function CreateInvoicePage({ user: currentUser }: { user: User }) {
  const fieldId = useId();
  // v9.0.125 (TD-541 / TD-771): گزینه «فاکتور نهایی» با همان مجوزی که سرور می‌سنجد، نه کد نقش (documentPermissions.ts)
  const isSystemAdmin = currentUser.role === SYSTEM_ADMIN_ROLE;
  const holdsFinalize = useHasPermission(SALES_FINALIZE_PERMISSION);
  const holdsCreate = useHasPermission('documents.create');
  const canFinalizeSales = holdsFinalize || isSystemAdmin;
  const canRecordSales = canFinalizeSales || holdsCreate;

  const [docType, setDocType] = useState('invoice');
  const initialStatus = canFinalizeSales ? 'final' : 'proforma';
  const [status, setStatus] = useState(initialStatus); // 'proforma' or 'final'

  // خواندنی‌های صفحه با React Query (انبارها، مشتریان، پیش‌فاکتورهای باز، شماره بعدی سند). v10.0.93 (TD-1190): شماره بعدی
  // از سری نوعی که سند واقعاً با آن ذخیره می‌شود (پیش‌فاکتور فروشنده‌ای که قطعی نمی‌کند: سری پیش‌فاکتور)
  const { warehouses, customersList, proformas, proformasTotal, proformasPage, setProformasPage, nextRef, loadDocument, refreshProformas, refetchNextRef } = useInvoiceReferenceData(recordedSalesType(docType, status, canFinalizeSales));

  // انبار پیش‌فرض = اولین انبار برگشتی (مثل قبل) تا وقتی کاربر، پیش‌نویس یا سند ویرایشی انبار دیگری انتخاب نکرده باشد
  const [locationOverride, setLocation] = useState<string | null>(null);
  const location = locationOverride ?? warehouses[0]?.code ?? '';
  // v9.0.300 (TD-790): پیش‌فاکتور چندانباره در ویرایش؛ هر ردیف انبار خودش را نگه می‌دارد
  const [multiWarehouseEdit, setMultiWarehouseEdit] = useState(false);

  // شماره سند = شماره بعدی سرور، یا شماره پیش‌فاکتوری که ویرایش می‌شود (null = شماره سرور)؛ v9.0.327 (TD-783): فقط نمایشی
  const [refOverride, setRefNumber] = useState<string | null>(null);
  const refNumber = refOverride ?? nextRef;
  // v10.1.72 (TD-1288): تاریخ میلادی ISO مثل فرم‌های دیگر؛ کادر تاریخ شمسی مشترک آن را شمسی نشان می‌دهد
  const [date, setDate] = useState<string>(() => getTodayIsoDate());

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
  // v10.0.260 (TD-1136): هزینه ارسال و خدمات فاکتور دستی (`serviceChargeAmount`)
  const [serviceChargeText, setServiceChargeText] = useState('');
  const serviceCharge = serviceChargeInputOf(serviceChargeText);

  const [selectedItem, setSelectedItem] = useState('');
  const [selectedItemObj, setSelectedItemObj] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [discount, setDiscount] = useState<number | ''>(0);
  const itemPricesQuery = useItemPricesQuery(selectedItem);
  const itemPrices = selectedItem ? (itemPricesQuery.data ?? []) : [];

  const [docItems, setDocItems] = useState<InvoiceDocItem[]>([]);
  // v11 phase 6.3b (U26): the stored reservation of the proforma being edited, not counted against its own lines
  const [ownReserved, setOwnReserved] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  // v10.0.108 (TD-972): نسخه پیش‌فاکتوری که در حال ویرایش است؛ ذخیره آن را می‌فرستد و سرور نسخه کهنه را ۴۰۹ می‌دهد
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
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
    serviceChargeText,
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
      if (typeof loaded.serviceChargeText === 'string') setServiceChargeText(loaded.serviceChargeText);
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
      // v9.0.299 (TD-789): این فرم فقط سند فروش را ویرایش می‌کند
      if (!isSalesFormDocType(form.docType)) {
        toast.error(`سند شماره ${formatPersianCode(p.ref_number)} سند فروش نیست و در این فرم ویرایش نمی‌شود.`);
        return;
      }
      resetForm();
      setEditingDocId(p.id);
      setEditingVersion(form.version);
      setDocType(form.docType);
      setStatus(form.status);
      setCrmLeadId(form.crmLeadId);
      setRefNumber(form.refNumber);
      if (form.date) setDate(toStorageDate(form.date) || getTodayIsoDate());
      buyer.setBuyer(form);
      // v9.0.336 (TD-778): انتخابگر خریدار از شناسه طرف حساب سند، نه تطبیق نام
      if (form.partyId) setSelectedCustomerId(String(form.partyId));
      setNotes(form.notes);
      setCurrency(form.currency);
      setExchangeRate(form.exchangeRate);
      setApplyVat(form.vatPercent > 0);
      if (form.vatPercent > 0) setVatRate(form.vatPercent);
      setServiceChargeText(form.serviceChargeAmount > 0 ? String(form.serviceChargeAmount) : '');
      if (form.docItems) {
        const located = invoiceLineLocations(form.docItems, warehouses.map(w => w.code));
        if (located.header) setLocation(located.header);
        setMultiWarehouseEdit(located.multiWarehouse);
        setDocItems(located.lines);
        setOwnReserved(isReservingDocument(form.docType, form.status) ? ownReservationOf(located.lines) : new Map());
      }
      toast.success(`پیش‌فاکتور شماره ${formatPersianCode(p.ref_number)} جهت ویرایش بارگذاری شد.`);
      scrollAppToTop();
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
  // v9.0.299 (TD-789): همه فیلدها به مقدار آغازین برمی‌گردند (نوع، وضعیت، انبار، تاریخ، ارز، نرخ، مالیات و پرونده فروش)؛
  // پیش‌تر نوع، وضعیت و پرونده فروش سند قبلی می‌ماند و فاکتور بعدی با نوع «رسید» یا به پرونده دیگری ثبت می‌شد
  const resetForm = () => {
    setEditingDocId(null);
    setEditingVersion(null);
    setDocType('invoice');
    setStatus(initialStatus);
    setOwnReserved(new Map());
    setLocation(null);
    setMultiWarehouseEdit(false);
    setRefNumber(null);
    setDate(getTodayIsoDate());
    buyer.setBuyer({ buyerName: '', buyerCity: '', buyerPhone: '', buyerAddress: '' });
    setSelectedCustomerId('');
    setNotes('');
    setCrmLeadId(null);
    setCurrency('IRR');
    setExchangeRate(0);
    setApplyVat(false);
    setVatRate(10);
    setServiceChargeText('');
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
      if (selectedPartyId(s.customerId)) setSelectedCustomerId(str(s.customerId));
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
      // v9.0.299 (TD-789): وضعیت مسیریابی یک بار خوانده می‌شود تا پرونده فروش به سندهای بعدی این صفحه نرسد
      void navigate(locationState.pathname, { replace: true, state: null });
    }
  }, [locationState.state, locationState.pathname, navigate, canFinalizeSales, setBuyerName, setSelectedCustomerId, setBuyerPhone, setBuyerAddress, setBuyerCity]);

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
        toast.error(`عدم موجودی کافی قابل فروش! موجودی ${whName}: ${formatPersianNumber(loc)}، رزرو سایر مصارف: ${formatPersianNumber(reserved)}، قابل فروش: ${formatPersianNumber(sellable)} ${it.unit} (مجموع درخواستی: ${formatPersianNumber(totalRequestedQty)} ${it.unit})`);
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

  // v9.0.300 (TD-790): تغییر انبار بالای فرم همه ردیف‌ها را به همان انبار می‌برد
  const handleLocationChange = (next: string) => {
    setLocation(next);
    setMultiWarehouseEdit(false);
    setDocItems(prev => prev.map(d => ({ ...d, location: undefined })));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // v10.1.72 (TD-1288): کادر عدد نامعتبر (هزینه ارسال «abc»، نرخ مالیات «۹٬۵») مقدار خالی می‌فرستد که صفر خوانده می‌شود؛
    // مرورگر با خطای همان کادر جلوی ارسال را می‌گیرد و فرم هم دوباره می‌سنجد تا چیزی با آن صفر ثبت نشود
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      return;
    }
    if (!buyerName || !buyerName.trim()) {
      toast.error('لطفاً خریدار / طرف حساب فاکتور را حتماً از فهرست طرفین حساب انتخاب کنید.');
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
    if (serviceCharge.error) {
      toast.error(serviceCharge.error);
      return;
    }

    // v9.0.304 (TD-801): ویرایش پیش‌فاکتور آن را قطعی نمی‌کند (سرور وضعیت «نهایی» را در ویرایش نمی‌پذیرد)؛ قطعی شدن از گردش
    // کار تأیید آن است. پیش‌تر گزینه انتخاب‌پذیر بود و به پیام نادرست «موجودی کافی نیست» با موجودی صفر ردیف بارشده می‌رسید
    if (editingDocId && status === 'final') {
      toast.error(EDIT_FINAL_REFUSED);
      return;
    }

    if (status === 'final' && warehouses.length === 0) {
      toast.error('هیچ انباری در سامانه تعریف نشده است. لطفاً ابتدا از بخش تنظیمات > مدیریت انبارها، حداقل یک انبار تعریف کنید.');
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
          toast.error(`موجودی قابل فروش کالا «${it.name}» (${formatPersianCode(it.code)}) در «${whName}» کافی نیست! موجودی انبار: ${formatPersianNumber(loc)}، رزرو سایر مصارف: ${formatPersianNumber(reserved)}، قابل فروش: ${formatPersianNumber(sellable)} ${it.unit}، درخواستی: ${formatPersianNumber(d.quantity)} ${it.unit}`);
          return;
        }
      }
    }

    const formattedDate = date || getTodayIsoDate();

    const payload = {
      docType,
      status,
      // v9.0.327 (TD-783): شماره از سری سرور؛ در ویرایش «auto» یعنی همان شماره ذخیره‌شده
      refNumber: 'auto',
      date: formattedDate,
      user: currentUser.full_name,
      inOut: 'out' as const,
      // v9.0.336 (TD-778، تصمیم ت۶ الف): طرف حساب با شناسه انتخابگر؛ نام فقط نمایش است
      partyId: selectedPartyId(selectedCustomerId),
      buyer_name: buyerName,
      buyer_city: buyerCity,
      buyer_phone: buyerPhone,
      buyer_address: buyerAddress,
      // v7.0.32 (TD-197): مالیات در فیلدهای ساختاریافته vatPercent/vatAmount ذخیره می‌شود، نه در متن یادداشت
      notes,
      location,
      currency,
      exchangeRate: currency !== 'IRR' ? exchangeRate : null,
      // v9.0.299 (TD-789): ویرایش پیش‌فاکتور پیوند پرونده فروش را دست نمی‌زند؛ فقط سند تازه با پرونده‌ای که از آن باز شده ثبت می‌شود
      crmLeadId: !editingDocId && crmLeadId ? Number(crmLeadId) : undefined,
      // v8.0.104 (TD-381): فقط درصد؛ مبلغ مالیات را سرور با همان قاعده جمع‌های فرم حساب می‌کند
      vatPercent: applyVat ? vatRate : 0,
      serviceChargeAmount: serviceCharge.amount,
      ...(editingDocId && editingVersion ? { version: editingVersion } : {}),
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
  const { gross: totalSum, discount: totalDiscount, vatAmount, serviceCharge: serviceChargeTotal, payable: finalPrice } = computeInvoiceTotals(docItems, applyVat ? vatRate : 0, currency, serviceCharge.error ? 0 : serviceCharge.amount);
  // v8.0.106 (TD-383): مبالغ فاکتور ارزی با دو رقم اعشار، همان مقدار ذخیره‌شده (پیش‌تر ۲۰۰٫۵ دلار «۲۰۱»)
  const amountDecimals = amountDecimalsOf(currency);

  if (printedDoc) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4 mb-4 print:hidden">
          <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center gap-2 font-bold">
            <Printer size={18} /> چاپ فاکتور
          </button>
          <button onClick={() => setPrintedDoc(null)} className="border px-4 py-2 rounded hover:bg-slate-50 font-medium">
            بازگشت به فرم ثبت
          </button>
        </div>
        
        <InvoicePrintView printedDoc={printedDoc} />
      </div>
    );
  }

  const priceOptions = pricesForCurrency(itemPrices, currency);

  return (
    <div className="space-y-6 max-w-5xl mx-auto print:hidden">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <ReceiptText size={20} className="text-blue-600 shrink-0" aria-hidden="true" />
          <h2 className="font-bold text-slate-800">ثبت فاکتور فروش</h2>
          <span className="text-xs text-slate-500">فاکتور نهایی یا پیش‌فاکتور</span>
          {draftStatusText && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border">{draftStatusText}</span>
          )}
        </div>

        {/* پیش‌نویس ذخیره‌شده در سامانه */}
        {hasServerDraft && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
              <span>پیش‌نویس ذخیره‌شده‌ای از این فرم هست.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={restoreDraft} className="min-h-[36px] px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition">
                بازیابی پیش‌نویس
              </button>
              <button type="button" onClick={discardDraft} className="min-h-[36px] px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-300 text-xs transition">
                نادیده گرفتن
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-8">
          <InvoiceHeaderFields
            status={status} onStatusChange={setStatus} finalDisabled={!canFinalizeSales || isEditing} finalOptionNote={finalOptionNote}
            currency={currency} onCurrencyChange={handleCurrencyChange} exchangeRate={exchangeRate} onExchangeRateChange={setExchangeRate}
            warehouses={warehouses} location={location} onLocationChange={handleLocationChange} multiWarehouseEdit={multiWarehouseEdit}
            refNumber={refNumber} date={date} onDateChange={setDate}
          />

          <InvoiceBuyerFields
            selectedCustomerId={selectedCustomerId} onCustomerSelect={handleCustomerSelect}
            buyerName={buyerName} buyerCity={buyerCity} buyerPhone={buyerPhone} buyerAddress={buyerAddress}
          />

          <InvoiceFormSection icon={Package} title="اقلام فاکتور"
            aside={docItems.length > 0 && <span className="text-[11px] text-slate-500">{formatPersianNumber(docItems.length)} ردیف</span>}>
            <InvoiceLinePicker
              location={location} status={status} editingDocId={editingDocId} warehouses={warehouses} currency={currency}
              selectedItem={selectedItem} onItemSelect={handleItemSelect} prices={priceOptions}
              quantity={quantity} onQuantityChange={setQuantity} unitPrice={unitPrice} onUnitPriceChange={setUnitPrice}
              discount={discount} onDiscountChange={setDiscount} onAdd={handleAddItem}
            />
            <InvoiceLinesList lines={docItems} currency={currency} amountDecimals={amountDecimals} warehouses={warehouses} onRemove={handleRemove}
              shortages={proformaLineShortages(docItems, { docType, status, headerLocation: location }, ownReserved)} />
          </InvoiceFormSection>

          {docItems.length > 0 && (
            <InvoiceTotalsPanel
              applyVat={applyVat} onApplyVatChange={setApplyVat} vatRate={vatRate} onVatRateChange={setVatRate}
              serviceChargeField={<InvoiceServiceChargeField value={serviceChargeText} onChange={setServiceChargeText} error={serviceCharge.error} currency={currency} />}
              gross={totalSum} discount={totalDiscount} vatAmount={vatAmount} serviceCharge={serviceChargeTotal} payable={finalPrice}
              currency={currency} amountDecimals={amountDecimals}
            />
          )}

          <div>
            <label htmlFor={`${fieldId}-notes`} className={INVOICE_LABEL}>توضیحات</label>
            <textarea id={`${fieldId}-notes`} value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={INVOICE_FIELD}></textarea>
          </div>

          <InvoiceSubmitBar isEditing={isEditing} refNumber={refNumber} disabled={docItems.length === 0 || !canRecordSales || isSaving}
            isSaving={isSaving} onCancelEdit={handleCancelEdit} />
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
