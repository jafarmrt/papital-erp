import { ShieldCheck, RotateCcw, ArrowLeftRight, ClipboardCheck, Layers, Boxes, type LucideIcon } from 'lucide-react';
import type { InventoryAuditTab } from '../../hooks/inventoryAudit/useInventoryAuditQueries';
import { useHasAnyPermission } from '../../contexts/AuthContext';
import { READ_PERMISSIONS } from '../../lib/recordReadPermissions';

/** سربرگ صفحه انبارگردانی: عنوان، دکمه‌های بازسازی موجودی و حواله انتقال، و زبانه‌ها */

const TABS: Array<{ id: InventoryAuditTab; label: string; icon: LucideIcon }> = [
  { id: 'integrity', label: 'بررسی سلامت و تطبیق موجودی', icon: ShieldCheck },
  { id: 'new_audit', label: 'شمارش و ثبت انبارگردانی', icon: ClipboardCheck },
  { id: 'reports', label: 'سوابق دوره‌ها', icon: Layers },
  { id: 'transfers', label: 'حواله‌های انتقال', icon: ArrowLeftRight },
  { id: 'bom_allocations', label: 'تخصیص مواد به پروژه‌ها', icon: Boxes },
];

interface InventoryAuditHeaderProps {
  activeTab: InventoryAuditTab;
  onTabChange: (tab: InventoryAuditTab) => void;
  discrepancyItems: number | undefined;
  onOpenRebuild: () => void;
  onOpenTransfer: () => void;
}

/** v9.0.391 (TD-760): زبانه تخصیص مواد فقط برای کسی که API آن (`GET /inventory/allocations`) را می‌خواند */
export const useCanSeeBomAllocations = () => useHasAnyPermission(READ_PERMISSIONS.bomAllocations);

export function InventoryAuditHeader({ activeTab, onTabChange, discrepancyItems, onOpenRebuild, onOpenTransfer }: InventoryAuditHeaderProps) {
  const canSeeAllocations = useCanSeeBomAllocations();
  const tabs = TABS.filter(tab => tab.id !== 'bom_allocations' || canSeeAllocations);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 text-blue-700 rounded-2xl">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              مدیریت انبارگردانی و انطباق موجودی
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              تطبیق موجودی، کاردکس لحظه‌ای، ثبت انبارگردانی دوره‌ای و انتقال بین انبارها
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpenRebuild}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
            title="محاسبه مجدد مانده کالاها از روی کاردکس اسناد"
          >
            <RotateCcw size={15} />
            <span>بازسازی موجودی از روی کاردکس</span>
          </button>

          <button
            onClick={onOpenTransfer}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
          >
            <ArrowLeftRight size={15} />
            <span>ثبت حواله انتقال انبار</span>
          </button>
        </div>
      </div>

      {/* Tab Buttons */}
      <div className="flex items-center gap-2 pt-3 overflow-x-auto text-xs font-semibold">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === id
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon size={16} />
            <span>{label}</span>
            {id === 'integrity' && (discrepancyItems ?? 0) > 0 && (
              <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {discrepancyItems}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
