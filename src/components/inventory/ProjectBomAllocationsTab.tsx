import { useState } from 'react';
import { Plus, Search, RefreshCw, Download } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { useProjectPermissions } from '../../hooks/useProjectPermissions';
import { useBomAllocations, type BomAllocationRow } from './allocations/useBomAllocations';
import { AllocationKpiCards } from './allocations/AllocationKpiCards';
import { AllocationTable } from './allocations/AllocationTable';
import { AllocationTraceDialog } from './allocations/AllocationTraceDialog';
import { AllocationReleaseDialog } from './allocations/AllocationReleaseDialog';
import { AllocateMaterialDialog } from './allocations/AllocateMaterialDialog';

interface ProjectBomAllocationsTabProps {
  user?: unknown;
}

/**
 * «تخصیص مواد به پروژه‌ها»: the material allocations of every project, a page at a time, with their counts, the
 * allocation form, consume and release, the trace of each and the Excel export.
 * 10.3 (ARCH review finding 3, part 11): the list and the pickers come from the shared cache (`./allocations/useBomAllocations`).
 */
export function ProjectBomAllocationsTab(_props: ProjectBomAllocationsTabProps) {
  // v9.0.417 (TD-752): تخصیص، مصرف و آزادسازی هر کدام با کلیدهای گارد API خودشان نشان داده می‌شوند
  const { canAllocate, canConsumeAllocation, canReleaseAllocation } = useProjectPermissions();
  const list = useBomAllocations();
  const { search, setSearch, statusFilter, setStatusFilter, statusCounts, loading, reload, exporting, exportExcel, warehousesList } = list;
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedAllocForTrace, setSelectedAllocForTrace] = useState<BomAllocationRow | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<BomAllocationRow | null>(null);
  const [releaseReason, setReleaseReason] = useState('تغییر در برنامه تولید یا لغو تخصیص');

  return (
    <div className="space-y-6">
      <AllocationKpiCards counts={statusCounts} />

      {/* Action & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative min-w-[240px]">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="جست‌وجو بر اساس کد پروژه، نام کالا یا کاربر..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              همه ({formatPersianNumber(statusCounts.all)})
            </button>
            <button
              onClick={() => setStatusFilter('allocated')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'allocated' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              در جریان ({formatPersianNumber(statusCounts.allocated)})
            </button>
            <button
              onClick={() => setStatusFilter('consumed')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'consumed' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              مصرف‌شده ({formatPersianNumber(statusCounts.consumed)})
            </button>
            <button
              onClick={() => setStatusFilter('released')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'released' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              آزادشده ({formatPersianNumber(statusCounts.released)})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void exportExcel()}
            disabled={exporting}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
          >
            <Download size={15} />
            <span>خروجی اکسل</span>
          </button>

          <button
            onClick={reload}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>تازه‌سازی</span>
          </button>

          {canAllocate && (
            <button
              onClick={() => setShowAllocateModal(true)}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
            >
              <Plus size={15} />
              <span>تخصیص مواد به پروژه</span>
            </button>
          )}
        </div>
      </div>

      <AllocationTable
        list={list}
        canConsumeAllocation={canConsumeAllocation}
        canReleaseAllocation={canReleaseAllocation}
        onTrace={setSelectedAllocForTrace}
        onRelease={setReleaseTarget}
      />

      {selectedAllocForTrace && (
        <AllocationTraceDialog alloc={selectedAllocForTrace} warehousesList={warehousesList} onClose={() => setSelectedAllocForTrace(null)} />
      )}

      {releaseTarget && (
        <AllocationReleaseDialog
          alloc={releaseTarget}
          warehousesList={warehousesList}
          reason={releaseReason}
          onReasonChange={setReleaseReason}
          release={list.release}
          onClose={() => setReleaseTarget(null)}
        />
      )}

      {showAllocateModal && <AllocateMaterialDialog list={list} onClose={() => setShowAllocateModal(false)} />}
    </div>
  );
}
