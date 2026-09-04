import React, { useState, useMemo } from 'react';
import { 
  ShoppingCart, FileText, CheckCircle2, AlertCircle, X, Loader2, ArrowLeft, Building2, Store, Check
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ProductionProject, PurchaseListItem, Item } from '../../types';
import { fetchJson } from '../../api';
import { formatPersianPrice } from '../../utils';

interface CreatePurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProductionProject;
  purchaseList: PurchaseListItem[];
  warehouseItems: Item[];
  onOrderCreated: (createdDoc: any, orderedItemIds: string[]) => void;
}

interface OrderItemRow {
  id: string; // PurchaseListItem id
  itemCode?: string;
  itemName: string;
  matchedItemId: number | null;
  matchedItemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  isSelected: boolean;
}

export function CreatePurchaseOrderModal({
  isOpen,
  onClose,
  project,
  purchaseList,
  warehouseItems,
  onOrderCreated
}: CreatePurchaseOrderModalProps) {
  const [docStatus, setDocStatus] = useState<'draft' | 'proforma' | 'final'>('draft');
  const [supplierName, setSupplierName] = useState('');
  const [targetWarehouse, setTargetWarehouse] = useState('انبار اصلی');
  const [notes, setNotes] = useState(
    `سفارش خرید کسری‌های مواد اولیه پروژه ${project.project_code || project.title}`
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter items that actually have shortfalls
  const initialRows = useMemo(() => {
    const shortfalls = purchaseList.filter(i => 
      (i.convertedToPurchaseQty !== undefined && i.convertedToPurchaseQty > 0) || 
      (i.toPurchaseQty !== undefined && i.toPurchaseQty > 0)
    );

    return shortfalls.map((item): OrderItemRow => {
      // Find matching item in warehouseItems
      const matched = warehouseItems.find(w => 
        (item.itemCode && w.code === item.itemCode) ||
        (w.name && w.name.trim().toLowerCase() === item.itemName.trim().toLowerCase())
      );

      const qty = item.convertedToPurchaseQty !== undefined && item.convertedToPurchaseQty > 0
        ? item.convertedToPurchaseQty
        : (item.toPurchaseQty || 0);

      const unit = (item.convertedToPurchaseQty !== undefined && item.convertedToPurchaseQty > 0)
        ? (item.convertedUnit || item.unit)
        : item.unit;

      const price = (matched as any)?.purchase_price || (matched as any)?.unit_price || matched?.weightedAverageCost || matched?.weighted_average_cost || 0;

      return {
        id: item.id,
        itemCode: item.itemCode || matched?.code || '',
        itemName: item.itemName,
        matchedItemId: matched ? matched.id : null,
        matchedItemName: matched ? matched.name : '',
        quantity: qty,
        unit,
        unitPrice: price,
        isSelected: !!matched // Auto-select if matched in warehouse catalog
      };
    });
  }, [purchaseList, warehouseItems]);

  const [orderRows, setOrderRows] = useState<OrderItemRow[]>(initialRows);

  // Sync state if initialRows changes
  React.useEffect(() => {
    setOrderRows(initialRows);
  }, [initialRows]);

  if (!isOpen) return null;

  const handleToggleSelect = (index: number) => {
    setOrderRows(prev => prev.map((r, i) => i === index ? { ...r, isSelected: !r.isSelected } : r));
  };

  const handleSelectAll = (select: boolean) => {
    setOrderRows(prev => prev.map(r => ({ ...r, isSelected: r.matchedItemId ? select : false })));
  };

  const handleUpdateRow = (index: number, field: keyof OrderItemRow, value: any) => {
    setOrderRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const handleAssignWarehouseItem = (index: number, itemId: number) => {
    const selectedItem = warehouseItems.find(w => w.id === itemId);
    if (!selectedItem) return;

    setOrderRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      return {
        ...r,
        matchedItemId: selectedItem.id,
        matchedItemName: selectedItem.name,
        itemCode: selectedItem.code,
        unitPrice: (selectedItem as any)?.purchase_price || (selectedItem as any)?.unit_price || selectedItem.weightedAverageCost || selectedItem.weighted_average_cost || r.unitPrice,
        isSelected: true
      };
    }));
  };

  const selectedRows = orderRows.filter(r => r.isSelected && r.matchedItemId);
  const totalEstimatedCost = selectedRows.reduce((sum, r) => sum + (r.quantity * r.unitPrice), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRows.length === 0) {
      toast.error('لطفاً حداقل یک قلم کالای دارای شناسه انبار را برای صدور سفارش انتخاب کنید.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        type: 'receipt', // سند ورود / فاکتور خرید
        status: docStatus, // 'draft' (پیش‌نویس سفارش), 'proforma' (پیش‌فاکتور خرید), 'final' (رسید قطعی)
        buyerName: supplierName.trim() || 'تامین‌کننده تدارکات',
        notes: notes.trim(),
        targetWarehouse: targetWarehouse || 'انبار اصلی',
        inOut: 'in',
        actionType: 'in',
        projectId: project.id,
        items: selectedRows.map(r => ({
          itemId: r.matchedItemId!,
          quantity: Number(r.quantity),
          unitPrice: Number(r.unitPrice || 0),
          discountAmount: 0,
          taxRate: 0,
          location: targetWarehouse || 'انبار اصلی',
          notes: `کسری پروژه ${project.project_code || project.title} - ${r.itemName}`
        }))
      };

      const res = await fetchJson<{ success: boolean; data?: any; message?: string }>('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const docData = res?.data || res;
      const refNumber = docData?.ref_number || docData?.refNumber || 'جدید';

      toast.success(
        `سند ${docStatus === 'draft' ? 'سفارش خرید' : docStatus === 'proforma' ? 'پیش‌فاکتور خرید' : 'رسید خرید'} به شماره ${refNumber} با موفقیت ثبت شد.`
      );

      const orderedIds = selectedRows.map(r => r.id);
      onOrderCreated(docData, orderedIds);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت سند سفارش خرید');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-fadeIn">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                صدور سفارش خرید کسری‌های پروژه
                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-lg text-xs font-mono font-bold">
                  {project.project_code || project.title}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تبدیل خودکار لیست کسری‌های تأمین قطعات به سند رسمی خرید در سیستم تدارکات و انبارداری
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

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Settings / Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">نوع وضعیت سند:</label>
              <select
                value={docStatus}
                onChange={e => setDocStatus(e.target.value as any)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none"
              >
                <option value="draft">پیش‌نویس سفارش خرید (تدارکات - بدون تغییر موجودی)</option>
                <option value="proforma">پیش‌فاکتور خرید (استعلام قیمت)</option>
                <option value="final">رسید خرید قطعی (افزایش آنی موجودی انبار)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">نام فروشنده / تأمین‌کننده:</label>
              <input
                type="text"
                placeholder="مثلاً: تأمین قطعات نوین / بازار آهن"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">انبار مقصد ورود کالا:</label>
              <input
                type="text"
                placeholder="انبار اصلی"
                value={targetWarehouse}
                onChange={e => setTargetWarehouse(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block font-bold text-slate-700 mb-1">یادداشت و توضیحات سند:</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Items Table Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-sm">اقلام قابل سفارش ({orderRows.length} مورد کسری)</span>
                <span className="text-xs text-slate-500">
                  ({selectedRows.length} قلم انتخاب شده)
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleSelectAll(true)}
                  className="px-2.5 py-1 text-blue-700 hover:bg-blue-50 rounded-md font-bold transition-colors cursor-pointer"
                >
                  انتخاب همه
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => handleSelectAll(false)}
                  className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 rounded-md font-bold transition-colors cursor-pointer"
                >
                  لغو انتخاب‌ها
                </button>
              </div>
            </div>

            {orderRows.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-500 text-xs">
                هیچ کالایی با مقدار کسری خرید در این پروژه یافت نشد.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-72 overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-800 text-white font-bold sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5 text-center w-12">انتخاب</th>
                      <th className="p-2.5">عنوان قلم نیازمندی</th>
                      <th className="p-2.5">تطبیق با کاتالوگ انبار</th>
                      <th className="p-2.5 text-center">مقدار کسری</th>
                      <th className="p-2.5 text-center">قیمت واحد تخمینی</th>
                      <th className="p-2.5 text-center">مبلغ کل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {orderRows.map((row, idx) => (
                      <tr 
                        key={row.id || idx} 
                        className={`hover:bg-slate-50/80 transition-colors ${row.isSelected ? 'bg-amber-50/40' : ''}`}
                      >
                        <td className="p-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={row.isSelected}
                            disabled={!row.matchedItemId}
                            onChange={() => handleToggleSelect(idx)}
                            className="w-4 h-4 text-amber-600 rounded-md border-slate-300 focus:ring-amber-500 cursor-pointer disabled:opacity-40"
                          />
                        </td>
                        <td className="p-2.5">
                          <div className="font-bold text-slate-900">{row.itemName}</div>
                          {row.itemCode && (
                            <div className="font-mono text-[10px] text-slate-500">کد: {row.itemCode}</div>
                          )}
                        </td>
                        <td className="p-2.5">
                          {row.matchedItemId ? (
                            <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate max-w-[180px]" title={row.matchedItemName}>
                                {row.matchedItemName}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              <select
                                className="p-1 border border-amber-300 rounded text-[11px] bg-amber-50 text-amber-950 font-bold focus:outline-none"
                                onChange={e => handleAssignWarehouseItem(idx, Number(e.target.value))}
                                defaultValue=""
                              >
                                <option value="" disabled>انتخاب کالای انبار...</option>
                                {warehouseItems.map(w => (
                                  <option key={w.id} value={w.id}>
                                    {w.name} ({w.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="0.1"
                              step="any"
                              value={row.quantity}
                              onChange={e => handleUpdateRow(idx, 'quantity', Number(e.target.value))}
                              className="w-20 p-1 border border-slate-300 rounded text-center font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            <span className="text-slate-600">{row.unit}</span>
                          </div>
                        </td>
                        <td className="p-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="0"
                              value={row.unitPrice}
                              onChange={e => handleUpdateRow(idx, 'unitPrice', Number(e.target.value))}
                              className="w-24 p-1 border border-slate-300 rounded text-center font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            <span className="text-[10px] text-slate-500">ریال</span>
                          </div>
                        </td>
                        <td className="p-2.5 text-center font-mono font-bold text-slate-900">
                          {formatPersianPrice(row.quantity * row.unitPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary Banner */}
          <div className="flex items-center justify-between p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-xs">
            <div className="flex items-center gap-2 text-amber-900">
              <span className="font-bold">مجموع اقلام انتخابی:</span>
              <span className="px-2 py-0.5 bg-amber-200 text-amber-950 font-bold rounded-md font-mono">
                {selectedRows.length} قلم
              </span>
            </div>
            <div className="flex items-center gap-2 text-amber-950">
              <span className="font-bold">برآورد کل مبلغ سفارش خرید:</span>
              <span className="text-sm font-black font-mono text-slate-900">
                {formatPersianPrice(totalEstimatedCost)}
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
              disabled={isSubmitting || selectedRows.length === 0}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال صدور سند خرید...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  صدور قطعی سفارش خرید در سیستم
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
