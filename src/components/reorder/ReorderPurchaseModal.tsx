import React, { useState, useEffect, useMemo } from 'react';
import { X, ShoppingCart, CheckCircle2, Loader2, Building2, FileText, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatPersianPrice, formatPersianNumber, getTodayIsoDate, errorMessageOf } from '../../utils';
import { FinancialAmountInput } from '../common/FinancialAmountInput';
import type { ReorderModalItem } from '../../lib/reorderAlerts/reorderItems';
import { useReorderSuppliersQuery } from '../../hooks/reorderAlerts/useReorderAlertsQueries';
import { useReorderPurchaseSubmit, type ReorderPurchaseVariables } from '../../hooks/reorderAlerts/useReorderAlertsMutations';
import { receiptNeedsDonatedConfirmation, reorderPurchaseReceiptPayload, reorderReceiptPriceError } from '../../lib/reorderAlerts/reorderPurchaseReceipt';
import { useWarehousesQuery } from '../../hooks/queries/useSettingsQueries';
import { ReorderOrderFields, type ReorderDocStatus as DocStatus, type ReorderPriority as Priority } from './ReorderOrderFields';

export type { ReorderModalItem } from '../../lib/reorderAlerts/reorderItems';

interface ReorderPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: ReorderModalItem[];
  onSuccess: () => void;
}

