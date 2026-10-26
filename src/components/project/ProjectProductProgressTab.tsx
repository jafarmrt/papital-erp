import { useState, useMemo } from 'react';
import { RefreshCw, Package, CheckCircle2, Circle, Info, CheckSquare, Square } from 'lucide-react';
import { toPersianDigits, formatPersianCode } from '../../utils';
import { useProjectPermissions } from '../../hooks/useProjectPermissions';
import { useProductProgressTicks } from '../../hooks/useProductProgressTicks';
import { cellWorkOf, splitStageColumns } from '../../lib/projects/progressTicks';
import { ProgressMatrixCell } from './ProgressMatrixCell';
import { ProgressSummary } from './progress/ProgressSummary';
import { StaleProgressNotice } from './progress/StaleProgressNotice';
import { ProgressMatrixToolbar, type ProgressFilter } from './progress/ProgressMatrixToolbar';
import { normalizeSearchText } from '../../lib/search/searchText';

// V3.1.5 — تب «پیشرفت به تفکیک کد کالا» (ماتریسی SKU × مرحله + فیلتر، انتخاب ردیف و عملیات دسته‌ای)
// مدل: هر ردیف = یک SKU (کد کالا × کمیت)؛ وضعیت هر مرحله دودویی (تمام/ناتمام)؛
// پیشرفت کل پروژه = تجمیع وزن‌دار (Σ sku%×qty / Σ qty)
// v10.2.9 (10.2 package 10): reading, ticking and saving live in `useProductProgressTicks`, shared with the phone list
// 10.3 (ARCH review finding 3): the matrix stays on screen while it is read again (a save here or elsewhere); the
// summary and the matrix bar are in `./progress`

