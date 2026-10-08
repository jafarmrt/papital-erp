import { AlertTriangle } from 'lucide-react';
import type { ReservationShortage } from '../../lib/projects/projectReservation';
import { formatPersianNumber } from '../../utils';

/**
 * v9.0.351 (TD-819، تصمیم ت۳ بسته ۷): کالاهایی که ثبت نهایی کمتر از نیاز پروژه رزرو کرد، چون بقیه موجودی را پیش‌فاکتورها یا
 * پروژه‌های دیگر رزرو کرده بودند (یا موجودی نبود). سرور این فهرست را هنگام ثبت نهایی می‌نویسد.
 */
export function ReservationShortageList({ shortages }: { shortages: ReservationShortage[] }) {
  if (shortages.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3 print:hidden">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
        <div>
          <h4 className="font-bold text-amber-950 text-sm">کمبود رزرو هنگام ثبت نهایی</h4>
          <p className="text-xs text-amber-800">
            {formatPersianNumber(shortages.length)} کالا کمتر از نیاز پروژه رزرو شد، چون بقیه موجودی آن را پیش‌فاکتورهای فروش یا
            پروژه‌های دیگر پیش‌تر رزرو کرده بودند. کمبود را از راه خرید تأمین کنید.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto border border-amber-200 rounded-xl bg-white">
        <table className="w-full text-xs text-right">
          <thead className="bg-amber-100/80 text-amber-950 font-bold">
            <tr>
              <th className="p-2">کالا</th>
              <th className="p-2 text-center">نیاز پروژه</th>
              <th className="p-2 text-center">رزروشده</th>
              <th className="p-2 text-center">کمبود</th>
              <th className="p-2 text-center">موجودی کل</th>
              <th className="p-2 text-center">رزرو دیگران</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {shortages.map(s => (
              <tr key={s.itemId}>
                <td className="p-2">
                  <div className="font-bold text-slate-900">{s.itemName}</div>
                  <div className="font-mono text-slate-500">{s.itemCode}</div>
                </td>
                <td className="p-2 text-center">{formatPersianNumber(s.requiredQty)} {s.unit}</td>
                <td className="p-2 text-center text-emerald-800">{formatPersianNumber(s.reservedQty)} {s.unit}</td>
                <td className="p-2 text-center font-bold text-red-700">{formatPersianNumber(s.shortQty)} {s.unit}</td>
                <td className="p-2 text-center">{formatPersianNumber(s.stock)} {s.unit}</td>
                <td className="p-2 text-center">{formatPersianNumber(s.reservedByOthers)} {s.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
