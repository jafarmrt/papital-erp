import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { RotateCcw } from 'lucide-react';
import { errorMessageOf, formatPersianNumber } from '../../../utils';
import { warehouseLabel } from '../../../lib/inventory/warehouseLabel';
import { DialogLayer } from '../../common/DialogLayer';
import type { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import type { BomAllocationRow } from './useBomAllocations';

interface AllocationReleaseDialogProps {
  alloc: BomAllocationRow;
  warehousesList: WarehouseItem[];
  /** the reason, kept by the tab between openings as before */
  reason: string;
  onReasonChange: (reason: string) => void;
  release: (alloc: BomAllocationRow, reason: string) => Promise<void>;
  onClose: () => void;
}

/** «آزادسازی»: the allocation's material goes back to its warehouse with a correcting receipt, for the reason given */
export function AllocationReleaseDialog({ alloc, warehousesList, reason, onReasonChange, release, onClose }: AllocationReleaseDialogProps) {
  const fieldId = useId();
  const [releasing, setReleasing] = useState(false);
  const confirmRelease = async () => {
    setReleasing(true);
    try {
      await release(alloc, reason);
      onClose();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در آزادسازی تخصیص');
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="تأیید آزادسازی و برگشت مواد به انبار" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <DialogLayer onClose={onClose} disabled={releasing} />
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center gap-2 text-rose-600 font-black border-b border-slate-100 pb-3">
          <RotateCcw size={20} />
          <span>تأیید آزادسازی و برگشت مواد به انبار</span>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          با این اقدام، مقدار <strong className="text-slate-900">{formatPersianNumber(alloc.quantity)} {alloc.unit}</strong> از کالای <strong className="text-slate-900">{alloc.itemName}</strong> به موجودی انبار <strong className="text-slate-900">{warehouseLabel(alloc.sourceLocation, warehousesList)}</strong> عودت داده شده و سند ورود اصلاحی در کاردکس ثبت خواهد شد.
        </p>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-release-reason`} className="text-xs font-bold text-slate-700">دلیل آزادسازی:</label>
          <textarea
            id={`${fieldId}-release-reason`}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
            className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500"
            placeholder="توضیحات دلیل لغو یا تغییر تخصیص..."
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition-colors"
          >
            انصراف
          </button>
          <button
            type="button"
            disabled={releasing}
            onClick={() => void confirmRelease()}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs cursor-pointer transition-colors disabled:opacity-50"
          >
            {releasing ? 'در حال ثبت برگشت...' : 'تأیید آزادسازی به انبار'}
          </button>
        </div>
      </div>
    </div>
  );
}
