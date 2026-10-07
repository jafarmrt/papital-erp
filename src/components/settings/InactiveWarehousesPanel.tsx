import { RotateCcw } from 'lucide-react';
import { confirmAction } from '../ConfirmDialogHost';
import { useInactiveWarehousesQuery, useReactivateWarehouseMutation } from '../../hooks/queries/useSettingsQueries';

/**
 * v9.0.109 (TD-490، تصمیم ت۵ الف): انبارهای غیرفعال و فعال‌سازی دوباره آن‌ها در «مدیریت انبارها»؛ فقط برای مدیر سیستم
 * نمایش داده می‌شود (route هم فقط مدیر سیستم را می‌پذیرد).
 */
export function InactiveWarehousesPanel({ enabled }: { enabled: boolean }) {
  const { data: inactive = [] } = useInactiveWarehousesQuery(enabled);
  const reactivate = useReactivateWarehouseMutation();
  if (!enabled || inactive.length === 0) return null;

  const onReactivate = async (id: number, name: string) => {
    if (!(await confirmAction({
      title: 'انبار دوباره فعال شود؟',
      message: `انبار «${name}» دوباره در فهرست انبارها و فرم‌های رسید، فروش و انتقال می‌آید.`,
      confirmText: 'فعال‌سازی دوباره',
      cancelText: 'انصراف',
    }))) return;
    reactivate.mutate(id);
  };

  return (
    <div className="border-t border-slate-200">
      <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-600">انبارهای غیرفعال</div>
      <table className="w-full text-sm text-right">
        <tbody className="divide-y divide-slate-100 text-xs">
          {inactive.map((w) => (
            <tr key={w.id} className="text-slate-500">
              <td className="p-3">{w.name}</td>
              <td className="p-3 font-mono text-left" dir="ltr">{w.code}</td>
              <td className="p-3 text-center">
                <button
                  type="button"
                  disabled={reactivate.isPending}
                  onClick={() => { void onReactivate(w.id, w.name); }}
                  className="px-2 py-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw size={12} /> فعال‌سازی دوباره
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
