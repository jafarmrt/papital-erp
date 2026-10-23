import { Package, CheckCircle2, RefreshCw, Boxes, Warehouse, Tag, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { toPersianDigits } from '../../../utils';
import { DELIVERY_MATERIALS_ONLY_NOTE } from '../../../lib/projects/deliveryCost';
import { ProjectDeliveryCostPanel } from '../ProjectDeliveryCostPanel';
import type { ProjectDelivery } from './useProjectDelivery';

/** the «تکمیل‌شده» box: allowed only once every cell of the progress matrix is ticked */
function MarkCompletedBox({ delivery }: { delivery: ProjectDelivery }) {
  const { alreadyCompleted, completion } = delivery;
  const { matrix, markCompleted, setMarkCompleted } = completion;
  return (
    <div className="flex flex-col gap-1">
      <label
        onClick={(e) => {
          if (alreadyCompleted) return;
          if (!matrix.allCompleted) {
            e.preventDefault();
            toast.error(
              `تنها زمانی می‌توانید تیک تغییر وضعیت به تکمیل‌شده را بزنید که در زبانه «۳. پیشرفت هر کالا»، تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات تیک خورده باشند. (${toPersianDigits(matrix.completed)} از ${toPersianDigits(matrix.total)} گزینه تیک خورده است)`,
              { id: 'progress-matrix-incomplete', duration: 4500 }
            );
          }
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all select-none ${
          alreadyCompleted
            ? 'bg-emerald-50 border-emerald-200 cursor-default text-emerald-800'
            : matrix.allCompleted
            ? 'bg-amber-50/80 border-amber-200/80 cursor-pointer hover:bg-amber-100/70 text-slate-800'
            : 'bg-slate-100 border-slate-200 cursor-not-allowed opacity-80 text-slate-500'
        }`}
        title={
          alreadyCompleted
            ? 'پروژه قبلاً در وضعیت تکمیل‌شده قرار گرفته است'
            : matrix.allCompleted
            ? 'تمام گزینه‌های ماتریس پیشرفت تیک خورده‌اند و امکان تغییر وضعیت فعال است'
            : `برای تغییر وضعیت، باید تمام ${toPersianDigits(matrix.total)} گزینه ماتریس پیشرفت فیزیکی محصولات در زبانه «۳. پیشرفت هر کالا» تیک خورده باشند`
        }
      >
        <input
          type="checkbox"
          disabled={!matrix.allCompleted || alreadyCompleted}
          checked={alreadyCompleted || markCompleted}
          onChange={(e) => {
            if (alreadyCompleted) return;
            setMarkCompleted(matrix.allCompleted && e.target.checked);
          }}
          className={`w-4 h-4 rounded border-slate-300 ${
            matrix.allCompleted && !alreadyCompleted ? 'text-amber-600 focus:ring-amber-500 cursor-pointer' : 'text-slate-400 cursor-not-allowed'
          }`}
        />
        <span className="font-bold text-[11px] flex items-center gap-1.5">
          {!matrix.allCompleted && !alreadyCompleted && <Lock className="w-3.5 h-3.5 text-slate-400" />}
          {matrix.allCompleted && !alreadyCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
          تغییر وضعیت پروژه به تکمیل‌شده
        </span>
      </label>

      {/* Status Hint */}
      {!alreadyCompleted && (
        <div className="text-[10px] px-1 flex items-center gap-1">
          {matrix.loading ? (
            <span className="text-slate-400">در حال بررسی ماتریس پیشرفت فیزیکی...</span>
          ) : matrix.failed ? (
            <span className="text-rose-700 font-medium">ماتریس پیشرفت فیزیکی خوانده نشد</span>
          ) : matrix.allCompleted ? (
            <span className="text-emerald-700 font-semibold flex items-center gap-1">
              ✓ تمام گزینه‌های ماتریس تیک خورده‌اند ({toPersianDigits(matrix.total)} از {toPersianDigits(matrix.total)})
            </span>
          ) : (
            <span className="text-amber-800 font-medium flex items-center gap-1">
              <span>🔒 قفل:</span>
              <span>{toPersianDigits(matrix.completed)} از {toPersianDigits(matrix.total)} مرحله تیک خورده</span>
              <span className="text-slate-500">({toPersianDigits(matrix.missing)} گزینه مانده)</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** the delivery buttons of the stats bar: the selected products, else all of a project with more than one */
function BatchDeliveryButton({ delivery }: { delivery: ProjectDelivery }) {
  const { canDeliver, selectedIds, selectedProducts, products, batchSubmitting, submitting, costPending, handleBatchAddToInventory } = delivery;
  if (!canDeliver) {
    return (
      <span className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[11px]">
        فقط مشاهده؛ ورود به انبار مجوز «ویرایش پروژه و مراحل تولید» و «ثبت ورود کالا (رسید)» می‌خواهد
      </span>
    );
  }
  if (selectedIds.size > 0) {
    return (
      <button
        type="button"
        onClick={() => void handleBatchAddToInventory(selectedProducts)}
        disabled={batchSubmitting || submitting || costPending}
        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
      >
        {batchSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        <span>تحویل {toPersianDigits(selectedIds.size)} کالای انتخاب‌شده به انبار</span>
      </button>
    );
  }
  if (products.length <= 1) return null;
  return (
    <button
      type="button"
      onClick={() => void handleBatchAddToInventory(products)}
      disabled={batchSubmitting || submitting || costPending}
      className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
      title="تحویل تمامی محصولات این پروژه به انبار با یک کلیک"
    >
      {batchSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Boxes className="w-3.5 h-3.5 text-amber-400" />}
      <span>تحویل گروهی کلیه محصولات</span>
    </button>
  );
}

/** the top of the delivery tab: what it does, the destination warehouse, the «تکمیل‌شده» box, the 1402 outlook and the totals */
export function DeliveryHeader({ delivery }: { delivery: ProjectDelivery }) {
  const { warehouses, targetLocation, setTargetLocation, canDeliver, deliveryCost, costOutlook, singleSuggestion, remainingPlanQty, products, totalDeliveredQty } = delivery;
  return (
    <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-2xs space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-900 border border-amber-300 font-bold flex items-center justify-center shrink-0 shadow-2xs">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-900 text-sm">تحویل نهایی محصولات تولیدی به انبار</h4>
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-300">
                اتصال خودکار به کاردکس و بهای تمام‌شده
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              پس از اتمام تولید، محصولات را مستقیماً وارد موجودی انبار مقصد کنید. میانگین موزون بهای تمام‌شده و سوابق کاردکس به شکل خودکار ثبت می‌شوند.
            </p>
            {/* v10.0.174 (TD-920، تصمیم ت۴ ب فاز ۵): دستمزد در فیش حقوق هزینه دوره است و دوباره در بهای تحویل نمی‌آید */}
            <p data-testid="delivery-materials-only" className="text-[11px] text-amber-800 font-semibold mt-1">
              {DELIVERY_MATERIALS_ONLY_NOTE}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Warehouse Select */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
            <Warehouse className="w-4 h-4 text-slate-500" />
            <label className="font-bold text-slate-700 text-xs whitespace-nowrap">انبار مقصد:</label>
            {warehouses.length === 0 ? (
              <span className="text-xs text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-lg border border-rose-200">
                تعریف نشده
              </span>
            ) : (
              <select
                value={targetLocation}
                onChange={(e) => setTargetLocation(e.target.value)}
                className="bg-transparent font-bold text-slate-900 text-xs focus:outline-none cursor-pointer"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.code}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Mark Completed Toggle - Strictly restricted to 100% matrix completion */}
          <MarkCompletedBox delivery={delivery} />
        </div>
      </div>

      {canDeliver && (deliveryCost.status !== 'ready' || deliveryCost.data?.costVisible) && (
        <ProjectDeliveryCostPanel status={deliveryCost.status} outlook={costOutlook} suggestedUnitCost={singleSuggestion} remainingPlanQty={singleSuggestion === null ? null : remainingPlanQty} />
      )}

      {/* Quick Stats & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-4 text-slate-600 text-xs">
          <span className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-slate-400" />
            <span>تعداد کل محصولات:</span>
            <strong className="font-mono text-slate-900">{toPersianDigits(products.length)} قلم</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-slate-400" />
            <span>مجموع تیراژ تحویلی:</span>
            <strong className="font-mono text-amber-900 font-bold">{toPersianDigits(totalDeliveredQty)} واحد</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <BatchDeliveryButton delivery={delivery} />
        </div>
      </div>
    </div>
  );
}
