import React, { useState, useEffect, useMemo } from 'react';
import { X, ShoppingBag, Plus, Trash2, CheckCircle2, Building2, FileText, AlertCircle, Loader2, ArrowDown, PackageCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PurchaseRequisition, PurchaseRequisitionItemRow, Item } from '../../types';
import { fetchJson } from '../../api';
import { formatPersianPrice, formatPersianNumber } from '../../utils';
import { SearchableSelect } from '../SearchableSelect';
import { useWarehousesQuery } from '../../hooks/queries/useSettingsQueries';
import { useSupplierSelectOptions } from '../../hooks/useEntitySelectors';

interface SplitOrderModalProps {
  isOpen: boolean;
  requisition: PurchaseRequisition;
  warehouseItems: Item[];
  onClose: () => void;
  onSuccess: () => void;
}

interface SplitPackageItem {
  reqItemId: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  initialAvailableQty: number; // initial remaining quantity at modal open
}

interface SplitPackage {
  id: string;
  packageNumber: number;
  supplierName: string;
  targetWarehouse: string;
  status: 'draft' | 'final';
  notes: string;
  items: SplitPackageItem[];
}

const CLOSURE_REASON_OPTIONS = [
  { value: 'complete', label: 'تطابق کامل خرید با درخواست متقاضی' },
  { value: 'over_fulfillment', label: 'خرید مازاد بر درخواست (حداقل تیراژ تامین‌کننده / ذخیره استراتژیک انبار)' },
  { value: 'under_market_shortage', label: 'خرید کمتر به دلیل نایابی کالا یا عدم موجودی در بازار' },
  { value: 'under_budget_limit', label: 'خرید کمتر به دلیل سقف بودجه مصوب / افزایش ناگهانی قیمت' },
  { value: 'under_applicant_revised', label: 'خرید کمتر با هماهنگی و تغییر نیاز متقاضی' },
  { value: 'other', label: 'سایر موارد و توضیحات تکمیلی تدارکات' },
];

