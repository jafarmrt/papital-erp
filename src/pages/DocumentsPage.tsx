import React, { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { toast } from 'react-hot-toast';
import { Item, User, Customer, Personnel } from '../types';
import { 
  Plus, Trash2, FileInput, FileOutput, Lock, Unlock, 
  Package, CheckCircle2, AlertTriangle, Users, Building2, 
  Calendar, FileText, UserCheck, Layers, Info, RefreshCw,
  DollarSign, ShoppingCart, CreditCard, Check, Truck, ArrowDownLeft
} from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel, extractDateString, getTodayJalaliDate } from '../utils';

import { SearchableSelect } from '../components/SearchableSelect';
import {
  useWarehousesQuery,
  usePersonnelListQuery
} from '../hooks/queries';
import GlobalReservationsPanel from '../components/documents/GlobalReservationsPanel';
import DocItemsTable from '../components/documents/DocItemsTable';
import { QUERY_KEYS } from '../lib/queryKeys';

export default function DocumentsPage({ user: currentUser }: { user: User }) {
  // V9 Phase 5.1: لیست‌های مرجع فرم با React Query — کش مشترک بین صفحات و حذف fetch دستی
  const queryClient = useQueryClient();
  const whsQuery = useWarehousesQuery();
  const personnelQuery = usePersonnelListQuery();
  const projectsQuery = useQuery<any[]>({
    queryKey: QUERY_KEYS.projects.list(),
    queryFn: async () => {
      const res = await fetchJson('/projects');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  const suppliersQuery = useQuery<Customer[]>({
    queryKey: QUERY_KEYS.customers.list({ scope: 'doc-suppliers' }),
    queryFn: async () => {
      const res = await fetchJson('/customers?limit=1000');
      return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const warehouses = whsQuery.data ?? [];
  const personnelList = personnelQuery.data ?? [];
  const projectsList = projectsQuery.data ?? [];
  const suppliersList = suppliersQuery.data ?? [];

  const [actionType, setActionType] = useState<'in' | 'out'>('in');
  const [docType, setDocType] = useState('receipt');
  const [refNumber, setRefNumber] = useState('');
  const [date, setDate] = useState<any>(() => getTodayJalaliDate());
  const [location, setLocation] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [selectedSupplierObj, setSelectedSupplierObj] = useState<Customer | null>(null);
  const [currency, setCurrency] = useState('IRR');
  const [returnInvoiceRef, setReturnInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');

  const [selectedItem, setSelectedItem] = useState('');
  const [selectedItemObj, setSelectedItemObj] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [isSaving, setIsSaving] = useState(false);
  
  const [docItems, setDocItems] = useState<{item: Item, quantity: number, unitPrice: number}[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedProjectObj, setSelectedProjectObj] = useState<any | null>(null);
  const [showGlobalReservationsModal, setShowGlobalReservationsModal] = useState(false);

  // بروزرسانی موقعیت پیش‌فرض هنگام دریافت انبارها
  useEffect(() => {
    if (!location && Array.isArray(warehouses) && warehouses.length > 0) {
      setLocation(warehouses[0].code);
    }
  }, [warehouses, location]);

  // بازخوانی لیست پروژه‌ها پس از عملیات تخصیص
  const reloadReferenceLists = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.customers.all });
  };

  const selectedPersonnelObj = useMemo(() => {
    if (!buyerName || actionType !== 'out') return null;
    return personnelList.find(p => (p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim()) === buyerName.trim()) || null;
  }, [buyerName, personnelList, actionType]);

  const handleFetchReturnInvoice = async () => {
    if (!returnInvoiceRef) return;
    try {
      const doc = await fetchJson(`/documents/by-ref/${returnInvoiceRef}?type=invoice`);
      if (doc && doc.items) {
        setBuyerName(doc.buyer_name || '');
        const newDocItems = doc.items.map((i: any) => ({
          item: { id: i.item_id, name: i.name, code: i.code, unit: i.unit },
          quantity: i.quantity,
          unitPrice: Number(i.unit_price || 0)
        }));
        setDocItems(newDocItems);
        setNotes(`برگشت از فاکتور فروش شماره ${returnInvoiceRef}`);
        toast.success('اقلام فاکتور مرجع با موفقیت بارگذاری شد.');
      }
    } catch (e: any) {
      toast.error('فاکتوری با این شماره یافت نشد.');
    }
  };

  const fetchNextRef = async (signal?: AbortSignal) => {
    if (!docType) return;
    try {
      const { nextRef } = await fetchJson(`/documents/next-ref?type=${docType}`, { signal });
      setRefNumber(nextRef);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
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
  }, [actionType]);

  useEffect(() => {
    const controller = new AbortController();
    fetchNextRef(controller.signal);
    return () => controller.abort();
  }, [docType]);

  // Aggregate all global reservations across ALL projects
  const allGlobalReservations = useMemo(() => {
    const list: Array<{
      projectId: string | number;
      projectCode: string;
      projectTitle: string;
      itemId?: number | string;
      itemCode: string;
      itemName: string;
      reservedQty: number;
      unit: string;
      reservedAt?: string;
    }> = [];

    projectsList.forEach(p => {
      const reservedItems = p.inventory_control?.reservedItems;
      if (Array.isArray(reservedItems) && reservedItems.length > 0) {
        reservedItems.forEach((rItem: any) => {
          list.push({
            projectId: p.id,
            projectCode: p.project_code || `PRJ-${p.id}`,
            projectTitle: p.title || 'بدون عنوان',
            itemId: rItem.itemId,
            itemCode: rItem.itemCode || '',
            itemName: rItem.itemName || '',
            reservedQty: Number(rItem.reservedQty || 0),
            unit: rItem.unit || 'عدد',
            reservedAt: rItem.reservedAt
          });
        });
      }
    });

    return list;
  }, [projectsList]);

  // Total unique reserved items count
  const totalReservedItemsCount = allGlobalReservations.length;

  // Helper to calculate reservation metrics for any item
  const getItemReservationSummary = (it: Item) => {
    const matchingReservations = allGlobalReservations.filter(r =>
      (r.itemCode && it.code && r.itemCode.trim() === it.code.trim()) ||
      (r.itemName && it.name && r.itemName.trim().toLowerCase() === it.name.trim().toLowerCase())
    );

    const totalReservedQty = matchingReservations.reduce((acc, r) => acc + r.reservedQty, 0);

    const reservedForSelectedProject = selectedProjectId
      ? matchingReservations.filter(r => String(r.projectId) === String(selectedProjectId)).reduce((acc, r) => acc + r.reservedQty, 0)
      : 0;

    const reservedForOtherProjects = totalReservedQty - reservedForSelectedProject;

    // Max allowed exit for this document selection
    const maxAllowedForExit = Math.max(0, it.current_stock - reservedForOtherProjects);

    return {
      matchingReservations,
      totalReservedQty,
      reservedForSelectedProject,
      reservedForOtherProjects,
      maxAllowedForExit
    };
  };

  const handleItemSelect = (val: string, rawItem?: any) => {
    setSelectedItem(val);
    setSelectedItemObj(rawItem || null);
    if (rawItem) {
      if (actionType === 'in') {
        const itemPurchasePrice = rawItem.purchase_price ? Number(rawItem.purchase_price) : 0;
        setUnitPrice(itemPurchasePrice > 0 ? itemPurchasePrice : '');
      }
    } else {
      setUnitPrice('');
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
    const reqQty = Number(quantity);
    const itemPrice = Number(unitPrice || 0);

    if (actionType === 'out') {
      const { reservedForOtherProjects, maxAllowedForExit, matchingReservations } = getItemReservationSummary(it);

      const existingQtyInDoc = docItems.find(p => p.item.id === it.id)?.quantity || 0;
      const totalRequestedInDoc = existingQtyInDoc + reqQty;

      if (totalRequestedInDoc > maxAllowedForExit) {
        if (reservedForOtherProjects > 0) {
          const otherProjTitles = matchingReservations
            .filter(r => String(r.projectId) !== String(selectedProjectId))
            .map(r => `پروژه «${r.projectCode || r.projectTitle}» (${r.reservedQty} ${r.unit})`)
            .join('، ');

          toast.error(
            `خطا: امکان خروج بیش از ${maxAllowedForExit} ${it.unit} وجود ندارد!\nتعداد ${reservedForOtherProjects} ${it.unit} برای سایر پروژه‌ها (${otherProjTitles}) رزرو شده است و قابل خروج نمی‌باشد.`
          );
        } else {
          toast.error(`موجودی کافی نیست! موجودی قابل خروج: ${maxAllowedForExit} ${it.unit}`);
        }
        return;
      }
    }

    setDocItems(prev => {
      const existingIndex = prev.findIndex(p => p.item.id === it.id);
      if (existingIndex >= 0) {
        return prev.map((p, idx) => idx === existingIndex ? { 
          ...p, 
          quantity: p.quantity + reqQty,
          unitPrice: itemPrice > 0 ? itemPrice : p.unitPrice
        } : p);
      }
      return [...prev, { item: it, quantity: reqQty, unitPrice: itemPrice }];
    });

    setSelectedItem('');
    setSelectedItemObj(null);
    setQuantity('');
    setUnitPrice('');
  };

  const handleUpdateItemQty = (index: number, newQty: number) => {
    if (newQty <= 0) return;
    const dItem = docItems[index];

    if (actionType === 'out') {
      const { reservedForOtherProjects, maxAllowedForExit, matchingReservations } = getItemReservationSummary(dItem.item);

      if (newQty > maxAllowedForExit) {
        if (reservedForOtherProjects > 0) {
          const otherProjTitles = matchingReservations
            .filter(r => String(r.projectId) !== String(selectedProjectId))
            .map(r => `پروژه «${r.projectCode || r.projectTitle}» (${r.reservedQty} ${r.unit})`)
            .join('، ');

          toast.error(
            `خطا: حداکثر سقف مجاز خروج این کالا ${maxAllowedForExit} ${dItem.item.unit} است. ${reservedForOtherProjects} ${dItem.item.unit} برای ${otherProjTitles} رزرو است.`
          );
        } else {
          toast.error(`حداکثر موجودی قابل خروج ${maxAllowedForExit} ${dItem.item.unit} می‌باشد.`);
        }
        return;
      }
    }

    setDocItems(prev => prev.map((item, idx) => idx === index ? { ...item, quantity: newQty } : item));
  };

  const handleUpdateItemPrice = (index: number, newPrice: number) => {
    setDocItems(prev => prev.map((item, idx) => idx === index ? { ...item, unitPrice: Math.max(0, newPrice) } : item));
  };

  const handleRemove = (id: number) => {
    setDocItems(prev => prev.filter(p => p.item.id !== id));
  };

  const totalSum = useMemo(() => {
    return docItems.reduce((acc, curr) => acc + (curr.quantity * (curr.unitPrice || 0)), 0);
  }, [docItems]);

  const totalQuantitySum = useMemo(() => {
    return docItems.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0);
  }, [docItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (docItems.length === 0) {
      toast.error('هیچ کالایی اضافه نشده است.');
      return;
    }

    // Double check constraints for all items before submitting
    if (actionType === 'out') {
      for (const d of docItems) {
        const { reservedForOtherProjects, maxAllowedForExit, matchingReservations } = getItemReservationSummary(d.item);
        if (d.quantity > maxAllowedForExit) {
          const otherProjTitles = matchingReservations
            .filter(r => String(r.projectId) !== String(selectedProjectId))
            .map(r => `«${r.projectCode || r.projectTitle}»`)
            .join('، ');

          toast.error(`خطا در کالا «${d.item.name}»: مقدار درخواستی (${d.quantity}) بیش از حد مجاز خروج (${maxAllowedForExit}) است. (${reservedForOtherProjects} ${d.item.unit} برای ${otherProjTitles} رزرو است)`);
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      const formattedDate = extractDateString(date) || new Date().toISOString().split('T')[0];

      let finalNotes = notes || '';
      if (actionType === 'out' && selectedProjectObj) {
        const projTag = `[پروژه: ${selectedProjectObj.project_code || selectedProjectObj.title}]`;
        if (!finalNotes.includes(projTag)) {
          finalNotes = `${projTag} ${finalNotes}`.trim();
        }
      }

      await fetchJson('/documents', {
        method: 'POST',
        body: JSON.stringify({
          docType,
          status: 'final',
          refNumber,
          date: formattedDate,
          user: currentUser.full_name || currentUser.username,
          location,
          buyer_name: buyerName,
          notes: finalNotes,
          inOut: actionType,
          currency,
          projectId: selectedProjectId ? Number(selectedProjectId) : undefined,
          items: docItems.map(d => ({ 
            itemId: d.item.id, 
            quantity: d.quantity,
            unit_price: d.unitPrice || 0
          }))
        })
      });

      if (actionType === 'out' && selectedProjectObj) {
        const currentInvControl = selectedProjectObj.inventory_control || {};
        let reservedItemsList = Array.isArray(currentInvControl.reservedItems) ? [...currentInvControl.reservedItems] : [];

        let totalDeductedCount = 0;
        for (const d of docItems) {
          const qtyIssued = Number(d.quantity || 0);
          if (qtyIssued <= 0) continue;

          const resIdx = reservedItemsList.findIndex((r: any) =>
            (r.itemId && d.item.id && Number(r.itemId) === Number(d.item.id)) ||
            (r.itemCode && d.item.code && String(r.itemCode).trim().toLowerCase() === String(d.item.code).trim().toLowerCase()) ||
            (r.itemName && d.item.name && String(r.itemName).trim().toLowerCase() === String(d.item.name).trim().toLowerCase())
          );

          if (resIdx !== -1) {
            const currentResQty = Number(reservedItemsList[resIdx].reservedQty || 0);
            const deducted = Math.min(currentResQty, qtyIssued);
            const newResQty = Math.max(0, currentResQty - qtyIssued);
            totalDeductedCount += deducted;

            if (newResQty > 0) {
              reservedItemsList[resIdx] = {
                ...reservedItemsList[resIdx],
                reservedQty: newResQty
              };
            } else {
              reservedItemsList.splice(resIdx, 1);
            }
          }
        }

        if (totalDeductedCount > 0) {
          const updatedInvControl = {
            ...currentInvControl,
            reservedItems: reservedItemsList,
            isReserved: reservedItemsList.length > 0,
            lastUpdated: new Date().toISOString()
          };

          try {
            await fetchJson(`/projects/${selectedProjectObj.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inventory_control: updatedInvControl
              })
            });
            toast.success(`سند خروج با موفقیت ثبت شد و تعداد ${totalDeductedCount} عدد از اقلام رزرو شده پروژه «${selectedProjectObj.project_code || selectedProjectObj.title}» کسر گردید.`);
          } catch (projErr) {
            console.error("Error updating project reserved items:", projErr);
          }
        } else {
          toast.success('سند حواله خروج با موفقیت ثبت شد و فرآیند تایید در ورکفلو آغاز گردید.');
        }
      } else {
        if (actionType === 'in' && docType === 'receipt') {
          toast.success('رسید خرید با موفقیت ثبت شد و گردش کار تاییدات مالی و انبار آغاز گردید.');
        } else {
          toast.success('سند با موفقیت در سیستم ثبت گردید!');
        }
      }

      setDocItems([]);
      fetchNextRef();
      setBuyerName('');
      setSelectedSupplierObj(null);
      setNotes('');
      setUnitPrice('');
      setQuantity('');
      setSelectedProjectId('');
      setSelectedProjectObj(null);
      reloadReferenceLists(); // Refresh project list and reservations
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت سند');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header Harmonized with Projects Page */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border ${
            actionType === 'in' 
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
              : 'bg-amber-50 text-amber-600 border-amber-200'
          }`}>
            {actionType === 'in' ? <FileInput size={26} /> : <FileOutput size={26} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-slate-900">ورود و خروج به انبار (رسید و حواله)</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                actionType === 'in'
                  ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                  : 'bg-amber-100 text-amber-950 border-amber-300'
              }`}>
                {actionType === 'in' ? 'ثبت ورود کالا (رسید انبار / فاکتور خرید)' : 'ثبت خروج کالا (حواله مصرف)'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              مدیریت تراکنش‌های انبار، صدور اسناد رسید خرید و حواله مصرف با محاسبه اتوماتیک میانگین موزون (WAC) و صدور اسناد دوبل حسابداری.
            </p>
          </div>
        </div>

        {/* Global Warehouse Reservation Stats Badge */}
        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setShowGlobalReservationsModal(!showGlobalReservationsModal)}
            className="flex items-center gap-2 px-3.5 py-2 bg-purple-50 hover:bg-purple-100/80 border border-purple-200 rounded-xl text-purple-950 font-bold text-xs transition-all shadow-2xs group cursor-pointer"
          >
            <Lock size={15} className="text-purple-600 group-hover:scale-110 transition-transform" />
            <span>اقلام رزرو شده انبار ({totalReservedItemsCount} کالا)</span>
          </button>
        </div>
      </div>

      {/* V9 Phase 5.2: پنل رزروهای سراسری استخراج‌شده */}
      <GlobalReservationsPanel
        isOpen={showGlobalReservationsModal}
        onClose={() => setShowGlobalReservationsModal(false)}
        reservations={allGlobalReservations}
      />

      {/* Main Card Container */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {/* Action Type Toggle Header */}
        <div className="grid grid-cols-2 p-1.5 bg-slate-100/80 border-b border-slate-200 gap-1.5">
          <button 
            type="button" 
            className={`py-3.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              actionType === 'in' 
                ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200 font-extrabold' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
            onClick={() => setActionType('in')}
          >
            <FileInput size={18} className={actionType === 'in' ? 'text-emerald-600' : 'text-slate-400'} />
            <span>ورود به انبار (رسید انبار / فاکتور خرید)</span>
          </button>
          <button 
            type="button" 
            className={`py-3.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              actionType === 'out' 
                ? 'bg-white text-amber-700 shadow-sm border border-amber-200 font-extrabold' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
            onClick={() => setActionType('out')}
          >
            <FileOutput size={18} className={actionType === 'out' ? 'text-amber-600' : 'text-slate-400'} />
            <span>خروج از انبار (حواله مصرف)</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">
          {/* Document Section Header */}
          <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2">
            <Building2 size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">
              {actionType === 'in' ? 'مشخصات سند رسید ورود / فاکتور خرید و تامین‌کننده' : 'مشخصات سند حواله خروج و تحویل‌گیرنده'}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-700">نوع سند</label>
              <select 
                className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                value={docType} 
                onChange={e => setDocType(e.target.value)}
              >
                {actionType === 'in' ? (
                  <>
                    <option value="receipt">رسید خرید مواد اولیه / کالا (فاکتور خرید)</option>
                    <option value="production_receipt">رسید انبار تولید (تحویل محصولات ساخته‌شده)</option>
                    <option value="return">برگشت از فروش / مرجوعی مشتری</option>
                  </>
                ) : (
                  <>
                    <option value="remittance">حواله خروج مصرف (تولید / کارگاه)</option>
                    <option value="waste">ضایعات و اسقاط</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-700">شماره سند / رفرنس</label>
              <input 
                required 
                type="text" 
                value={refNumber} 
                onChange={e => setRefNumber(e.target.value)} 
                className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 text-left font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                dir="ltr" 
              />
            </div>

            {actionType === 'in' && (
              <div>
                <label className="block text-xs font-bold mb-1.5 text-slate-700">واحد پول (ارز سند)</label>
                <select 
                  className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                  value={currency} 
                  onChange={e => setCurrency(e.target.value)}
                >
                  <option value="IRR">ریال (IRR)</option>
                  <option value="USD">دلار (USD)</option>
                  <option value="EUR">یورو (EUR)</option>
                  <option value="AED">درهم (AED)</option>
                  <option value="GBP">پوند (GBP)</option>
                </select>
              </div>
            )}

            {actionType === 'out' && (
              <div>
                <label className="block text-xs font-bold mb-1.5 text-purple-950 flex items-center gap-1">
                  <Lock size={13} className="text-purple-600" />
                  <span>پروژه مربوطه (جهت خروج)</span>
                </label>
                <select 
                  className="w-full border border-purple-300 bg-purple-50/60 rounded-xl text-sm px-3 py-2 font-bold text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all" 
                  value={selectedProjectId} 
                  onChange={e => setSelectedProjectId(e.target.value)}
                >
                  <option value="">— خروج عمومی (بدون تخصیص به پروژه) —</option>
                  {projectsList.map((p, idx) => (
                    <option key={`proj-${p.id || idx}-${idx}`} value={p.id}>
                      پروژه {p.project_code || p.id} - {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {docType === 'return' && (
              <div>
                <label className="block text-xs font-bold mb-1.5 text-slate-700">شماره فاکتور مرجع</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={returnInvoiceRef} 
                    onChange={e => setReturnInvoiceRef(e.target.value)} 
                    placeholder="مثال: 1005" 
                    className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 text-left font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" 
                    dir="ltr" 
                  />
                  <button 
                    type="button" 
                    onClick={handleFetchReturnInvoice} 
                    className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-colors"
                  >
                    جستجو
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Users size={13} className="text-slate-500" />
                  <span>{actionType === 'in' ? 'تامین‌کننده / فروشنده کالا' : 'گیرنده حواله (پرسنل کارگاه)'}</span>
                </span>
                {actionType === 'in' && selectedSupplierObj && (
                  <span className="text-[10px] font-normal text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    طرف حساب ثبت‌شده {selectedSupplierObj.supplierCategory ? `(${selectedSupplierObj.supplierCategory})` : ''}
                  </span>
                )}
                {actionType === 'out' && selectedPersonnelObj && (
                  <span className="text-[10px] font-normal text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                    پرسنل کارگاه: {selectedPersonnelObj.jobTitle || 'عضو تیم'} {selectedPersonnelObj.personnelCode ? `| کد: ${selectedPersonnelObj.personnelCode}` : ''}
                  </span>
                )}
              </label>
              {actionType === 'out' && personnelList.length > 0 ? (
                <select
                  required
                  value={buyerName}
                  onChange={e => setBuyerName(e.target.value)}
                  className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                >
                  <option value="">-- انتخاب پرسنل گیرنده از لیست پرسنل کارگاه --</option>
                  {personnelList.map((p, idx) => {
                    const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'پرسنل';
                    const code = p.personnelCode ? `[کد: ${p.personnelCode}]` : '';
                    const title = p.jobTitle ? `- ${p.jobTitle}` : '';
                    const status = p.employmentStatus && p.employmentStatus !== 'فعال' ? `(${p.employmentStatus})` : '';
                    return (
                      <option key={`pers-${p.id || idx}-${idx}`} value={name}>
                        👤 {name} {code} {title} {status}
                      </option>
                    );
                  })}
                </select>
              ) : actionType === 'in' ? (
                <div className="space-y-1.5">
                  <SearchableSelect
                    value={buyerName}
                    onChange={(val) => {
                      setBuyerName(val);
                      const list = Array.isArray(suppliersList) ? suppliersList : [];
                      const found = list.find(s => s.name.trim().toLowerCase() === val.trim().toLowerCase());
                      setSelectedSupplierObj(found || null);
                    }}
                    placeholder="-- انتخاب تامین‌کننده / فروشنده --"
                    options={[{ value: '', label: '-- انتخاب تامین‌کننده / فروشنده از دفتر طرفین حساب --' },
                      ...(Array.isArray(suppliersList) ? suppliersList : []).map((s, idx) => ({
                        value: s.name,
                        label: `${s.partyType === 'supplier' ? '🏭 تامین‌کننده' : '👤 طرف‌حساب'}: ${s.name} ${s.supplierCategory ? `(${s.supplierCategory})` : ''} ${s.phone ? `- ${s.phone}` : ''}`
                      }))]}
                  />
                  {selectedSupplierObj?.bankInfo && (selectedSupplierObj.bankInfo.cardNumber || selectedSupplierObj.bankInfo.shaba) && (
                    <div className="text-[11px] text-slate-600 bg-slate-100/80 px-2.5 py-1.5 rounded-lg border border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {selectedSupplierObj.bankInfo.bankName && (
                        <span>بانک: <strong>{selectedSupplierObj.bankInfo.bankName}</strong></span>
                      )}
                      {selectedSupplierObj.bankInfo.cardNumber && (
                        <span>کارت: <strong className="font-mono" dir="ltr">{selectedSupplierObj.bankInfo.cardNumber}</strong></span>
                      )}
                      {selectedSupplierObj.bankInfo.shaba && (
                        <span>شبا: <strong className="font-mono" dir="ltr">{selectedSupplierObj.bankInfo.shaba}</strong></span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <input 
                  required={actionType === 'out'} 
                  type="text" 
                  value={buyerName} 
                  onChange={e => setBuyerName(e.target.value)} 
                  placeholder="نام پرسنل گیرنده حواله..." 
                  className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center gap-1">
                <Building2 size={13} className="text-slate-500" />
                <span>{actionType === 'in' ? 'انبار مقصد (ورود)' : 'انبار مبدا (خروج)'}</span>
              </label>
              <select 
                className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
                value={location} 
                onChange={e => setLocation(e.target.value)}
              >
                {warehouses.map(w => (
                  <option key={w.code} value={w.code}>
                    📦 {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center gap-1">
                <Calendar size={13} className="text-slate-500" />
                <span>تاریخ سند</span>
              </label>
              <DatePicker 
                value={date} 
                onChange={(dateObj: any) => setDate(extractDateString(dateObj))} 
                calendar={persian} 
                locale={persian_fa} 
                calendarPosition="bottom-right"
                inputClass="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                containerClassName="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-700 flex items-center gap-1">
                <UserCheck size={13} className="text-slate-500" />
                <span>کاربر صادرکننده</span>
              </label>
              <div className="w-full border border-slate-200 rounded-xl bg-slate-100 text-sm px-3 py-2 font-bold text-slate-800 flex items-center justify-between shadow-2xs">
                <span>{currentUser.full_name || currentUser.username}</span>
                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono">فعال</span>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold mb-1.5 text-slate-700">توضیحات و ملاحظات</label>
              <input 
                type="text" 
                value={notes} 
                onChange={e => setNotes(e.target.value)} 
                placeholder="توضیحات تکمیلی سند، بابت خرید یا حواله مصرف..." 
                className="w-full border border-slate-200 bg-slate-50/50 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
              />
            </div>
          </div>

          {/* Selected Project Reserved Items Info Card */}
          {actionType === 'out' && selectedProjectObj && (
            <div className="bg-purple-50/80 border border-purple-200 rounded-2xl p-4 space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-950 text-xs flex items-center gap-1.5">
                  🔒 اقلام رزرو شده انبار برای پروژه «{selectedProjectObj.project_code || selectedProjectObj.title}»:
                </span>
                <span className="text-[11px] font-mono text-purple-900 font-bold bg-purple-200/80 px-2.5 py-0.5 rounded-full border border-purple-300">
                  {selectedProjectObj.inventory_control?.reservedItems?.length || 0} کالا فریز شده
                </span>
              </div>

              {selectedProjectObj.inventory_control?.reservedItems && selectedProjectObj.inventory_control.reservedItems.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedProjectObj.inventory_control.reservedItems.map((rItem: any, idx: number) => (
                    <div key={idx} className="bg-white border border-purple-300 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-800 flex items-center gap-2 shadow-2xs">
                      <span className="text-purple-900 font-mono">{rItem.itemCode || '---'}</span>
                      <span className="text-slate-900">{rItem.itemName}</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded-md font-mono font-bold text-[11px] border border-emerald-300">
                        {rItem.reservedQty} {rItem.unit}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-purple-800">
                  برای این پروژه هنوز هیچ رزرو انبار ثبتی صورت نگرفته است. خروج کالا مطابق با موجودی آزاد انبار انجام می‌شود.
                </p>
              )}
            </div>
          )}

          {/* Item Selection Section */}
          <div className="border-t border-slate-200 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-800">
                <Package size={18} className="text-blue-600" />
                <h3 className="font-bold text-sm">
                  {actionType === 'in' ? 'اقلام ورودی / خریداری‌شده' : 'اقلام و کالاهای حواله خروج'}
                </h3>
              </div>
              {actionType === 'out' && (
                <span className="text-xs text-amber-900 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold">
                  ⚠️ خروج کالا تنها از موجودی آزاد و غیررزروی امکان‌پذیر است
                </span>
              )}
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className={actionType === 'in' ? "md:col-span-5 w-full" : "md:col-span-8 w-full"}>
                  <label className="block text-xs font-bold mb-1.5 text-slate-700">جستجو و انتخاب کالا / ماده اولیه</label>
                  <SearchableSelect
                    className="w-full shadow-2xs rounded-xl"
                    fetchUrl="/items"
                    mapResultToOption={(it: any) => {
                      const { totalReservedQty, reservedForOtherProjects, reservedForSelectedProject, maxAllowedForExit } = getItemReservationSummary(it);

                      let label = `${it.code} - ${it.name} (موجودی فعلی: ${it.current_stock} ${it.unit})`;

                      if (actionType === 'out') {
                        if (totalReservedQty > 0) {
                          if (reservedForOtherProjects > 0) {
                            label += ` | 🔒 رزرو پروژه‌های دیگر: ${reservedForOtherProjects} ${it.unit}`;
                          }
                          if (reservedForSelectedProject > 0) {
                            label += ` | 🟢 سهم رزرو این پروژه: ${reservedForSelectedProject} ${it.unit}`;
                          }
                          label += ` | ▫️ سقف مجاز خروج: ${maxAllowedForExit} ${it.unit}`;
                        } else {
                          label += ` | ▫️ مجاز جهت خروج: ${maxAllowedForExit} ${it.unit}`;
                        }
                      } else if (it.purchase_price) {
                        label += ` | فی خرید قبلی: ${Number(it.purchase_price).toLocaleString('fa-IR')} ${currency}`;
                      }

                      return {
                        value: it.id.toString(),
                        label,
                        disabled: actionType === 'out' && maxAllowedForExit <= 0
                      };
                    }}
                    value={selectedItem}
                    onChange={handleItemSelect}
                    placeholder="کد یا نام کالا را تایپ کنید..."
                  />
                </div>

                <div className={actionType === 'in' ? "md:col-span-2" : "md:col-span-2"}>
                  <label className="block text-xs font-bold mb-1.5 text-slate-700">تعداد / مقدار</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="any" 
                    value={quantity} 
                    onChange={e => setQuantity(e.target.value ? Number(e.target.value) : '')} 
                    placeholder="0"
                    className="w-full border border-slate-200 bg-white rounded-xl text-sm px-3 py-2 text-center font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" 
                    dir="ltr" 
                  />
                </div>

                {actionType === 'in' && (
                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold mb-1.5 text-slate-700">
                      قیمت خرید واحد (فی - {currency})
                    </label>
                    <input 
                      type="number" 
                      min="0" 
                      step="any" 
                      value={unitPrice} 
                      onChange={e => setUnitPrice(e.target.value ? Number(e.target.value) : '')} 
                      placeholder="مثال: 100000"
                      className="w-full border border-slate-200 bg-white rounded-xl text-sm px-3 py-2 text-left font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      dir="ltr" 
                    />
                  </div>
                )}

                <div className={actionType === 'in' ? "md:col-span-2" : "md:col-span-2"}>
                  <button 
                    type="button" 
                    onClick={handleAddItem} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold h-[38px] transition-all shadow-sm shrink-0 cursor-pointer"
                  >
                    <Plus size={18} /> افزودن به ردیف‌ها
                  </button>
                </div>
              </div>

              {/* Instant Item Inspection Banner */}
              {selectedItemObj && actionType === 'out' && (
                <div className="bg-white border border-slate-200 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{selectedItemObj.code}</span>
                    <span className="font-bold text-slate-900">{selectedItemObj.name}</span>
                  </div>
                  {(() => {
                    const { totalReservedQty, reservedForOtherProjects, reservedForSelectedProject, maxAllowedForExit } = getItemReservationSummary(selectedItemObj);
                    return (
                      <div className="flex flex-wrap items-center gap-2 font-mono">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 border">موجودی کل: {selectedItemObj.current_stock} {selectedItemObj.unit}</span>
                        {reservedForOtherProjects > 0 && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-950 rounded font-bold border border-purple-300">
                            🔒 رزرو سایر پروژه‌ها: {reservedForOtherProjects} {selectedItemObj.unit}
                          </span>
                        )}
                        {reservedForSelectedProject > 0 && (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-950 rounded font-bold border border-emerald-300">
                            🟢 رزرو پروژه انتخاب‌شده: {reservedForSelectedProject} {selectedItemObj.unit}
                          </span>
                        )}
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-950 rounded font-bold border border-amber-300">
                          حداکثر مجاز خروج: {maxAllowedForExit} {selectedItemObj.unit}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* V9 Phase 5.2: جدول اقلام سند استخراج‌شده */}
          <DocItemsTable
            docItems={docItems}
            actionType={actionType}
            currencyLabel={currency}
            totalSum={totalSum}
            getItemReservationSummary={getItemReservationSummary}
            onUpdateItemQty={handleUpdateItemQty}
            onUpdateItemPrice={handleUpdateItemPrice}
            onRemove={handleRemove}
          />


          {/* Submit Action Button */}
          <div className="border-t border-slate-200 pt-5 flex items-center justify-between">
            <div className="text-xs text-slate-500 flex items-center gap-3">
              <span>تعداد اقلام سند: <strong className="text-slate-900 font-mono font-bold">{docItems.length}</strong> ردیف</span>
              <span>مجموع تعداد: <strong className="text-slate-900 font-mono font-bold">{totalQuantitySum}</strong> واحد</span>
            </div>
            <button 
              type="submit" 
              disabled={docItems.length === 0 || currentUser.role === 'viewer' || isSaving} 
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>در حال ثبت سند...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  <span>
                    {actionType === 'in' ? 'ثبت نهایی و صدور سند رسید خرید' : 'ثبت نهایی و صدور حواله خروج'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
