import { CheckCircle2, Boxes, Lock, Printer, Save, Unlock } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';
import type { ProjectInventory } from '../../../hooks/useProjectInventory';
import type { ReservationShortage } from '../../../lib/projects/projectReservation';
import { ReservationReconcileButton } from '../ReservationReconcileDialog';

interface InventoryHeaderCardProps {
  projectId: number;
  inventory: ProjectInventory;
  /** `projects.edit`: the saves and the finalize */
  canEdit: boolean;
  /** v10.2.3 (TD-1290): stored shortages the free stock now covers, for «تکمیل رزرو» */
  unreservedNowFree: ReservationShortage[];
}

/**
 * The materials tab's dark header: the finalize state, «ثبت نهایی / لغو ثبت نهایی / تکمیل رزرو»، «چاپ لیست خرید»، «ذخیره
 * فرم» and the readiness of the materials. 10.3 (ARCH review finding 3, part 11): moved out of `ProjectInventoryTab`.
 */
export function InventoryHeaderCard({ projectId, inventory, canEdit, unreservedNowFree }: InventoryHeaderCardProps) {
  const {
    isFinalized, saving, isDirty, projectWriteBase, applyReservationReconcile, handleUnfinalizeReservation, handleFinalizeAndReserveStock,
    handlePrintPurchaseListWithCheck, handleSaveInventoryControl, materialProgress, availability,
  } = inventory;

  return (
    <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg space-y-4 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base text-white">کنترل موجودی و تامین مواد اولیه پروژه</h3>
              {isFinalized && (
                <span className="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full font-bold text-[10px] flex items-center gap-1">
                  🔒 ثبت نهایی و رزروشده در انبار
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              بررسی ساختار درختی کد به کد محصولات و کنترل اقلام عمومی سفارش با انبار اصلی
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
          {!canEdit ? (
            <span className="px-3 py-1.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-[11px] font-bold">
              فقط مشاهده؛ ذخیره کنترل موجودی مجوز «ویرایش پروژه و مراحل تولید» می‌خواهد
            </span>
          ) : isFinalized ? (
            <>
              {/* TD-1341 (بستهٔ ۱۲ بند ۱): رزرو با فهرست مواد امروز برابر می‌شود، بی لغو ثبت نهایی */}
              <ReservationReconcileButton projectId={projectId} writeBase={projectWriteBase} busy={saving} dirty={isDirty} onApplied={applyReservationReconcile} />
              <button
                type="button"
                onClick={() => void handleUnfinalizeReservation()}
                disabled={saving}
                className="px-3.5 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Unlock className="w-4 h-4 text-purple-300" />
                لغو ثبت نهایی و آزاد کردن رزرو
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleFinalizeAndReserveStock()}
              disabled={saving}
              className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <Lock className="w-4 h-4 text-purple-200" />
              ثبت نهایی و رزرو انبار
            </button>
          )}

          <button
            type="button"
            onClick={handlePrintPurchaseListWithCheck}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            title="چاپ لیست خرید و اقلام کسری"
          >
            <Printer className="w-4 h-4 text-slate-400" />
            <span>چاپ لیست خرید</span>
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => void handleSaveInventoryControl()}
              disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'در حال ذخیره...' : 'ذخیره فرم'}
            </button>
          )}
        </div>
      </div>

      {/* Overall Material Readiness Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-slate-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            میزان آماده‌باش و موجود بودن مواد اولیه:
          </span>
          <span className="text-amber-400 font-mono text-sm">
            {materialProgress === null ? (availability.status === 'error' ? 'نامعلوم' : '…') : `${formatPersianNumber(materialProgress)}٪`}
          </span>
        </div>
        <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
          <div 
            className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${materialProgress ?? 0}%` }}
          />
        </div>
        {/* v10.2.3 (TD-1290): free stock follows the finalize's rule */}
        <p className="text-[11px] text-slate-400">
          «آزاد برای این پروژه» موجودی کل منهای رزرو پیش‌فاکتورهای فروش و پروژه‌های دیگر است، همان رقمی که ثبت نهایی با آن رزرو می‌کند؛ وضعیت «موجود / کسری» خودکار است.
        </p>
        {unreservedNowFree.length > 0 && (
          <p className="text-[11px] text-amber-300" role="status">
            موجودی آزاد {unreservedNowFree.map(s => `«${s.itemName || s.itemCode}»`).join('، ')} اکنون نیاز پروژه را می‌پوشاند، اما رزرو ثبت نهایی با رسیدن موجودی خودبه‌خود بیشتر نمی‌شود و پیش‌فاکتور فروش هنوز می‌تواند آن را ببرد؛ برای رزرو آن «تکمیل رزرو» را بزنید.
          </p>
        )}
        {availability.status === 'error' && (
          <p className="text-[11px] text-rose-300" role="alert">
            موجودی آزاد مواد خوانده نشد؛ وضعیت ردیف‌ها نامعلوم است و فهرست خرید با موجودی کل ساخته شده است.
          </p>
        )}
      </div>
    </div>
  );
}