export default function ProjectProductProgressTab({ projectId, onUpdate, onDirtyChange, onBusyChange }: {
  projectId: number;
  onUpdate?: () => void;
  /** v10.2.1 (review U2): the page asks before a tab change or leaving while ticks are not saved */
  onDirtyChange?: (dirty: boolean) => void;
  /** v10.2.9 (10.2 package 10): ticks not saved or a save under way, so a phone page keeps this layout */
  onBusyChange?: (busy: boolean) => void;
}) {
  // v9.0.417 (TD-752): تیک ماتریس با `PUT /projects/:id/product-progress` و کلید `projects.edit` ثبت می‌شود
  const { canEdit } = useProjectPermissions();
  const ticks = useProductProgressTicks(projectId, { canEdit, onUpdate, onDirtyChange, onBusyChange });
  const {
    loading, loadError, saving, stages, products,
    statusOf: resolveStatus, percentOf: progressPercent, isEdited, toggle: toggleStatus, setStageForAll: setStageForAllSkus,
  } = ticks;

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProgress, setFilterProgress] = useState<ProgressFilter>('all');

  // Selected SKU item_ids for batch operations
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<number>>(new Set());

  // گروه‌بندی ستون‌ها: مراحل پایه (همه SKUها) اول، مراحل اختیاری (زیرمجموعه SKUها) بعد از آن
  const { baseStages, optionalStages } = useMemo(() => splitStageColumns(stages, products), [stages, products]);

  // Filtered products based on search and progress status
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // review of #406 (U21): a code typed in Persian digits is found too
      const query = normalizeSearchText(searchQuery);
      const matchesSearch = !query || [p.item_name, p.item_code, p.customer_code].some(text => normalizeSearchText(text).includes(query));

      if (!matchesSearch) return false;

      const pct = progressPercent(p);
      if (filterProgress === 'completed') return pct === 100;
      if (filterProgress === 'incomplete') return pct < 100;
      return true;
    });
  }, [products, searchQuery, filterProgress, progressPercent]);

  // Selection handlers
  const toggleSelectSku = (itemId: number | null) => {
    if (!itemId) return;
    setSelectedSkuIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const toggleSelectAllSkus = () => {
    const selectable = filteredProducts.filter(p => p.item_id !== null).map(p => p.item_id as number);
    if (selectedSkuIds.size >= selectable.length && selectable.length > 0) {
      setSelectedSkuIds(new Set());
    } else {
      setSelectedSkuIds(new Set(selectable));
    }
  };

  // v9.0.422 (TD-766): a failed read is said with another try, never shown as a project without products
  if (loadError && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center" role="alert">
        <p className="font-bold text-rose-700">جدول پیشرفت خوانده نشد: {loadError}</p>
        <button
          type="button"
          onClick={ticks.reload}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          تلاش دوباره
        </button>
      </div>
    );
  }

  if (!ticks.data) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
        <span>در حال محاسبه پیشرفت تفکیکی کد کالاها...</span>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2 text-center">
        <Package className="w-8 h-8 text-slate-300" />
        <p className="font-bold text-slate-600">هیچ کد کالایی به این پروژه پیوند نخورده است</p>
        <p className="text-[11px]">در فرم ویرایش پروژه، ردیف‌های «کد کالا» را با کالای انبار و تیراژ هدف تعریف کنید تا پیشرفت تفکیکی فعال شود.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs animate-fadeIn">
      <StaleProgressNotice ticks={ticks} />
      <ProgressSummary ticks={ticks} canEdit={canEdit} />

      {/* SKU × Stage Matrix */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <ProgressMatrixToolbar
          ticks={ticks}
          canEdit={canEdit}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterProgress={filterProgress}
          setFilterProgress={setFilterProgress}
          selectedSkuIds={selectedSkuIds}
          setSelectedSkuIds={setSelectedSkuIds}
        />

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-700 font-bold">
                <th className="p-2 text-center w-8">
                  <button
                    type="button"
                    onClick={toggleSelectAllSkus}
                    className="p-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                    title="انتخاب همه ردیف‌های جدول"
                  >
                    {selectedSkuIds.size > 0 && selectedSkuIds.size >= filteredProducts.length ? (
                      <CheckSquare className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="p-2.5 sticky right-0 bg-slate-100/90 z-10 border-l border-slate-200">کد محصول</th>
                <th className="p-2.5">نام محصول</th>
                <th className="p-2.5 text-center">تیراژ</th>
                {baseStages.map(s => (
                  <th key={`b-${s.stage_order}`} className="p-1.5 text-center min-w-[70px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400 font-mono">{toPersianDigits(s.stage_order)}</span>
                      <span className="truncate max-w-[80px]" title={s.title}>{s.title}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                          disabled={saving}
                          className="text-[9px] text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default"
                          title={`تکمیل مرحله «${s.title}» برای همه کالاها`}
                        >
                          ✓ همه
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                {optionalStages.map(s => (
                  <th key={`o-${s.stage_order}`} className="p-1.5 text-center min-w-[70px] bg-amber-50/50">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-amber-600 font-mono">{toPersianDigits(s.stage_order)} ◇</span>
                      <span className="truncate max-w-[80px] text-amber-800" title={`${s.title} (اختیاری — برای برخی اقلام)`}>{s.title}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setStageForAllSkus(s.stage_order, 'completed')}
                          disabled={saving}
                          className="text-[9px] text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default"
                          title={`تکمیل مرحله اختیاری «${s.title}» برای همه کالاها`}
                        >
                          ✓ همه
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="p-2.5 text-center">پیشرفت کالا</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={4 + baseStages.length + optionalStages.length + 1} className="py-8 text-center text-slate-400">
                    هیچ محصولی با شرط‌های جست‌وجوی فعلی یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p, idx) => {
                  const pct = progressPercent(p);
                  const isSelected = p.item_id ? selectedSkuIds.has(p.item_id) : false;
                  return (
                    <tr 
                      key={`${p.item_id}-${idx}`} 
                      className={`transition-colors ${
                        isSelected 
                          ? 'bg-amber-100/40' 
                          : pct === 100 
                          ? 'bg-emerald-50/20 hover:bg-emerald-50/40' 
                          : 'hover:bg-amber-50/30'
                      }`}
                    >
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectSku(p.item_id)}
                          className="p-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-amber-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </button>
                      </td>
                      <td className="p-2.5 font-mono font-bold text-amber-900 sticky right-0 bg-white/95 z-10 border-l border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span>{formatPersianCode(p.item_code) || <span className="text-red-600 font-bold">بدون کد!</span>}</span>
                          {p.customer_code && (
                            <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1 py-0.2 rounded border border-slate-200" title="کد مشتری">
                              {p.customer_code}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2.5 font-bold text-slate-900 max-w-[140px] truncate" title={p.item_name}>
                        {p.item_name || '—'}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-slate-700 whitespace-nowrap">
                        {toPersianDigits(p.quantity)} {p.unit || 'عدد'}
                      </td>
                      {[...baseStages, ...optionalStages].map(s => {
                        const optional = !baseStages.includes(s);
                        if (!p.applicable_stage_orders.includes(s.stage_order)) {
                          return <td key={`c-${s.stage_order}`} className={`p-1 text-center ${optional ? 'bg-amber-50/30' : ''}`}><span className="text-slate-200">—</span></td>;
                        }
                        return (
                          <ProgressMatrixCell
                            key={`c-${s.stage_order}`}
                            stageTitle={s.title}
                            optional={optional}
                            status={resolveStatus(p, s.stage_order)}
                            edited={isEdited(p, s.stage_order)}
                            work={cellWorkOf(p, s.stage_order)}
                            disabled={!canEdit || saving}
                            onToggle={() => toggleStatus(p, s.stage_order)}
                          />
                        );
                      })}
                      <td className="p-2 text-center">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono font-bold text-[10px] text-slate-700">{toPersianDigits(pct)}٪</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> تمام</span>
          <span className="flex items-center gap-1"><Circle className="w-3.5 h-3.5 text-slate-300" /> ناتمام</span>
          <span className="flex items-center gap-1"><Info className="w-3.5 h-3.5 text-blue-500" /> مراحل اختیاری با نشان ◇ — فقط برای اقلامی که در فرم پروژه انتخاب شده‌اند اعمال می‌شود</span>
          <span>عدد زیر هر خانه: کار ثبت‌شدهٔ کارگاه از برنامه؛ «تمام» را مسئول پروژه تیک می‌زند</span>
        </div>
      </div>
    </div>
  );
}
