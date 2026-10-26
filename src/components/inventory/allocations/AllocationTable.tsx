import { CheckCircle2, Clock, FileText, RefreshCw, RotateCcw, User, Warehouse } from 'lucide-react';
import { formatPersianDate, formatPersianNumber, toPersianDigits, formatPersianCode } from '../../../utils';
import { warehouseLabel } from '../../../lib/inventory/warehouseLabel';
import { ErrorStateView } from '../../common/ErrorStateView';
import { ListPager } from '../../common/ListPager';
import { ALLOCATION_PAGE_SIZE, type BomAllocationRow, type BomAllocations } from './useBomAllocations';

interface AllocationTableProps {
  list: BomAllocations;
  canConsumeAllocation: boolean;
  canReleaseAllocation: boolean;
  onTrace: (alloc: BomAllocationRow) => void;
  onRelease: (alloc: BomAllocationRow) => void;
}

/** one page of the allocations, each with its trace, and «مصرف شد» and «آزادسازی» while it is allocated */
export function AllocationTable({ list, canConsumeAllocation, canReleaseAllocation, onTrace, onRelease }: AllocationTableProps) {
  const { allocations, loading, loadError, reload, consume, warehousesList, page, setPage, totalPages, total } = list;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold">
              <th className="py-3 px-3 text-center">شناسه</th>
              <th className="py-3 px-3">کد و عنوان پروژه</th>
              <th className="py-3 px-4">ماده اولیه مصرفی</th>
              <th className="py-3 px-3 text-center">مقدار و واحد</th>
              <th className="py-3 px-3 text-center">انبار مبداء</th>
              <th className="py-3 px-3 text-center">شناسه سند کاردکس</th>
              <th className="py-3 px-3 text-center">وضعیت</th>
              <th className="py-3 px-3">تخصیص‌دهنده و زمان</th>
              <th className="py-3 px-3 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  <RefreshCw className="animate-spin inline-block mr-2" size={16} />
                  در حال بارگذاری تخصیص‌های مواد اولیه…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={9} className="py-4">
                  <ErrorStateView compact title={`تخصیص‌های مواد اولیه خوانده نشد: ${loadError}`} onRetry={reload} />
                </td>
              </tr>
            ) : allocations.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  هیچ تخصیصی با پالایش جاری یافت نشد.
                </td>
              </tr>
            ) : (
              allocations.map((alloc) => (
                <tr key={alloc.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-3 text-center font-mono font-bold text-slate-600">
                    #{toPersianDigits(alloc.id)}
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-blue-700 font-mono">{formatPersianCode(alloc.projectCode)}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{alloc.notes || 'پروژه تولید'}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900">{alloc.itemName}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{formatPersianCode(alloc.itemCode)}</div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="font-bold text-slate-800 font-mono text-sm">
                      {formatPersianNumber(alloc.quantity)}
                    </span>{' '}
                    <span className="text-slate-500 text-[11px]">{alloc.unit}</span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700 font-medium">
                      <Warehouse size={12} />
                      {warehouseLabel(alloc.sourceLocation, warehousesList)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {alloc.sourceTransactionId ? (
                      <span className="font-mono text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold">
                        {toPersianDigits(alloc.sourceTransactionId)}
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {alloc.status === 'allocated' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock size={12} />
                        در جریان تولید
                      </span>
                    )}
                    {alloc.status === 'consumed' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 size={12} />
                        مصرف شده
                      </span>
                    )}
                    {alloc.status === 'released' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                        <RotateCcw size={12} />
                        آزاد شده
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1 text-slate-700 font-medium">
                      <User size={12} className="text-slate-400" />
                      <span>{alloc.username || 'سامانه'}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {alloc.allocatedAt ? formatPersianDate(alloc.allocatedAt) : '-'}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onTrace(alloc)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        title="مشاهده شناسنامه ردگیری منبع"
                      >
                        <FileText size={15} />
                      </button>

                      {alloc.status === 'allocated' && (
                        <>
                          {canConsumeAllocation && (
                            <button
                              onClick={() => void consume(alloc)}
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                              title="ثبت مصرف قطعی در محصول"
                            >
                              مصرف شد
                            </button>
                          )}
                          {canReleaseAllocation && (
                            <button
                              onClick={() => onRelease(alloc)}
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                              title="آزادسازی و عودت به انبار"
                            >
                              آزادسازی
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="p-3">
        <ListPager page={page} totalPages={totalPages} total={total} limit={ALLOCATION_PAGE_SIZE} onPage={setPage} disabled={loading} />
      </div>
    </div>
  );
}