export function ReorderPurchaseModal({
  isOpen,
  onClose,
  selectedItems,
  onSuccess
}: ReorderPurchaseModalProps) {
  const [items, setItems] = useState<ReorderModalItem[]>([]);
  const [orderTarget, setOrderTarget] = useState<'requisition' | 'direct_document'>('requisition');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  // v9.0.384 (TD-830): ISO, shown with JalaliDateInput
  const [requiredDate, setRequiredDate] = useState(() => getTodayIsoDate());
  const [supplierName, setSupplierName] = useState('');
  const [docStatus, setDocStatus] = useState<DocStatus>('draft');
  // v9.0.384 (TD-830): '' = the first active warehouse, which is the default warehouse (lowest id)
  const [targetWarehouse, setTargetWarehouse] = useState('');
  const [donatedConfirmed, setDonatedConfirmed] = useState(false);
  const { data: warehouses = [] } = useWarehousesQuery();
  const warehouseCode = targetWarehouse || warehouses[0]?.code || '';
  const [notes, setNotes] = useState('');
  // ثبت با useMutation (ابطال کش تدارکات/اسناد/کالاها در خود hook)؛ دکمه ثبت تا پایان درخواست غیرفعال است
  const purchaseSubmit = useReorderPurchaseSubmit();
  const isSubmitting = purchaseSubmit.isPending;

  // Load suppliers list (React Query؛ فقط با باز بودن مودال، با بسته شدن صفحه لغو می‌شود)
  const suppliers = useReorderSuppliersQuery(isOpen);

  // Sync items when modal opens or selection changes
  useEffect(() => {
    if (!isOpen) return;
    setItems(selectedItems.map(it => ({
      ...it,
      orderQty: it.orderQty > 0 ? it.orderQty : Math.max(1, it.deficit || 1),
      unitPrice: it.unitPrice > 0 ? it.unitPrice : (it.weighted_average_cost || 0)
    })));

    const count = selectedItems.length;
    setTitle(count === 1 
      ? `سفارش تامین ماده اولیه ${selectedItems[0].name}`
      : `سفارش خرید کسری مواد اولیه انبار (${formatPersianNumber(count)} قلم)`
    );
    setNotes(`تامین کسری نقطه سفارش مواد اولیه از طریق میز کار هشدار انبار`);
    setDonatedConfirmed(false);
  }, [isOpen, selectedItems]);

  const supplierOptions = useMemo(() => {
    return suppliers.map(s => ({
      value: s.name,
      label: `${s.partyType === 'supplier' ? '🏭 تامین‌کننده' : s.partyType === 'customer' ? '👤 مشتری' : '🤝 طرف‌حساب'}: ${s.name} ${s.supplierCategory ? `(${s.supplierCategory})` : ''} ${s.phone ? `- ${s.phone}` : ''}`,
      _raw: s
    }));
  }, [suppliers]);

  if (!isOpen) return null;

  const handleUpdateItemField = (id: number, field: 'orderQty' | 'unitPrice', value: number) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it));
  };

  const handleRemoveItem = (id: number) => {
    if (items.length <= 1) {
      toast.error('حداقل یک قلم کالا در سفارش خرید الزامی است.');
      return;
    }
    setItems(prev => prev.filter(it => it.id !== id));
  };

  const grandTotal = items.reduce((s, it) => s + (it.orderQty * it.unitPrice), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (items.length === 0) {
      toast.error('هیچ کالایی برای ثبت سفارش انتخاب نشده است.');
      return;
    }

    for (const it of items) {
      if (it.orderQty <= 0) {
        toast.error(`مقدار سفارش برای «${it.name}» باید بیشتر از صفر باشد.`);
        return;
      }
    }

    let variables: ReorderPurchaseVariables;
    if (orderTarget === 'requisition') {
      // Submit Purchase Requisition to Procurement Workflow
      variables = {
        target: 'requisition',
        payload: {
          title: title.trim(),
          priority,
          requiredDate,
          notes: notes.trim(),
          items: items.map(it => ({
            itemId: it.id,
            itemCode: it.code,
            itemName: it.name,
            unit: it.unit || 'عدد',
            requestedQty: Number(it.orderQty),
            unitPriceEstimate: Number(it.unitPrice || 0),
            notes: `کسری نقطه سفارش: موجودی آزاد ${it.current_stock} / حد آستانه ${it.reorder_point}`
          }))
        }
      };
    } else {
      // Direct Document (Purchase Order / Receipt)
      if (!supplierName || supplierName.trim() === '') {
        toast.error('انتخاب تامین‌کننده برای صدور مستقیم سند الزامی است.');
        return;
      }
      const priceError = reorderReceiptPriceError({ status: docStatus, donatedConfirmed, items });
      if (priceError) {
        toast.error(priceError);
        return;
      }
      // v8.0.110 (TD-387): بدنه مطابق POST /documents (شماره از سرور، تأمین‌کننده در buyer_name، فی در unit_price)
      variables = {
        target: 'direct_document',
        payload: reorderPurchaseReceiptPayload({
          status: docStatus,
          supplierName,
          warehouse: warehouseCode,
          date: requiredDate || getTodayIsoDate(),
          notes: notes.trim() || `تامین کسری نقطه سفارش انبار`,
          items,
        })
      };
    }

    purchaseSubmit.mutate(variables, {
      onSuccess: (res) => {
        if (variables.target === 'requisition') {
          toast.success(res.message || 'درخواست خرید با موفقیت در سیستم تدارکات ثبت شد.');
        } else {
          toast.success(variables.payload.status === 'final'
            ? 'رسید قطعی ورود کالا به انبار با موفقیت صادر و موجودی افزایش یافت.'
            : 'پیش‌نویس سفارش خرید با موفقیت در اسناد انبار ثبت گردید.'
          );
        }
        onSuccess();
        onClose();
      },
      onError: (err) => {
        toast.error(errorMessageOf(err) || 'خطا در ثبت سفارش خرید');
      },
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-farsi">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-fadeIn">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                ثبت سفارش خرید مواد اولیه
                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-lg text-xs font-bold font-mono">
                  {formatPersianNumber(items.length)} قلم
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تامین مواد اولیه در نقطه سفارش مجدد به صورت تکی یا دسته‌ای
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Destination Selector */}
          <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5 space-y-2">
            <label className="block text-xs font-black text-amber-950">
              مسیر ثبت سفارش:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOrderTarget('requisition')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  orderTarget === 'requisition'
                    ? 'bg-white border-amber-500 ring-2 ring-amber-400/30 shadow-xs'
                    : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText className={`w-4 h-4 ${orderTarget === 'requisition' ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold text-slate-900">ارسال به کارتابل تدارکات (درخواست خرید)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 mr-6">
                  ثبت رسمی در موتور گردش کار تدارکات جهت استعلام قیمت، تایید و تفکیک سفارشات
                </p>
              </button>

              <button
                type="button"
                onClick={() => setOrderTarget('direct_document')}
                className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                  orderTarget === 'direct_document'
                    ? 'bg-white border-amber-500 ring-2 ring-amber-400/30 shadow-xs'
                    : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className={`w-4 h-4 ${orderTarget === 'direct_document' ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold text-slate-900">صدور مستقیم سند انبار / خرید</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 mr-6">
                  ثبت مستقیم پیش‌نویس سفارش خرید یا رسید قطعی ورود به انبار به نام تامین‌کننده مشخص
                </p>
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <ReorderOrderFields
            orderTarget={orderTarget}
            title={title}
            onTitleChange={setTitle}
            priority={priority}
            onPriorityChange={setPriority}
            supplierName={supplierName}
            onSupplierChange={setSupplierName}
            supplierOptions={supplierOptions}
            docStatus={docStatus}
            onDocStatusChange={setDocStatus}
            warehouses={warehouses}
            warehouseCode={warehouseCode}
            onWarehouseChange={setTargetWarehouse}
            date={requiredDate}
            onDateChange={setRequiredDate}
            notes={notes}
            onNotesChange={setNotes}
            askDonated={receiptNeedsDonatedConfirmation(docStatus, items)}
            donatedConfirmed={donatedConfirmed}
            onDonatedChange={setDonatedConfirmed}
          />

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800">
                اقلام انتخابی جهت سفارش خرید ({formatPersianNumber(items.length)} قلم کالا):
              </span>
              <span className="text-slate-500">
                مقدار پیشنهادی به طور خودکار بر اساس کسری نقطه سفارش تنظیم گردیده است.
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-12">ردیف</th>
                    <th className="p-2.5">کد و نام کالا</th>
                    <th className="p-2.5 text-center w-20">موجودی آزاد</th>
                    <th className="p-2.5 text-center w-20">نقطه سفارش</th>
                    <th className="p-2.5 text-center w-20">میزان کسری</th>
                    <th className="p-2.5 text-center w-28">مقدار سفارش</th>
                    <th className="p-2.5 text-center w-16">واحد</th>
                    <th className="p-2.5 text-center w-32">قیمت تخمینی (ریال)</th>
                    <th className="p-2.5 text-center w-32">مبلغ کل</th>
                    <th className="p-2.5 text-center w-12">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it, idx) => (
                    <tr key={it.id} className="hover:bg-slate-50/60">
                      <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-2.5">
                        <span className="font-bold text-slate-900 block">{it.name}</span>
                        <span className="text-[11px] font-mono text-slate-500">{it.code}</span>
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-rose-600">
                        {formatPersianNumber(it.current_stock)}
                      </td>
                      <td className="p-2.5 text-center font-mono text-slate-600">
                        {formatPersianNumber(it.reorder_point)}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-amber-700 bg-amber-50/40">
                        {formatPersianNumber(it.deficit)}
                      </td>
                      <td className="p-2.5 text-center">
                        <input
                          type="number"
                          min={1}
                          value={it.orderQty}
                          onChange={e => handleUpdateItemField(it.id, 'orderQty', Number(e.target.value))}
                          className="w-20 p-1.5 bg-white border border-slate-300 rounded text-center font-mono font-bold text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none"
                        />
                      </td>
                      <td className="p-2.5 text-center font-bold text-slate-600">{it.unit || 'عدد'}</td>
                      <td className="p-2.5 text-center">
                        <FinancialAmountInput
                          value={it.unitPrice}
                          onChange={val => handleUpdateItemField(it.id, 'unitPrice', val)}
                          currency="IRR"
                          variant="table"
                          placeholder="0"
                          className="w-28 mx-auto"
                          containerClassName="w-full bg-white border border-slate-300 rounded focus-within:ring-2 focus-within:ring-amber-400"
                          inputClassName="p-1.5 text-center font-mono font-bold text-slate-800"
                        />
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-amber-700">
                        {formatPersianPrice(it.orderQty * it.unitPrice)}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(it.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                          title="حذف از لیست"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Grand Total Bar */}
          <div className="flex flex-wrap items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-amber-950">تعداد اقلام سفارش:</span>
              <span className="px-2.5 py-0.5 bg-amber-200 text-amber-950 font-black rounded-lg font-mono">
                {formatPersianNumber(items.length)} قلم
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-950">مجموع برآورد ارزش خرید:</span>
              <span className="text-base font-black font-mono text-slate-900">
                {formatPersianPrice(grandTotal)}
              </span>
            </div>
          </div>

          {/* Buttons */}
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
                  در حال ثبت سفارش...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {orderTarget === 'requisition' ? 'ثبت و ارسال درخواست خرید' : 'ثبت سند خرید انبار'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
