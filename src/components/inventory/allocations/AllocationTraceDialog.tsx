import { FileText, Warehouse } from 'lucide-react';
import { formatPersianDate, formatPersianNumber, toPersianDigits } from '../../../utils';
import { warehouseLabel } from '../../../lib/inventory/warehouseLabel';
import { DialogLayer } from '../../common/DialogLayer';
import type { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import type { BomAllocationRow } from './useBomAllocations';

/** «شناسنامه ردگیری»: where an allocation's material came from and when it was consumed or released */
export function AllocationTraceDialog({ alloc, warehousesList, onClose }: { alloc: BomAllocationRow; warehousesList: WarehouseItem[]; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="شناسنامه ردگیری تخصیص مواد به پروژه" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <DialogLayer onClose={onClose} />
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col overflow-hidden"><div className="p-6 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-800 font-black">
            <FileText className="text-blue-600" size={20} />
            <span>شناسنامه ردگیری تخصیص مواد به پروژه</span>
          </div>
          <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">
            #{toPersianDigits(alloc.id)}
          </span>
        </div>

        <div className="space-y-3 text-xs">
          <div className="bg-blue-50 border border-blue-200 p-3.5 rounded-2xl space-y-2">
            <div className="flex justify-between items-center text-blue-900 font-bold">
              <span>پروژه مقصد:</span>
              <span className="font-mono">{alloc.projectCode}</span>
            </div>
            <div className="flex justify-between items-center text-blue-800">
              <span>ماده اولیه تخصیص‌یافته:</span>
              <span className="font-bold">{alloc.itemName} ({alloc.itemCode})</span>
            </div>
            <div className="flex justify-between items-center text-blue-800">
              <span>مقدار کسر شده:</span>
              <span className="font-bold font-mono">{formatPersianNumber(alloc.quantity)} {alloc.unit}</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-2xl space-y-2">
            <div className="text-slate-700 font-bold flex items-center gap-1.5">
              <Warehouse size={14} className="text-slate-500" />
              <span>ردگیری سند کاردکس مبداء:</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-600 pt-1">
              <div>
                <span className="text-slate-400">شناسه تراکنش: </span>
                <span className="font-mono font-bold text-slate-800">
                  {alloc.sourceTransactionId ? toPersianDigits(alloc.sourceTransactionId) : '-'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">انبار مبداء: </span>
                <span className="font-bold text-slate-800">{warehouseLabel(alloc.sourceLocation, warehousesList)}</span>
              </div>
              <div>
                <span className="text-slate-400">تاریخ تخصیص: </span>
                <span className="font-mono text-slate-800">
                  {alloc.allocatedAt ? formatPersianDate(alloc.allocatedAt) : '-'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">تخصیص‌دهنده: </span>
                <span className="font-bold text-slate-800">{alloc.username || 'سامانه'}</span>
              </div>
            </div>
          </div>

          {alloc.consumedAt && (
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-emerald-800 flex items-center justify-between">
              <span className="font-bold">زمان مصرف در خط تولید:</span>
              <span className="font-mono">{formatPersianDate(alloc.consumedAt)}</span>
            </div>
          )}

          {alloc.releasedAt && (
            <div className="bg-slate-100 border border-slate-300 p-3 rounded-xl text-slate-700 flex items-center justify-between">
              <span className="font-bold">زمان آزادسازی و برگشت به انبار:</span>
              <span className="font-mono">{formatPersianDate(alloc.releasedAt)}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition-colors"
          >
            بستن پنجره
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
