import React, { useState, useEffect } from 'react';
import { Package, CheckCircle2, RefreshCw, Layers, AlertCircle, CheckSquare, Boxes } from 'lucide-react';
import { ProductionProject, ProjectProductItem } from '../../types';
import { fetchJson } from '../../api';
import { useWarehousesQuery } from '../../hooks/queries/useSettingsQueries';
import toast from 'react-hot-toast';

interface ProjectStockEntryTabProps {
  project: ProductionProject;
  onUpdate: () => void;
}

export default function ProjectStockEntryTab({ project, onUpdate }: ProjectStockEntryTabProps) {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [batchSubmitting, setBatchSubmitting] = useState<boolean>(false);
  const [markCompleted, setMarkCompleted] = useState<boolean>(false);
  const { data: warehouses = [] } = useWarehousesQuery();
  const [targetLocation, setTargetLocation] = useState<string>('');

  useEffect(() => {
    if (!targetLocation && warehouses.length > 0) {
      setTargetLocation(warehouses[0].code);
    }
  }, [warehouses, targetLocation]);

  // V3.1.0: fallback فقط با کالای واقعی پروژه — بدون محصول جعلی
  const products: ProjectProductItem[] = Array.isArray(project.products) && project.products.length > 0
    ? project.products
    : project.item_id ? [{
        id: 'prod-main',
        item_id: project.item_id,
        item_code: project.item_code || '',
        item_name: project.item_name || '',
        customer_code: '',
        quantity: project.quantity || 100,
        unit: project.unit || 'عدد',
        needs_assembly: true
      }] : [];

  const [producedQuantities, setProducedQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    products.forEach(p => {
      init[p.id] = p.quantity || 100;
    });
    return init;
  });

  const handleQtyChange = (prodId: string, val: number) => {
    setProducedQuantities(prev => ({ ...prev, [prodId]: val }));
  };

  // Single Item Delivery
  const handleAddToInventory = async (product: ProjectProductItem) => {
    const itemId = product.item_id || project.item_id;
    if (!itemId) {
      toast.error('کد کالا برای این محصول در انبار مشخص نشده است');
      return;
    }

    const qty = producedQuantities[product.id] || product.quantity || 1;
    if (qty <= 0) {
      toast.error('مقدار تولید باید بزرگتر از صفر باشد');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetchJson(`/projects/${project.id}/add-to-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsToAdd: [
            {
              itemId: Number(itemId),
              quantity: Number(qty),
              location: targetLocation,
              notes: `ورود مستقیم از پروژه کنترل تولید ${project.project_code || project.id} - محصول ${product.item_name}`
            }
          ],
          markCompleted
        })
      });

      if (res && (res.success || res.addedCount !== undefined || res.message)) {
        toast.success(`تعداد ${qty} ${product.unit} ${product.item_name} با موفقیت به انبار افزوده شد`);
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ثبت ورود به انبار');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
    } finally {
      setSubmitting(false);
    }
  };

  // Batch Item Delivery (All Valid Products in Project)
  const handleBatchAddToInventory = async () => {
    const validItems = products
      .map(p => {
        const itemId = p.item_id || project.item_id;
        const qty = producedQuantities[p.id] || p.quantity || 1;
        return {
          itemId: Number(itemId),
          quantity: Number(qty),
          location: targetLocation,
          notes: `ورود دسته‌ای از پروژه کنترل تولید ${project.project_code || project.id} - محصول ${p.item_name}`,
          name: p.item_name,
          unit: p.unit
        };
      })
      .filter(entry => Boolean(entry.itemId) && !isNaN(entry.itemId) && entry.quantity > 0);

    if (validItems.length === 0) {
      toast.error('هیچ محصول دارای کد انبار و تعداد معتبر برای تحویل یافت نشد');
      return;
    }

    setBatchSubmitting(true);
    try {
      const res = await fetchJson(`/projects/${project.id}/add-to-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsToAdd: validItems.map(({ itemId, quantity, location, notes }) => ({
            itemId,
            quantity,
            location,
            notes
          })),
          markCompleted
        })
      });

      if (res && (res.success || res.addedCount !== undefined || res.message)) {
        toast.success(`تعداد ${res.addedCount || validItems.length} قلم محصول با موفقیت به انبار افزوده شدند`);
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ثبت دسته‌ای محصولات به انبار');
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در ارتباط با سرور');
    } finally {
      setBatchSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 text-xs animate-fadeIn">
      {/* Top Banner & Settings */}
      <div className="bg-amber-50/80 border border-amber-200/80 p-4 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shrink-0 shadow-sm">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-amber-950 text-sm">تحویل نهایی و ورود به موجودی انبار</h4>
            <p className="text-[11px] text-amber-800 mt-0.5">
              محصولات تولیدشده را پس از کنترل کیفیت به انبار انتخابی تحویل دهید تا در کاردکس و موجودی کل اعمال شوند.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="font-bold text-amber-900 text-xs">انبار مقصد:</label>
            {warehouses.length === 0 ? (
              <span className="text-xs text-rose-700 bg-rose-50 px-2.5 py-1 rounded-xl border border-rose-200">
                هیچ انباری تعریف نشده است (از تنظیمات تعریف کنید)
              </span>
            ) : (
              <select
                value={targetLocation}
                onChange={(e) => setTargetLocation(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-amber-300 bg-white font-bold text-amber-950 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.code}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            )}
          </div>

          <label className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-amber-200 cursor-pointer hover:bg-amber-50/50 transition-colors">
            <input
              type="checkbox"
              checked={markCompleted}
              onChange={(e) => setMarkCompleted(e.target.checked)}
              className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
            />
            <span className="font-bold text-slate-800 text-[11px]">
              تغییر وضعیت پروژه به تکمیل‌شده
            </span>
          </label>

          {products.length > 1 && (
            <button
              onClick={handleBatchAddToInventory}
              disabled={batchSubmitting || submitting}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50 shrink-0"
              title="تحویل تمامی محصولات این پروژه به انبار با یک کلیک"
            >
              {batchSubmitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Boxes className="w-4 h-4 text-amber-400" />
              )}
              <span>تحویل گروهی کلیه محصولات</span>
            </button>
          )}
        </div>
      </div>

      {/* Products List */}
      <div className="space-y-3">
        {products.map((p, idx) => (
          <div
            key={p.id || idx}
            className="bg-white p-4 rounded-3xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs hover:border-slate-300 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-slate-900 text-amber-400 font-bold flex items-center justify-center shrink-0">
                {idx + 1}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">{p.item_name}</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                  {p.item_code ? (
                    <span>
                      کد انبار: <strong className="font-mono text-slate-700">{p.item_code}</strong>
                    </span>
                  ) : (
                    <span className="text-rose-600 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> فاقد اتصال مستقیم به کالای انبار
                    </span>
                  )}
                  {p.customer_code && (
                    <span className="text-amber-800 font-bold">
                      | کد مشتری: <strong className="font-mono">{p.customer_code}</strong>
                    </span>
                  )}
                  <span>
                    | سفارش برنامه‌ریزی: <strong className="font-mono text-slate-700">{p.quantity} {p.unit}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-600 font-semibold">تعداد تحویلی:</span>
                <input
                  type="number"
                  min="1"
                  value={producedQuantities[p.id] ?? p.quantity}
                  onChange={(e) => handleQtyChange(p.id, Number(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded-xl text-center font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
                <span className="text-slate-500 font-semibold">{p.unit}</span>
              </div>

              <button
                onClick={() => handleAddToInventory(p)}
                disabled={submitting || batchSubmitting}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm hover:shadow disabled:opacity-50 shrink-0"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                ورود به انبار
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
