import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Circle, Clock, Package, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';
import { useProductProgressTicks } from '../../../hooks/useProductProgressTicks';
import { useOnlineStatus } from '../../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE, PHONE_TAP_TARGET } from '../../../lib/pwa/phoneLayout';
import { PROGRESS_CELL_LABELS, cellWorkLabel, cellWorkOf, splitStageColumns, type ProgressCellStatus } from '../../../lib/projects/progressTicks';

interface ProjectPhoneProgressProps {
  projectId: number;
  /** `projects.edit`, the key the tick's `PUT` asks; without it the list is only read */
  canEdit: boolean;
  onUpdate?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** ticks not saved or a save under way: the page keeps the phone layout until it settles */
  onBusyChange?: (busy: boolean) => void;
}

type ProgressFilter = 'incomplete' | 'all';

const CELL_STYLE: Record<ProgressCellStatus, string> = {
  completed: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  in_progress: 'bg-blue-50 border-blue-300 text-blue-800',
  blocked: 'bg-red-50 border-red-300 text-red-800',
  pending: 'bg-white border-slate-200 text-slate-700',
};

function CellIcon({ status }: { status: ProgressCellStatus }) {
  if (status === 'completed') return <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />;
  if (status === 'in_progress') return <Clock className="w-5 h-5 shrink-0" aria-hidden="true" />;
  if (status === 'blocked') return <Ban className="w-5 h-5 shrink-0" aria-hidden="true" />;
  return <Circle className="w-5 h-5 shrink-0 text-slate-300" aria-hidden="true" />;
}

/**
 * v10.2.9 (10.2 package 10, production projects review «ث»): the progress matrix on a phone, one card per product with
 * one row per stage it has, in place of the item × stage table that does not fit. A tap flips a stage between «تمام»
 * and «ناتمام»; the changes are sent together with «ثبت», through the same hook, rules and route as the desktop table
 * (`useProductProgressTicks`), so the server syncs the stages and the project status as it does there. The save bar
 * stays above the phone's bottom bar and is off while offline.
 */
