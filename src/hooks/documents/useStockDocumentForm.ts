import { useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { Item, User, Customer, FinancialAttachment } from '../../types';
import { getTodayJalaliDate } from '../../utils';
import { useAuth } from '../../contexts/AuthContext';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { DocItemRow } from '../../components/documents/DocItemsTable';
import {
  buildGlobalReservations,
  itemReservationSummary,
  type StockDocProject,
} from '../../lib/documents/stockReservations';
import type { StockDocumentReferenceData } from './useStockDocumentReferenceData';

interface ReturnInvoiceLine {
  item_id: number;
  name: string;
  code: string;
  unit: string;
  quantity: number;
  unit_price?: number | string | null;
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
  const [date, setDate] = useState<string>(() => getTodayJalaliDate());
  const [location, setLocation] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [selectedSupplierObj, setSelectedSupplierObj] = useState<Customer | null>(null);
  const [currency, setCurrency] = useState('IRR');
  const [exchangeRate, setExchangeRate] = useState(0);
  const [returnInvoiceRef, setReturnInvoiceRef] = useState('');
  // v7.0.81 (TD-230): شناسه فاکتور فروش اصلی؛ کالای برگشتی با بهای خروج همان فاکتور وارد انبار می‌شود
  const [returnInvoiceId, setReturnInvoiceId] = useState<number | null>(null);
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

  const { userPermissions } = useAuth();
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [modalItemToEdit, setModalItemToEdit] = useState<Item | null>(null);

  const canCreateOrEditItem = useMemo(() => {
    return !!(
      userPermissions?.isAdmin ||
      currentUser?.role === 'admin' ||
      currentUser?.role === 'manager' ||
      userPermissions?.permissions?.includes('*') ||
      userPermissions?.permissions?.includes('products.create') ||
      userPermissions?.permissions?.includes('products.edit')
    );
  }, [userPermissions, currentUser]);

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

  const handleFetchReturnInvoice = async () => {
    if (!returnInvoiceRef) return;
    try {
      const doc = await fetchJson(`/documents/by-ref/${encodeURIComponent(returnInvoiceRef.trim())}?type=invoice`);
      if (doc && doc.items) {
        setReturnInvoiceId(typeof doc.id === 'number' ? doc.id : null);
        setBuyerName(doc.buyer_name || '');
        const newDocItems = doc.items.map((i: ReturnInvoiceLine) => ({
          item: { id: i.item_id, name: i.name, code: i.code, unit: i.unit },
          quantity: i.quantity,
          unitPrice: Number(i.unit_price || 0)
        }));
        setDocItems(newDocItems);
        setNotes(`برگشت از فاکتور فروش شماره ${returnInvoiceRef}`);
        toast.success('اقلام فاکتور مرجع با موفقیت بارگذاری شد.');
      }
    } catch {
      toast.error('فاکتوری با این شماره یافت نشد.');
    }
  };

  const fetchNextRef = async (signal?: AbortSignal) => {
    if (!docType) return;
    try {
      const { nextRef } = await fetchJson(`/documents/next-ref?type=${docType}`, { signal });
      setRefNumber(nextRef);
    } catch (e: unknown) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      console.error(e);
    }
  };

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProjectObj(null);
      return;
    }
    const controller = new AbortController();
    fetchJson(`/projects/${selectedProjectId}`, { signal: controller.signal }).then(p => {
      setSelectedProjectObj(p);
    }).catch(err => {
      if (err?.name === 'AbortError') return;
      console.error(err);
    });
    return () => controller.abort();
  }, [selectedProjectId]);

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
  const getItemReservationSummary = (it: Item) => itemReservationSummary(allGlobalReservations, it, selectedProjectId);

  const totalSum = useMemo(() => {
    return docItems.reduce((acc, curr) => acc + (curr.quantity * (curr.unitPrice || 0)), 0);
  }, [docItems]);

  const totalQuantitySum = useMemo(() => {
    return docItems.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0);
  }, [docItems]);

  return {
    actionType, setActionType,
    docType, setDocType,
    refNumber, setRefNumber,
    date, setDate,
    location, setLocation,
    buyerName, setBuyerName,
    selectedSupplierObj, setSelectedSupplierObj,
    currency, setCurrency,
    exchangeRate, setExchangeRate,
    returnInvoiceRef, setReturnInvoiceRef,
    returnInvoiceId, setReturnInvoiceId,
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
