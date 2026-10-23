import { Boxes, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';
import type { BomAllocationStatusCounts } from '../../../lib/inventory/bomAllocationList';

/** the four counts above the allocation list: every status under the search, from the server (OBS-R2-45) */
export function AllocationKpiCards({ counts }: { counts: BomAllocationStatusCounts }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 font-medium">کل رکوردهای تخصیص</div>
          <div className="text-2xl font-black text-slate-800 font-mono mt-1">
            {formatPersianNumber(counts.all)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">ثبت شده در زنجیره تولید</div>
        </div>
        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
          <Boxes size={24} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 font-medium">در جریان مصرف تولید (رزرو قطعی)</div>
          <div className="text-2xl font-black text-amber-600 font-mono mt-1">
            {formatPersianNumber(counts.allocated)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">کسر شده از موجودی آزاد انبار</div>
        </div>
        <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
          <Clock size={24} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 font-medium">مصرف قطعی در محصول</div>
          <div className="text-2xl font-black text-emerald-600 font-mono mt-1">
            {formatPersianNumber(counts.consumed)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">تکمیل شده در خط تولید</div>
        </div>
        <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
          <CheckCircle2 size={24} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 font-medium">آزادسازی و عودت به انبار</div>
          <div className="text-2xl font-black text-slate-600 font-mono mt-1">
            {formatPersianNumber(counts.released)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">برگشت داده شده با سند اصلاحی</div>
        </div>
        <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
          <RotateCcw size={24} />
        </div>
      </div>
    </div>
  );
}
