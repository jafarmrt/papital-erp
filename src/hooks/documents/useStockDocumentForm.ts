import { useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { Item, User, Customer, FinancialAttachment } from '../../types';
import { getTodayJalaliDate } from '../../utils';
import { useHasPermission } from '../../contexts/AuthContext';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { DocItemRow } from '../../components/documents/DocItemsTable';
import {
  buildGlobalReservations,
  itemReservationSummary,
  type StockDocProject,
} from '../../lib/documents/stockReservations';
import type { StockDocumentReferenceData } from './useStockDocumentReferenceData';
import { invoiceReturnTerms } from '../../lib/documents/returnUnitPrice';
import { returnInvoiceLookupError, returnInvoiceLookupUrl, type ReturnInvoiceCandidate } from '../../lib/documents/returnInvoiceLookup';
import { toPersianDigits } from '../../utils/persianNumber';

interface ReturnInvoiceLine {
  item_id: number;
  name: string;
  code: string;
  unit: string;
  quantity: number;
  unit_price?: number | string | null;
  discount?: number | string | null;
}

interface ReturnInvoiceDocument {
  id?: number;
  refFiscalYear?: number | null;
  buyer_name?: string;
  currency?: string | null;
  exchangeRate?: number | null;
  items?: ReturnInvoiceLine[];
}

/**
 * TD-080 (بخش ۳): وضعیت فرم رسید/حواله انبار، اثرها و محاسبات رزرو — منتقل‌شده بدون تغییر رفتار از DocumentsPage.
 * ترتیب useEffectها همان ترتیب صفحه اصلی است (انبار پیش‌فرض، بارگذاری پروژه، ریست با تغییر نوع، شماره سند بعدی).
 */
export function useStockDocumentForm(currentUser: User, refData: StockDocumentReferenceData) {
  const queryClient = useQueryClient();
  const { warehouses, personnelList, projectsList, reservedItemsData } = refData;

  const [actionType, setActionType] = useState<'in' | 'out'>('in');
  const [docType, setDocType] = useState('receipt');
  const [refNumber, setRefNumber] = useState('');
  // v9.0.258 (TD-783): شماره پیشنهادی سرور؛ همان شماره دست‌نخورده «auto» فرستاده می‌شود
  const [suggestedRef, setSuggestedRef] = useState('');
  const [date, setDate] = useState<string>(() => getTodayJalaliDate());
  const [location, setLocation] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [selectedSupplierObj, setSelectedSupplierObj] = useState<Customer | null>(null);
  const [currency, setCurrency] = useState('IRR');
  const [exchangeRate, setExchangeRate] = useState(0);
  const [returnInvoiceRef, setReturnInvoiceRef] = useState('');
  // v7.0.81 (TD-230): شناسه فاکتور فروش اصلی؛ کالای برگشتی با بهای خروج همان فاکتور وارد انبار می‌شود
  const [returnInvoiceId, setReturnInvoiceId] = useState<number | null>(null);
  // v9.0.257 (TD-782): فاکتورهای قطعی هم‌شماره در چند سال مالی، تا کاربر سال را انتخاب کند
  const [returnInvoiceCandidates, setReturnInvoiceCandidates] = useState<ReturnInvoiceCandidate[]>([]);
  // v9.0.247 (TD-774، تصمیم ت۵ الف): درصد مالیات برگشت بی فاکتور مرجع از کاربر؛ برگشت با فاکتور مرجع آن را از فاکتور دارد
  const [returnVatPercent, setReturnVatPercent] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  const [selectedItem, setSelectedItem] = useState('');
  const [selectedItemObj, setSelectedItemObj] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [isSaving, setIsSaving] = useState(false);

  const [docItems, setDocItems] = useState<DocItemRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedProjectObj, setSelectedProjectObj] = useState<StockDocProject | null>(null);
  const [showGlobalReservationsModal, setShowGlobalReservationsModal] = useState(false);
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);

  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [modalItemToEdit, setModalItemToEdit] = useState<Item | null>(null);

  // v9.0.148 (TD-893): تعریف و ویرایش کالا از فرم سند با همان مجوزهای API کالا، نه با کد نقش یا «*»
  const canCreateItem = useHasPermission('products.create');
  const canEditItem = useHasPermission('products.edit');
  const canCreateOrEditItem = canCreateItem || canEditItem;

  const handleItemModalSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.items.all });
    setIsItemModalOpen(false);
    setModalItemToEdit(null);
    toast.success('مشخصات و تصویر کالا با موفقیت ذخیره شد');
  };

  // بروزرسانی موقعیت پیش‌فرض هنگام دریافت انبارها
  useEffect(() => {
    if (!location && Array.isArray(warehouses) && warehouses.length > 0) {
      setLocation(warehouses[0].code);
    }
  }, [warehouses, location]);

  const selectedPersonnelObj = useMemo(() => {
    if (!buyerName || actionType !== 'out') return null;
    return personnelList.find(p => (p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim()) === buyerName.trim()) || null;
  }, [buyerName, personnelList, actionType]);

  /** شماره فاکتور مرجع عوض شد: فاکتور و سال‌های پیشین دیگر به آن تعلق ندارند */
  const changeReturnInvoiceRef = (ref: string) => {
    setReturnInvoiceRef(ref);
    setReturnInvoiceId(null);
    setReturnInvoiceCandidates([]);
  };

  // v9.0.257 (TD-782): فقط فاکتور قطعی؛ شماره‌ای که در چند سال مالی فاکتور دارد سال را می‌پرسد
  const handleFetchReturnInvoice = async (fiscalYear?: number | null) => {
    if (!returnInvoiceRef.trim()) return;
    try {
      const doc = await fetchJson<ReturnInvoiceDocument>(returnInvoiceLookupUrl(returnInvoiceRef, fiscalYear));
      if (doc && Array.isArray(doc.items)) {
        setReturnInvoiceCandidates([]);
        setReturnInvoiceId(typeof doc.id === 'number' ? doc.id : null);
        setBuyerName(doc.buyer_name || '');
        // v9.0.246 (TD-788، تصمیم ت۱۰ الف): ارز، نرخ و قیمت خالص هر واحد (پس از تخفیف ردیف، میانگین وزنی ردیف‌های یک کالا)
        // از فاکتور؛ همان تابعی که سرور با آن می‌سنجد. پیش‌تر فقط قیمت پیش از تخفیف کپی می‌شد و ارز صفحه (ریال) فرستاده می‌شد
        const invoiceLines = doc.items;
        const terms = invoiceReturnTerms(invoiceLines.map(i => ({ itemId: Number(i.item_id), quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount })));
        const newDocItems: DocItemRow[] = [];
        for (const [itemId, t] of terms) {
          const i = invoiceLines.find(line => Number(line.item_id) === itemId);
          newDocItems.push({
            item: { id: itemId, name: i?.name ?? '', code: i?.code ?? '', unit: i?.unit ?? '' } as Item,
            quantity: t.quantity.toNumber(),
            unitPrice: t.netUnitPrice.toNumber(),
          });
        }
        setCurrency(doc.currency || 'IRR');
        setExchangeRate(doc.currency && doc.currency !== 'IRR' ? Number(doc.exchangeRate) || 0 : 0);
        setDocItems(newDocItems);
        const year = doc.refFiscalYear ?? fiscalYear;
        setNotes(`برگشت از فاکتور فروش شماره ${returnInvoiceRef.trim()}${year ? ` سال مالی ${toPersianDigits(String(year))}` : ''}`);
        toast.success('اقلام فاکتور مرجع با موفقیت بارگذاری شد.');
      }
    } catch (err: unknown) {
      const { message, candidates } = returnInvoiceLookupError(err);
      setReturnInvoiceCandidates(candidates);
      toast.error(message);
    }
  };

  const fetchNextRef = async (signal?: AbortSignal) => {
    if (!docType) return;
    try {
      const { nextRef } = await fetchJson(`/documents/next-ref?type=${docType}`, { signal });
      setRefNumber(nextRef);
      setSuggestedRef(String(nextRef ?? ''));
    } catch (e: unknown) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      console.error(e);
    }
  };

  // v9.0.139 (TD-889): پروژه برگزیده از فهرست انتخاب پروژه؛ فرم فقط کد و عنوان آن را نشان می‌دهد و رزروهایش را از
  // /inventory/reserved-items می‌خواند، پس پرونده کامل پروژه (فقط با مجوز بخش پروژه) لازم نیست
  useEffect(() => {
    setSelectedProjectObj(selectedProjectId
      ? projectsList.find(p => String(p.id) === String(selectedProjectId)) ?? null
      : null);
  }, [selectedProjectId, projectsList]);

  useEffect(() => {
    // reset form when actionType changes
    setDocType(actionType === 'in' ? 'receipt' : 'remittance');
    setDocItems([]);
    setBuyerName('');
    setSelectedSupplierObj(null);
    setUnitPrice('');
    setQuantity('');
    setSelectedItem('');
    setSelectedItemObj(null);
    setSelectedProjectId('');
    setSelectedProjectObj(null);
    // TD-234 (بند ۳): ارز و نرخ تسعیر هم مثل بقیه فرم پاک می‌شوند
    setCurrency('IRR');
    setExchangeRate(0);
    setReturnVatPercent('');
  }, [actionType]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchNextRef(controller.signal);
    return () => controller.abort();
  }, [docType]);

  // Aggregate all global reservations across ALL projects and active proformas
  const allGlobalReservations = useMemo(
    () => buildGlobalReservations(reservedItemsData, projectsList),
    [reservedItemsData, projectsList]
  );

  // Total unique reserved items count
  const totalReservedItemsCount = allGlobalReservations.length;

  // Selected project reserved items
  const selectedProjectReservedItems = useMemo(() => {
    if (!selectedProjectId) return [];
    return allGlobalReservations.filter(
      r => r.sourceType === 'project' && String(r.projectId) === String(selectedProjectId)
    );
  }, [selectedProjectId, allGlobalReservations]);

  // Helper to calculate reservation metrics for any item
  const getItemReservationSummary = (it: Item) => itemReservationSummary(allGlobalReservations, it, selectedProjectId, location);

  const totalSum = useMemo(() => {
    return docItems.reduce((acc, curr) => acc + (curr.quantity * (curr.unitPrice || 0)), 0);
  }, [docItems]);

  const totalQuantitySum = useMemo(() => {
    return docItems.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0);
  }, [docItems]);

  // v9.0.246 (TD-788): برگشتِ دارای فاکتور مرجع ارز، نرخ و قیمت را از فاکتور دارد و فرم آن‌ها را قفل می‌کند
  const returnTermsLocked = docType === 'return' && returnInvoiceId !== null;

  return {
    actionType, setActionType,
    docType, setDocType,
    refNumber, setRefNumber, suggestedRef,
    date, setDate,
    location, setLocation,
    buyerName, setBuyerName,
    selectedSupplierObj, setSelectedSupplierObj,
    currency, setCurrency,
    exchangeRate, setExchangeRate,
    returnInvoiceRef, setReturnInvoiceRef,
    returnInvoiceId, setReturnInvoiceId,
    returnInvoiceCandidates, changeReturnInvoiceRef,
    returnTermsLocked,
    returnVatPercent, setReturnVatPercent,
    notes, setNotes,
    selectedItem, setSelectedItem,
    selectedItemObj, setSelectedItemObj,
    quantity, setQuantity,
    unitPrice, setUnitPrice,
    isSaving, setIsSaving,
    docItems, setDocItems,
    selectedProjectId, setSelectedProjectId,
    selectedProjectObj, setSelectedProjectObj,
    showGlobalReservationsModal, setShowGlobalReservationsModal,
    attachments, setAttachments,
    isItemModalOpen, setIsItemModalOpen,
    modalItemToEdit, setModalItemToEdit,
    canCreateOrEditItem,
    handleItemModalSuccess,
    selectedPersonnelObj,
    handleFetchReturnInvoice,
    fetchNextRef,
    allGlobalReservations,
    totalReservedItemsCount,
    selectedProjectReservedItems,
    getItemReservationSummary,
    totalSum,
    totalQuantitySum,
  };
}

export type StockDocumentForm = ReturnType<typeof useStockDocumentForm>;
