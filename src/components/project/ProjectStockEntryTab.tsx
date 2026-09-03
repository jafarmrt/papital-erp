import React, { useState, useEffect } from 'react';
import { Package, CheckCircle2, ArrowRight, RefreshCw, Layers, AlertCircle } from 'lucide-react';
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
  const { data: warehouses = [] } = useWarehousesQuery();
  const [targetLocation, setTargetLocation] = useState<string>('');

  useEffect(() => {
    if (!targetLocation && warehouses.length > 0) {
      setTargetLocation(warehouses[0].code);
    }
  }, [warehouses, targetLocation]);

  const products: ProjectProductItem[] = Array.isArray(project.products) && project.products.length > 0
    ? project.products
    : [{
        id: 'prod-1',
        item_id: project.item_id || null,
        item_code: project.item_code || '',
        item_name: project.item_name || 'محصول اصلی',
        customer_code: '',
        quantity: project.quantity || 100,
        unit: project.unit || 'عدد',
        needs_assembly: true
      }];

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
          itemId,
          quantity: qty,
          location: targetLocation,
          description: `ورود مستقیم از پروژه کنترل تولید کد ${project.project_code || project.id} - محصول ${product.item_name}`
        })
      });

      if (res && res.success) {
        toast.success(`تعداد ${qty} ${product.unit} ${product.item_name} با موفقیت به انبار افزوده شد`);
        onUpdate();
      } else {
        toast.error(res?.error || 'خطا در ثبت ورود به انبار');
      }
    } catch (err) {
      toast.error(err.message || 'خطا در شبکه');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 text-xs animate-fadeIn">
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-amber-950 text-xs">تحویل نهایی و افزودن به موجودی انبار</h4>
            <p className="text-[11px] text-amber-800 mt-0.5">
              پس از تکمیل مراحل پخت و کنترل کیفیت، محصولات نهایی را مستقیماً به انبار تحویل دهید.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-semibold text-amber-900">محل انبار:</label>
          {warehouses.length === 0 ? (
            <span className="text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
              هیچ انباری تعریف نشده است (از تنظیمات تعریف کنید)
            </span>
          ) : (
            <select
              value={targetLocation}
              onChange={(e) => setTargetLocation(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-amber-300 bg-white font-bold text-amber-950 text-xs"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.code}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {products.map((p, idx) => (
          <div key={p.id || idx} className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center">
                {idx + 1}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">{p.item_name}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                  {p.item_code && <span>کد انبار: <strong className="font-mono text-slate-700">{p.item_code}</strong></span>}
                  {p.customer_code && <span className="text-amber-800 font-bold">| کد مشتری: <strong className="font-mono">{p.customer_code}</strong></span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-600 font-semibold">تعداد تحویلی:</span>
                <input
                  type="number"
                  min="1"
                  value={producedQuantities[p.id] || p.quantity}
                  onChange={(e) => handleQtyChange(p.id, Number(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded-xl text-center font-mono font-bold text-xs focus:ring-1 focus:ring-amber-500"
                />
                <span className="text-slate-500 font-semibold">{p.unit}</span>
              </div>

              <button
                onClick={() => handleAddToInventory(p)}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50 shrink-0"
              >
                {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                ثبت و ورود مستقیم به انبار
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
