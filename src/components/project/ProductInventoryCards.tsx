import React from 'react';
import { Package, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { ProjectProductItem, ProjectInventoryControlSectionData } from '../../types';

interface ProductInventoryCardsProps {
  products: ProjectProductItem[];
  sections: ProjectInventoryControlSectionData[];
}

export function ProductInventoryCards({ products, sections }: ProductInventoryCardsProps) {
  if (!products || products.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 print:hidden">
      {products.map((prod, idx) => {
        // Calculate requirement issues for this product across sections
        let totalNeeds = 0;
        let needsProcurementCount = 0;

        sections.forEach(sec => {
          if (sec.checkType === 'per_item' && sec.perItemResults) {
            const prodRes = sec.perItemResults[prod.id] || {};
            const itemsSchema = sec.itemsSchema || [];
            itemsSchema.forEach(itemSchema => {
              totalNeeds++;
              const res = prodRes[itemSchema.id];
              if (res && res.status === 'needs_procurement') {
                needsProcurementCount++;
              }
            });
          }
        });

        const isFullyAvailable = totalNeeds > 0 && needsProcurementCount === 0;

        return (
          <div 
            key={prod.id || idx}
            className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-2xs hover:border-amber-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-900 border border-amber-200 flex items-center justify-center font-bold shrink-0">
                  <Package className="w-4 h-4 text-amber-700" />
                </div>
                <div className="min-w-0">
                  <h5 className="font-bold text-slate-900 text-xs truncate" title={prod.item_name || 'محصول سفارش'}>
                    {prod.item_name || 'محصول سفارش'}
                  </h5>
                  {prod.item_code && (
                    <span className="font-mono text-[10px] text-slate-500">کد: {prod.item_code}</span>
                  )}
                </div>
              </div>

              <span className="px-2 py-1 bg-slate-100 text-slate-800 font-mono font-bold rounded-lg text-[11px] shrink-0">
                {prod.quantity} {prod.unit || 'عدد'}
              </span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
              <span className="text-slate-500 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                نیاز به مونتاژ: {prod.needs_assembly ? 'بله' : 'خیر'}
              </span>

              {totalNeeds > 0 && (
                isFullyAvailable ? (
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-bold rounded-md border border-emerald-200 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    آماده تامین
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-900 font-bold rounded-md border border-amber-200 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    {needsProcurementCount} کالا نیازمند خرید
                  </span>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