export function SplitOrderModal({
  isOpen,
  requisition,
  warehouseItems,
  onClose,
  onSuccess
}: SplitOrderModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { options: supplierOptions } = useSupplierSelectOptions();

  // Dynamic warehouses query
  const { data: warehouses = [] } = useWarehousesQuery();
  const defaultWarehouseCode = warehouses[0]?.code || '';

  // Requisition closure options
  const [closeRequisition, setCloseRequisition] = useState(true);
  const [closureReasonType, setClosureReasonType] = useState('complete');
  const [closureNotes, setClosureNotes] = useState('');

  // Initial calculation of active items with remaining quantity
  const requisitionItems = useMemo(() => {
    return Array.isArray(requisition.items) ? requisition.items : [];
  }, [requisition.items]);

  // Initial remaining balance for each item when modal opens
  const initialRemainings = useMemo(() => {
    const map = new Map<string, number>();
    requisitionItems.forEach(it => {
      const rem = it.remainingQty !== undefined 
        ? Math.max(0, it.remainingQty) 
        : Math.max(0, (it.requestedQty || 0) - (it.orderedQty || 0));
      map.set(it.id, rem);
    });
    return map;
  }, [requisitionItems]);

  // Packages state (lower section) - Starts with Package #1
  const [packages, setPackages] = useState<SplitPackage[]>(() => {
    const activeItems = requisitionItems.filter(i => {
      const rem = i.remainingQty !== undefined 
        ? Math.max(0, i.remainingQty) 
        : Math.max(0, (i.requestedQty || 0) - (i.orderedQty || 0));
      return rem > 0;
    });

    return [
      {
        id: `pkg-1`,
        packageNumber: 1,
        supplierName: '',
        targetWarehouse: defaultWarehouseCode,
        status: 'draft',
        notes: `تفکیک سفارش خرید از درخواست ${requisition.code}`,
        items: activeItems.map(it => {
          const rem = it.remainingQty !== undefined 
            ? Math.max(0, it.remainingQty) 
            : Math.max(0, (it.requestedQty || 0) - (it.orderedQty || 0));
          return {
            reqItemId: it.id,
            itemId: it.itemId || 0,
            itemCode: it.itemCode || '',
            itemName: it.itemName,
            quantity: rem,
            unitPrice: it.unitPriceEstimate || 0,
            unit: it.unit || 'عدد',
            initialAvailableQty: rem
          };
        })
      }
    ];
  });

  // Keep targetWarehouse synced if warehouses loaded after initial render
  useEffect(() => {
    if (warehouses.length > 0) {
      setPackages(prev => prev.map(p => {
        if (!p.targetWarehouse) {
          return { ...p, targetWarehouse: warehouses[0].code };
        }
        return p;
      }));
    }
  }, [warehouses]);

  // Real-time calculation: total allocated across all packages for each requisition item
  const getAllocatedQty = (reqItemId: string) => {
    return packages.reduce((sum, pkg) => {
      const found = pkg.items.find(i => i.reqItemId === reqItemId);
      return sum + (found ? Number(found.quantity || 0) : 0);
    }, 0);
  };

  // Real-time calculation: live remaining for requisition item after deducting all package allocations
  const getLiveRemainingQty = (reqItemId: string) => {
    const initRem = initialRemainings.get(reqItemId) || 0;
    const allocated = getAllocatedQty(reqItemId);
    return initRem - allocated;
  };

  // Check if any items have over or under fulfillment across packages

  // Auto set recommended closure reason if discrepancy exists
  useEffect(() => {
    const hasOver = requisitionItems.some(it => getLiveRemainingQty(it.id) < 0);
    const hasUnder = requisitionItems.some(it => getLiveRemainingQty(it.id) > 0);

    if (hasOver && !hasUnder && closureReasonType === 'complete') {
      setClosureReasonType('over_fulfillment');
    } else if (hasUnder && !hasOver && closureReasonType === 'complete') {
      setClosureReasonType('under_market_shortage');
    }
  }, [packages, requisitionItems]);

  if (!isOpen) return null;

  // Add new split package (Package #2, #3, ...)
  const handleAddPackage = () => {
    setPackages(prev => {
      const nextNum = prev.length + 1;
      return [
        ...prev,
        {
          id: `pkg-${Date.now()}`,
          packageNumber: nextNum,
          supplierName: '',
          targetWarehouse: defaultWarehouseCode,
          status: 'draft',
          notes: `بسته سفارش خرید شماره ${formatPersianNumber(nextNum)} از درخواست ${requisition.code}`,
          items: []
        }
      ];
    });
  };

  // Remove package
  const handleRemovePackage = (pkgId: string) => {
    if (packages.length <= 1) {
      toast.error('حداقل یک بسته خرید تفکیکی باید وجود داشته باشد.');
      return;
    }
    setPackages(prev => {
      const filtered = prev.filter(p => p.id !== pkgId);
      // Renumber packages sequentially
      return filtered.map((p, idx) => ({ ...p, packageNumber: idx + 1 }));
    });
  };

  // Update package fields
  const handleUpdatePackageField = (pkgId: string, field: keyof SplitPackage, value: any) => {
    setPackages(prev => prev.map(p => p.id === pkgId ? { ...p, [field]: value } : p));
  };

  // Add item to package
  const handleAddItemToPackage = (pkgId: string, reqItem: PurchaseRequisitionItemRow) => {
    setPackages(prev => prev.map(p => {
      if (p.id !== pkgId) return p;
      if (p.items.some(i => i.reqItemId === reqItem.id)) return p;

      const liveRem = getLiveRemainingQty(reqItem.id);
      const initRem = initialRemainings.get(reqItem.id) || 0;
      const initialQty = liveRem > 0 ? liveRem : 1;

      return {
        ...p,
        items: [
          ...p.items,
          {
            reqItemId: reqItem.id,
            itemId: reqItem.itemId || 0,
            itemCode: reqItem.itemCode || '',
            itemName: reqItem.itemName,
            quantity: initialQty,
            unitPrice: reqItem.unitPriceEstimate || 0,
            unit: reqItem.unit || 'عدد',
            initialAvailableQty: initRem
          }
        ]
      };
    }));
  };

  // Quick fill remaining items into this package
  const handleFillRemainingItems = (pkgId: string) => {
    setPackages(prev => prev.map(p => {
      if (p.id !== pkgId) return p;
      const newItems = [...p.items];

      requisitionItems.forEach(reqItem => {
        const liveRem = getLiveRemainingQty(reqItem.id);
        const existing = newItems.find(i => i.reqItemId === reqItem.id);
        if (!existing && liveRem > 0) {
          newItems.push({
            reqItemId: reqItem.id,
            itemId: reqItem.itemId || 0,
            itemCode: reqItem.itemCode || '',
            itemName: reqItem.itemName,
            quantity: liveRem,
            unitPrice: reqItem.unitPriceEstimate || 0,
            unit: reqItem.unit || 'عدد',
            initialAvailableQty: initialRemainings.get(reqItem.id) || 0
          });
        }
      });

      return { ...p, items: newItems };
    }));
  };

  // Remove item from package
  const handleRemoveItemFromPackage = (pkgId: string, reqItemId: string) => {
    setPackages(prev => prev.map(p => {
      if (p.id !== pkgId) return p;
      return {
        ...p,
        items: p.items.filter(i => i.reqItemId !== reqItemId)
      };
    }));
  };

  // Update quantity or price for an item in package
  const handleUpdateItemField = (
    pkgId: string, 
    reqItemId: string, 
    field: 'quantity' | 'unitPrice', 
    val: number
  ) => {
    setPackages(prev => prev.map(p => {
      if (p.id !== pkgId) return p;
      return {
        ...p,
        items: p.items.map(i => {
          if (i.reqItemId !== reqItemId) return i;
          return { ...i, [field]: val };
        })
      };
    }));
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (packages.length === 0) {
      toast.error('هیچ بسته خریدی تعریف نشده است.');
      return;
    }

    for (let i = 0; i < packages.length; i++) {
      const p = packages[i];
      if (!p.supplierName || p.supplierName.trim() === '') {
        toast.error(`نام تامین‌کننده برای بسته خرید شماره ${p.packageNumber} الزامی است.`);
        return;
      }
      if (p.items.length === 0) {
        toast.error(`بسته خرید شماره ${p.packageNumber} (${p.supplierName}) فاقد هرگونه قلم کالا است.`);
        return;
      }
      for (const item of p.items) {
        if (!item.itemId) {
          toast.error(`کالای «${item.itemName}» شناسه انبار ندارد. لطفاً ابتدا کالا را در سیستم ثبت کنید.`);
          return;
        }
        if (item.quantity <= 0) {
          toast.error(`مقدار سفارش برای کالای «${item.itemName}» در بسته شماره ${p.packageNumber} باید بیشتر از صفر باشد.`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      const orderGroups = packages.map(p => ({
        supplierName: p.supplierName.trim(),
        targetWarehouse: p.targetWarehouse || defaultWarehouseCode,
        docType: 'receipt' as const,
        status: 'draft' as const,
        notes: p.notes.trim(),
        items: p.items.map(i => ({
          itemId: i.itemId,
          itemCode: i.itemCode,
          itemName: i.itemName,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice || 0),
          unit: i.unit
        }))
      }));

      const selectedReasonObj = CLOSURE_REASON_OPTIONS.find(o => o.value === closureReasonType);
      const reasonLabel = selectedReasonObj ? selectedReasonObj.label : closureReasonType;
      const finalClosureReason = closeRequisition
        ? `${reasonLabel}${closureNotes.trim() ? ` - توضیحات: ${closureNotes.trim()}` : ''}`
        : undefined;

      const res = await fetchJson<{ success: boolean; message?: string }>(
        `/api/procurement/requisitions/${requisition.id}/convert-to-orders`, 
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            orderGroups,
            closeRequisition,
            closureReason: finalClosureReason
          })
        }
      );

      toast.success(res.message || 'اسناد سفارش خرید تفکیکی با موفقیت صادر شدند.');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'خطا در صدور سفارش‌های خرید');
    } finally {
      setIsSubmitting(false);
    }
  };

  const grandTotal = packages.reduce((sum, p) => 
    sum + p.items.reduce((itemSum, i) => itemSum + (i.quantity * i.unitPrice), 0), 0
  );

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-fadeIn">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                تفکیک و صدور سفارش‌های خرید
                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-lg text-xs font-mono font-bold">
                  {requisition.code}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تخصیص اقلام به تامین‌کنندگان، ثبت مقادیر واقعی خرید و صدور فاکتورهای رسمی جهت ورود به انبار
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* TOP SECTION: جدول اقلام و وضعیت درخواست خرید مرجع */}
          <div className="bg-slate-50/80 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                <span className="font-bold text-slate-900 text-sm">
                  جدول اقلام و وضعیت درخواست خرید مرجع
                </span>
                <span className="text-[11px] text-slate-500">
                  (محاسبه خودکار تطابق، کسری یا مازاد خرید بر اساس مقادیر ورودی بسته‌ها)
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600">
                <span>عنوان: <b className="text-slate-800">{requisition.title}</b></span>
                {requisition.projectName && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-900 rounded-md font-bold text-[11px]">
                    پروژه: {requisition.projectName}
                  </span>
                )}
                <span>تاریخ نیاز: <b className="font-mono">{requisition.requiredDate || '---'}</b></span>
              </div>
            </div>

            {/* Reference Items Table with Live Deduction & Discrepancy Status */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-100/90 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-12">ردیف</th>
                    <th className="p-2.5">کد و نام کالا</th>
                    <th className="p-2.5 text-center w-16">واحد</th>
                    <th className="p-2.5 text-center w-24">مقدار درخواستی</th>
                    <th className="p-2.5 text-center w-24">سفارش قبلی</th>
                    <th className="p-2.5 text-center w-28 bg-amber-50/60 text-amber-900">
                      مجموع خرید این فاکتورها
                    </th>
                    <th className="p-2.5 text-center w-32 bg-slate-50">
                      مانده از درخواست
                    </th>
                    <th className="p-2.5 text-center w-36">وضعیت تطابق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requisitionItems.map((item, idx) => {
                    const allocated = getAllocatedQty(item.id);
                    const liveRem = getLiveRemainingQty(item.id);

                    let statusBadge = null;
                    if (liveRem === 0) {
                      statusBadge = (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded-md font-bold text-[11px] flex items-center justify-center gap-1">
                          <PackageCheck className="w-3 h-3" />
                          تطابق کامل
                        </span>
                      );
                    } else if (liveRem > 0) {
                      statusBadge = (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-900 rounded-md font-bold text-[11px]">
                          کسری: {formatPersianNumber(liveRem)} {item.unit}
                        </span>
                      );
                    } else {
                      statusBadge = (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-md font-bold text-[11px] flex items-center justify-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-600" />
                          مازاد: +{formatPersianNumber(Math.abs(liveRem))} {item.unit}
                        </span>
                      );
                    }

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                        <td className="p-2.5">
                          <span className="font-bold text-slate-900 block">{item.itemName}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{item.itemCode || 'فاقد کد'}</span>
                        </td>
                        <td className="p-2.5 text-center font-bold text-slate-600">{item.unit || 'عدد'}</td>
                        <td className="p-2.5 text-center font-mono font-bold text-slate-800">
                          {formatPersianNumber(item.requestedQty)}
                        </td>
                        <td className="p-2.5 text-center font-mono text-slate-500">
                          {formatPersianNumber(item.orderedQty || 0)}
                        </td>
                        <td className="p-2.5 text-center font-mono font-black text-amber-800 bg-amber-50/40">
                          {formatPersianNumber(allocated)}
                        </td>
                        <td className={`p-2.5 text-center font-mono font-black ${
                          liveRem === 0 ? 'text-emerald-700 bg-emerald-50/30' : 
                          liveRem > 0 ? 'text-blue-700 bg-blue-50/20' : 
                          'text-amber-700 bg-amber-50/30'
                        }`}>
                          {formatPersianNumber(liveRem)}
                        </td>
                        <td className="p-2.5 text-center">
                          {statusBadge}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
              <ArrowDown className="w-3.5 h-3.5 text-amber-600" />
              <span>
                شما می‌توانید بر اساس فاکتورهای واقعی بازار، مقادیری کمتر، برابر یا بیشتر از درخواست اولیه ثبت کنید.
              </span>
            </div>
          </div>

          {/* BOTTOM SECTION: بسته‌های خرید تفکیکی بر اساس تامین‌کننده */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-600" />
                <span className="font-bold text-slate-900 text-sm">
                  بسته‌های خرید تفکیکی بر اساس تامین‌کننده ({formatPersianNumber(packages.length)} فاکتور)
                </span>
              </div>
              <button
                type="button"
                onClick={handleAddPackage}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                افزودن تامین‌کننده مجزا
              </button>
            </div>

            {/* List of Split Packages */}
            {packages.map((pkg) => {
              const packageTotal = pkg.items.reduce((sum, it) => sum + (it.quantity * it.unitPrice), 0);

              return (
                <div 
                  key={pkg.id} 
                  className="bg-white border-2 border-slate-200 hover:border-amber-400 rounded-2xl shadow-xs overflow-hidden transition-all"
                >
                  {/* Package Card Header */}
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-mono font-black text-xs">
                        {formatPersianNumber(pkg.packageNumber)}
                      </div>
                      <span className="font-bold text-slate-800 text-sm">
                        بسته خرید شماره {formatPersianNumber(pkg.packageNumber)}
                      </span>
                      {pkg.supplierName && (
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded font-bold text-xs">
                          {pkg.supplierName}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">
                        مجموع بسته: <span className="font-mono text-amber-700 font-black text-sm">{formatPersianPrice(packageTotal)}</span>
                      </span>

                      {packages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePackage(pkg.id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="حذف این بسته خرید"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Package Metadata Form */}
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white border-b border-slate-100 text-xs">
                    {/* Supplier Name with SearchableSelect */}
                    <div className="lg:col-span-2">
                      <label className="block font-bold text-slate-700 mb-1">
                        نام تامین‌کننده / فروشنده <span className="text-rose-500">*</span>:
                      </label>
                      <SearchableSelect
                        value={pkg.supplierName}
                        onChange={(val) => handleUpdatePackageField(pkg.id, 'supplierName', val)}
                        placeholder="-- جستجو یا انتخاب از طرفین حساب --"
                        options={supplierOptions}
                        className="w-full"
                      />
                    </div>

                    {/* Document Stage Indicator (Replaced confusing draft/final) */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">نوع و مرحله سند:</label>
                      <div className="p-2 bg-amber-50/80 border border-amber-200 rounded-lg flex items-center justify-between">
                        <span className="font-bold text-amber-900 text-xs flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-amber-600" />
                          فاکتور خرید تامین‌کننده
                        </span>
                        <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-bold">
                          سفارش رسمی خرید
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        پس از تحویل اقلام، توسط انباردار تایید و قطعی می‌گردد.
                      </p>
                    </div>

                    {/* Target Warehouse (Dynamic select) */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">انبار مقصد ورود کالا:</label>
                      <select
                        value={pkg.targetWarehouse}
                        onChange={e => handleUpdatePackageField(pkg.id, 'targetWarehouse', e.target.value)}
                        className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold focus:bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
                      >
                        {warehouses.length > 0 ? (
                          warehouses.map(w => (
                            <option key={w.code} value={w.code}>
                              {w.name} ({w.code})
                            </option>
                          ))
                        ) : (
                          <option value="انبار اصلی">انبار اصلی</option>
                        )}
                      </select>
                    </div>

                    {/* Notes */}
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block font-bold text-slate-700 mb-1">یادداشت و شرایط تحویل تامین‌کننده:</label>
                      <input
                        type="text"
                        value={pkg.notes}
                        onChange={e => handleUpdatePackageField(pkg.id, 'notes', e.target.value)}
                        placeholder="مثال: توافق با تامین‌کننده جهت تحویل ظرف ۴۸ ساعت همراه با فاکتور رسمی"
                        className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Items for this package */}
                  <div className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-700">اقلام تخصیص‌یافته به این بسته خرید:</span>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Quick Action: Fill remaining items */}
                        <button
                          type="button"
                          onClick={() => handleFillRemainingItems(pkg.id)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-[11px] transition-colors cursor-pointer"
                        >
                          تخصیص اقلام دارای مانده به این بسته
                        </button>

                        {/* Dropdown to add single item */}
                        <select
                          onChange={e => {
                            const found = requisitionItems.find(it => it.id === e.target.value);
                            if (found) handleAddItemToPackage(pkg.id, found);
                            e.target.value = '';
                          }}
                          defaultValue=""
                          className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs focus:outline-none cursor-pointer"
                        >
                          <option value="" disabled>افزودن قلم کالا از درخواست...</option>
                          {requisitionItems.map(it => {
                            const isAlreadyInGroup = pkg.items.some(i => i.reqItemId === it.id);
                            return (
                              <option 
                                key={it.id} 
                                value={it.id}
                                disabled={isAlreadyInGroup}
                              >
                                {it.itemName} ({formatPersianNumber(it.requestedQty)} {it.unit || 'عدد'})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>

                    {/* Table of items in this package */}
                    {pkg.items.length === 0 ? (
                      <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                        هیچ قلم کالایی به این بسته تخصیص نیافته است. از دکمه‌ها یا منوی بالا اقلام را اضافه کنید.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-xs text-right">
                          <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                            <tr>
                              <th className="p-2 text-center w-10">ردیف</th>
                              <th className="p-2">نام کالا</th>
                              <th className="p-2 text-center w-16">واحد</th>
                              <th className="p-2 text-center w-28">مقدار خرید واقعی</th>
                              <th className="p-2 text-center w-32">قیمت واحد خرید (ریال)</th>
                              <th className="p-2 text-center w-36">مبلغ کل قلم (ریال)</th>
                              <th className="p-2 text-center w-12">عملیات</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {pkg.items.map((it, itIdx) => (
                              <tr key={it.reqItemId} className="hover:bg-slate-50">
                                <td className="p-2 text-center font-mono text-slate-400">{itIdx + 1}</td>
                                <td className="p-2">
                                  <span className="font-bold text-slate-900 block">{it.itemName}</span>
                                  <span className="text-[11px] text-slate-400 font-mono">{it.itemCode}</span>
                                </td>
                                <td className="p-2 text-center font-bold text-slate-600">{it.unit}</td>
                                <td className="p-2 text-center">
                                  <input
                                    type="number"
                                    min="0.01"
                                    step="any"
                                    value={it.quantity === 0 ? '' : it.quantity}
                                    onChange={e => handleUpdateItemField(pkg.id, it.reqItemId, 'quantity', parseFloat(e.target.value) || 0)}
                                    className="w-24 p-1 text-center font-mono font-bold bg-white border border-slate-300 rounded focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={it.unitPrice === 0 ? '' : it.unitPrice}
                                    onChange={e => handleUpdateItemField(pkg.id, it.reqItemId, 'unitPrice', parseFloat(e.target.value) || 0)}
                                    className="w-28 p-1 text-center font-mono font-bold bg-white border border-slate-300 rounded focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                  />
                                </td>
                                <td className="p-2 text-center font-mono font-black text-amber-800">
                                  {formatPersianPrice(it.quantity * it.unitPrice)}
                                </td>
                                <td className="p-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItemFromPackage(pkg.id, it.reqItemId)}
                                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                    title="حذف از این بسته"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* REQUISITION CLOSURE & DISCREPANCY REASON CARD */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800 text-xs">
                <input
                  type="checkbox"
                  checked={closeRequisition}
                  onChange={e => setCloseRequisition(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <span>تکمیل و بستن پرونده درخواست خرید با ثبت این سفارش‌ها (خرید قطعی و نهایی)</span>
              </label>

              {closeRequisition ? (
                <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  پرونده پس از ثبت بسته شده و به وضعیت آماده ورود به انبار منتقل می‌شود
                </span>
              ) : (
                <span className="text-[11px] bg-amber-100 text-amber-800 font-bold px-2.5 py-0.5 rounded-full">
                  پرونده باز می‌ماند (امکان خرید مجدد اقلام باقی‌مانده)
                </span>
              )}
            </div>

            {closeRequisition && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-200 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    علت یا وضعیت نهایی پرونده:
                  </label>
                  <select
                    value={closureReasonType}
                    onChange={e => setClosureReasonType(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                  >
                    {CLOSURE_REASON_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    توضیحات تکمیلی مغایرت و تصمیم تدارکات:
                  </label>
                  <input
                    type="text"
                    value={closureNotes}
                    onChange={e => setClosureNotes(e.target.value)}
                    placeholder="مثال: خرید ۳ واحد بیشتر به دلیل پک ۵ تایی تامین‌کننده..."
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Total Overall Summary */}
          <div className="flex flex-wrap items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-amber-950">تعداد فاکتورهای تفکیکی صادرشونده:</span>
              <span className="px-2.5 py-0.5 bg-amber-200 text-amber-950 font-black rounded-lg font-mono">
                {formatPersianNumber(packages.length)} سند خرید
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-950">مجموع کل مبلغ خرید تدارکات:</span>
              <span className="text-base font-black font-mono text-slate-900">
                {formatPersianPrice(grandTotal)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs transition-colors cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال صدور اسناد خرید...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  ثبت و صدور سفارش‌های خرید تفکیکی
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
