import type { DocItemRow } from '../DocItemsTable';
import { reservationMatchesListItem, type GlobalReservation, type StockDocProject } from '../../../lib/documents/stockReservations';
import { formatPersianNumber } from '../../../utils';

interface ProjectReservedItemsCardProps {
  project: StockDocProject;
  reservedItems: GlobalReservation[];
  docItems: DocItemRow[];
  onAddAll: () => void;
  onAddSingle: (rItem: GlobalReservation) => void;
}

/** TD-080 (بخش ۳): کارت اقلام رزرو شده پروژه انتخاب‌شده در حواله خروج — استخراج‌شده از DocumentsPage */
export function ProjectReservedItemsCard({ project, reservedItems, docItems, onAddAll, onAddSingle }: ProjectReservedItemsCardProps) {
  return (
    <div className="bg-purple-50/90 border border-purple-200 rounded-2xl p-4 space-y-3 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-200/80 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
            🔒
          </div>
          <div>
            <span className="font-bold text-purple-950 text-xs">
              اقلام رزرو شده انبار برای پروژه «{project.project_code || project.title}»
            </span>
            <span className="mr-2 text-[11px] font-mono text-purple-800 font-bold bg-purple-200/80 px-2 py-0.5 rounded-full border border-purple-300">
              {formatPersianNumber(reservedItems.length)} قلم کالای رزروشده
            </span>
          </div>
        </div>

        {reservedItems.length > 0 && (
          <button
            type="button"
            onClick={onAddAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer self-start sm:self-auto"
          >
            <span>➕ بارگذاری تمام اقلام رزروشده در حواله</span>
          </button>
        )}
      </div>

      {reservedItems.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
          {reservedItems.map((rItem, idx: number) => {
            const isAlreadyInDoc = docItems.some(d => reservationMatchesListItem(rItem, d.item));

            return (
              <div key={idx} className="bg-white border border-purple-200 hover:border-purple-300 p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 shadow-2xs transition-all">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-purple-900 font-mono font-bold">{rItem.itemCode || '---'}</span>
                    <span className="text-slate-900 font-bold truncate">{rItem.itemName}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                    <span>رزرو:</span>
                    <span className="text-emerald-700 font-bold">{formatPersianNumber(rItem.reservedQty)} {rItem.unit}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onAddSingle(rItem)}
                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer shrink-0 ${
                    isAlreadyInDoc 
                      ? 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200' 
                      : 'bg-purple-100 hover:bg-purple-200 text-purple-950 border border-purple-300'
                  }`}
                  title={isAlreadyInDoc ? 'به‌روزرسانی مقدار در حواله' : 'افزودن به اقلام سند'}
                >
                  {isAlreadyInDoc ? '✓ در سند' : '+ افزودن'}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-purple-800">
          برای این پروژه هیچ کالای رزروشده‌ای در انبار وجود ندارد یا اقلام رزروی پیش‌تر به طور کامل خارج شده‌اند. خروج کالا با اتکا به موجودی آزاد عمومی انبار انجام می‌شود.
        </p>
      )}
    </div>
  );
}