export function ProjectPhoneProgress({ projectId, canEdit, onUpdate, onDirtyChange, onBusyChange }: ProjectPhoneProgressProps) {
  const ticks = useProductProgressTicks(projectId, { canEdit, onUpdate, onDirtyChange, onBusyChange });
  const { loading, saving, loadError, stages, products, summary, editCount, hasChanges, statusOf, percentOf, isEdited, toggle } = ticks;
  const online = useOnlineStatus();
  const [filter, setFilter] = useState<ProgressFilter>('incomplete');
  const optionalOrders = useMemo(() => new Set(splitStageColumns(stages, products).optionalStages.map(s => s.stage_order)), [stages, products]);
  const stageTitle = useMemo(() => new Map(stages.map(s => [s.stage_order, s.title])), [stages]);
  const stageOrders = useMemo(() => stages.map(s => s.stage_order), [stages]);

  const incompleteCount = products.filter(p => percentOf(p) < 100).length;
  // a product just ticked to 100 stays on screen until the list is read again, so a mistaken tick can be undone
  const shown = filter === 'all' ? products : products.filter(p => percentOf(p) < 100 || p.applicable_stage_orders.some(order => isEdited(p, order)));

  // the error stays on screen while «تلاش دوباره» reads again, so its button shows the spinner and waits (delta D3)
  if (loadError && products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center text-xs" role="alert">
        <p className="font-bold text-rose-700">جدول پیشرفت خوانده نشد: {loadError}</p>
        <button
          type="button"
          onClick={ticks.reload}
          disabled={loading}
          className={`${PHONE_TAP_TARGET} px-4 rounded-xl bg-blue-600 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60`}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          تلاش دوباره
        </button>
      </div>
    );
  }

  if (loading && products.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-slate-500" role="status">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-500" aria-hidden="true" />
        <span>در حال خواندن جدول پیشرفت</span>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500 text-xs">
        <Package className="w-8 h-8 text-slate-300" aria-hidden="true" />
        <p className="font-bold text-slate-600">هیچ کد کالایی به این پروژه پیوند نخورده است</p>
        <p>محصولات پروژه را در «ویرایش مشخصات» با کالای انبار و تعداد سفارش ثبت کنید تا جدول پیشرفت فعال شود.</p>
      </div>
    );
  }

  const filterButton = (value: ProgressFilter, label: string) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`flex-1 ${PHONE_TAP_TARGET} rounded-xl font-bold cursor-pointer ${filter === value ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 text-xs">
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2" aria-label="خلاصه جدول پیشرفت">
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-700">پیشرفت وزن‌دار پروژه</span>
          <strong className="text-amber-700 text-base">{formatPersianNumber(summary?.weighted_progress_percent || 0)}٪</strong>
        </div>
        {summary?.total_matrix_cells ? (
          <p className="text-slate-600">
            {formatPersianNumber(summary.completed_matrix_cells || 0)} از {formatPersianNumber(summary.total_matrix_cells)} خانه جدول تیک خورده است.
          </p>
        ) : null}
        {!canEdit && <p className="font-bold text-amber-700">فقط مشاهده: تیک زدن مراحل مجوز «ویرایش پروژه و مراحل تولید» می‌خواهد.</p>}
      </section>

      <div className="flex gap-1 bg-slate-200/80 p-1 rounded-2xl" role="group" aria-label="نمایش کالاها">
        {filterButton('incomplete', `ناتمام (${formatPersianNumber(incompleteCount)})`)}
        {filterButton('all', `همه (${formatPersianNumber(products.length)})`)}
      </div>

      {shown.length === 0 && <p className="text-center text-emerald-700 font-bold py-6">همه کالاها تمام شده‌اند.</p>}

      {shown.map((product, index) => {
        const pct = percentOf(product);
        const orders = stageOrders.filter(order => product.applicable_stage_orders.includes(order));
        const name = product.item_name || product.item_code || 'کالای بی نام';
        return (
          <section key={`${product.item_id}-${index}`} className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2" aria-label={name}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 truncate">{name}</p>
                <p className="text-slate-500">
                  {product.item_code ? <bdi>{product.item_code}</bdi> : 'بدون کد'}
                  {product.customer_code ? <> · کد مشتری <bdi>{product.customer_code}</bdi></> : ''}
                  {` · ${formatPersianNumber(product.quantity)} ${product.unit || 'عدد'}`}
                </p>
              </div>
              <strong className={`shrink-0 ${pct === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatPersianNumber(pct)}٪</strong>
            </div>
            <ul className="space-y-1.5">
              {orders.map(order => {
                const status = statusOf(product, order);
                const title = stageTitle.get(order) ?? '';
                const edited = isEdited(product, order);
                // 10.2 package 12 (D6): the done work of the stage's workshop rows, beside the manager's tick
                const work = cellWorkOf(product, order);
                return (
                  <li key={order}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={status === 'completed'}
                      aria-label={`${title} برای ${name}${work ? `، کار ثبت‌شده ${cellWorkLabel(work)}` : ''}`}
                      disabled={!canEdit || saving}
                      onClick={() => toggle(product, order)}
                      className={`w-full ${PHONE_TAP_TARGET} px-3 rounded-xl border flex items-center gap-2.5 text-right cursor-pointer disabled:cursor-default ${CELL_STYLE[status]} ${edited ? 'ring-2 ring-blue-300' : ''}`}
                    >
                      <CellIcon status={status} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-bold truncate">{title}</span>
                        {work && <span className="block text-[11px] text-slate-600">کار ثبت‌شده: {cellWorkLabel(work)}</span>}
                      </span>
                      {optionalOrders.has(order) && <span className="text-[11px] text-amber-700">اختیاری</span>}
                      <span className="text-[11px] shrink-0">{edited ? 'ثبت‌نشده' : PROGRESS_CELL_LABELS[status]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {hasChanges && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 bg-white border border-slate-200 rounded-2xl p-2 flex gap-2 shadow-lg">
          <button
            type="button"
            onClick={ticks.reset}
            disabled={saving}
            className={`${PHONE_TAP_TARGET} px-3 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60`}
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            انصراف
          </button>
          <button
            type="button"
            onClick={() => void ticks.save()}
            disabled={saving || !online}
            title={online ? undefined : OFFLINE_SUBMIT_TITLE}
            className={`flex-1 ${PHONE_TAP_TARGET} rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60`}
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            {saving ? 'در حال ثبت' : `ثبت ${formatPersianNumber(editCount)} تغییر`}
          </button>
        </div>
      )}
    </div>
  );
}
