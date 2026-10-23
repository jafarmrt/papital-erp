import { CheckCircle2, Layers, Lock } from 'lucide-react';
import { toPersianDigits } from '../../../utils';
import type { ProductProgressTicks } from '../../../hooks/useProductProgressTicks';

/** the top of the progress tab: the project's totals, whether it may be set «تکمیل‌شده», and each stage across the products */
export function ProgressSummary({ ticks, canEdit }: { ticks: ProductProgressTicks; canEdit: boolean }) {
  const { summary, stages, saving, setStageForAll: setStageForAllSkus } = ticks;
  return (
    <>
      {/* Summary Band */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
          <span className="text-[10px] text-amber-700 font-bold block mb-1">پیشرفت وزن‌دار کل پروژه</span>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-amber-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${summary?.weighted_progress_percent || 0}%` }} />
            </div>
            <span className="font-mono font-bold text-amber-800 text-sm">{toPersianDigits(summary?.weighted_progress_percent || 0)}٪</span>
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <span className="text-[10px] text-slate-500 font-bold block mb-1">تعداد اقلام کالا:</span>
          <p className="font-bold font-mono text-slate-900 text-sm">{toPersianDigits(summary?.total_skus || 0)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
          <span className="text-[10px] text-emerald-700 font-bold block mb-1">اقلام تکمیل‌شده (همه مراحل):</span>
          <p className="font-bold font-mono text-emerald-800 text-sm">{toPersianDigits(summary?.fully_completed_skus || 0)} از {toPersianDigits(summary?.total_skus || 0)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
          <span className="text-[10px] text-blue-700 font-bold block mb-1">تیراژ کل سفارش:</span>
          <p className="font-bold font-mono text-blue-800 text-sm">{toPersianDigits(summary?.total_quantity || 0)}</p>
        </div>
      </div>

      {/* V3.1.16 — بنر پایش شرط تغییر وضعیت پروژه به تکمیل‌شده بر اساس گزینه‌های ماتریس */}
      {summary?.total_matrix_cells !== undefined && summary.total_matrix_cells > 0 && (
        <div className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
          summary.all_matrix_completed 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
            : 'bg-amber-50/70 border-amber-200 text-amber-900'
        }`}>
          <div className="flex items-center gap-2.5">
            {summary.all_matrix_completed ? (
              <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                <Lock className="w-4 h-4" />
              </div>
            )}
            <div>
              <div className="font-bold text-xs flex items-center gap-2">
                <span>شرط تغییر وضعیت پروژه به «تکمیل‌شده»:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  summary.all_matrix_completed ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'
                }`}>
                  {summary.all_matrix_completed ? 'مجاز و آماده تکمیل' : 'قفل - ماتریس کامل نیست'}
                </span>
              </div>
              <p className="text-[11px] opacity-80 mt-0.5">
                {summary.all_matrix_completed 
                  ? `تمام ${toPersianDigits(summary.total_matrix_cells)} گزینه ماتریس فیزیکی محصولات تیک خورده‌اند و امکان ثبت پروژه به عنوان تکمیل‌شده فراهم است.`
                  : `تنها زمانی کاربر می‌تواند وضعیت پروژه را به تکمیل‌شده تغییر دهد که تمام گزینه‌های ماتریس تیک خورده باشند (در حال حاضر ${toPersianDigits(summary.completed_matrix_cells || 0)} از ${toPersianDigits(summary.total_matrix_cells)} گزینه تیک خورده و ${toPersianDigits(summary.missing_matrix_cells || 0)} گزینه مانده است).`
                }
              </p>
            </div>
          </div>
          <div className="text-left shrink-0 font-mono text-xs font-bold px-3 py-1 bg-white/70 rounded-xl border border-black/5">
            {toPersianDigits(summary.completed_matrix_cells || 0)} / {toPersianDigits(summary.total_matrix_cells)}
          </div>
        </div>
      )}

      {/* Per-stage rollup strip */}
      {stages.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-slate-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              وضعیت هر مرحله در کل اقلام
            </h4>
            <span className="text-[10px] text-slate-400">تعداد اقلام تکمیل‌شده در هر مرحله / کل اقلام مرتبط</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {stages.map(s => {
              // 10.2 package 12 (D6): ticked products count whole, the others their workshop work; the count and the
              // percent both read the unsent ticks (review N5)
              const { done, applicable } = ticks.stageCountsOf(s.stage_order);
              const pct = ticks.stagePercentOf(s.stage_order);
              return (
                <div key={s.stage_order} className="bg-slate-50 rounded-xl border border-slate-100 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-700 truncate" title={s.title}>{s.title}</span>
                    <span className="font-mono text-[10px] font-bold text-slate-500">{toPersianDigits(pct)}٪</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[9px] text-slate-400">
                    {canEdit ? (
                      <button
                        onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                        disabled={saving}
                        className="text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        title="تمام کردن این مرحله برای همه اقلام اعمال‌شده"
                      >
                        تمام همه
                      </button>
                    ) : <span />}
                    <span>{toPersianDigits(done)}/{toPersianDigits(applicable)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
