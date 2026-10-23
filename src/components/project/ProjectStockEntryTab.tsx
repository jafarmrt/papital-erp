import { useMemo, useState } from 'react';
import { CheckSquare, Square, Search } from 'lucide-react';
import type { ProductionProject, Item } from '../../types';
import { toPersianDigits } from '../../utils';
import { ProjectOverDeliveryPrompt } from './ProjectOverDeliveryPrompt';
import { useProjectDelivery } from './delivery/useProjectDelivery';
import { DeliveryHeader } from './delivery/DeliveryHeader';
import { DeliveryProductRow } from './delivery/DeliveryProductRow';

interface ProjectStockEntryTabProps {
  project: ProductionProject;
  itemsList?: Item[];
  onUpdate: () => void;
}

/**
 * «ورود به انبار» of a project: each product's quantity and unit cost go to the chosen warehouse as a production receipt,
 * one product or a batch, and the project may be set «تکمیل‌شده» with it once its progress matrix is complete.
 * 10.3 (ARCH review finding 3): the rules live in `./delivery/useProjectDelivery`; the progress matrix and the delivery
 * cost come from the shared cache, so a save elsewhere refreshes them while the tab is open.
 */
export default function ProjectStockEntryTab({ project, itemsList = [], onUpdate }: ProjectStockEntryTabProps) {
  const delivery = useProjectDelivery(project, onUpdate);
  const { products, selectedIds, setSelectedIds, overDelivery } = delivery;
  const [searchQuery, setSearchQuery] = useState('');

  // Map of itemId to catalog Item for looking up WAC and cost basis
  const catalogMap = useMemo(() => {
    const map = new Map<number, Item>();
    itemsList.forEach(item => {
      if (item.id) map.set(item.id, item);
    });
    return map;
  }, [itemsList]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.item_name && p.item_name.toLowerCase().includes(q)) ||
      (p.item_code && p.item_code.toLowerCase().includes(q)) ||
      (p.customer_code && p.customer_code.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  const toggleSelectAll = () => {
    const selectable = filteredProducts.filter(p => Boolean(p.item_id || project.item_id));
    if (selectedIds.size >= selectable.length && selectable.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map(p => p.id)));
    }
  };

  return (
    <div className="space-y-4 text-xs animate-fadeIn">
      {overDelivery && (
        <ProjectOverDeliveryPrompt
          items={overDelivery.items}
          reason={delivery.overDeliveryReason}
          onReasonChange={delivery.setOverDeliveryReason}
          onConfirm={() => void delivery.confirmOverDelivery()}
          onCancel={() => delivery.setOverDelivery(null)}
          submitting={delivery.submitting || delivery.costPending}
        />
      )}
      <DeliveryHeader delivery={delivery} />

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3 flex-1 min-w-[240px] max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جست‌وجو در محصولات (نام، کد انبار یا کد مشتری)..."
              className="w-full pl-3 pr-9 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-400 focus:bg-white focus:outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {selectedIds.size > 0 && selectedIds.size >= filteredProducts.length ? (
              <CheckSquare className="w-4 h-4 text-amber-600" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span>انتخاب همه ({toPersianDigits(filteredProducts.length)})</span>
          </button>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-slate-500 hover:text-slate-800 font-bold text-[11px] px-2 cursor-pointer"
            >
              لغو انتخاب ({toPersianDigits(selectedIds.size)})
            </button>
          )}
        </div>
      </div>

      {/* Products List */}
      <div className="space-y-2.5">
        {filteredProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400">
            هیچ محصولی با معیارهای جست‌وجوی فعلی یافت نشد.
          </div>
        ) : (
          filteredProducts.map((p, idx) => {
            const itemId = p.item_id || project.item_id;
            return (
              <DeliveryProductRow
                key={p.id || idx}
                product={p}
                index={idx}
                projectItemId={project.item_id}
                catalogItem={itemId ? catalogMap.get(Number(itemId)) : null}
                delivery={delivery}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
