import React from 'react';

export interface GlobalReservationRow {
  projectId: string | number;
  projectCode: string;
  projectTitle: string;
  itemId?: number | string;
  itemCode: string;
  itemName: string;
  reservedQty: number;
  unit: string;
  reservedAt?: string;
}

interface GlobalReservationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: GlobalReservationRow[];
}

/**
 * V9 Phase 5.2: پنل جامع اقلام رزرو‌شده انبار در تمام پروژه‌ها — استخراج‌شده از DocumentsPage.
 */
export function GlobalReservationsPanel({ isOpen, onClose, reservations }: GlobalReservationsPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="bg-purple-50/90 border border-purple-200 rounded-2xl p-5 space-y-3 animate-fadeIn shadow-xs">
      <div className="flex items-center justify-between border-b border-purple-200 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
            🔒
          </div>
          <div>
            <h3 className="font-bold text-purple-950 text-sm">لیست جامع اقلام رزرو شده انبار (تمام پروژه‌ها)</h3>
            <p className="text-xs text-purple-700">این کالاها در فاز کنترل پروژه فریز شده‌اند و سیستم مانع از خروج غیرمجاز آن‌ها برای سایر پروژه‌ها می‌شود.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-purple-700 hover:text-purple-950 underline font-bold"
        >
          بستن پنل
        </button>
      </div>

      {reservations.length > 0 ? (
        <div className="overflow-x-auto border border-purple-200 rounded-xl bg-white shadow-2xs">
          <table className="w-full text-xs text-right">
            <thead className="bg-purple-100/90 text-purple-950 font-bold border-b border-purple-200">
              <tr>
                <th className="p-2.5 text-center">#</th>
                <th className="p-2.5">کد کالا</th>
                <th className="p-2.5">نام کالا / ماده اولیه</th>
                <th className="p-2.5">پروژه رزرو کننده</th>
                <th className="p-2.5 text-center">مقدار رزرو شده</th>
                <th className="p-2.5 text-center">وضعیت خروج مجاز</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-100">
              {reservations.map((res, idx) => (
                <tr key={idx} className="hover:bg-purple-50/50">
                  <td className="p-2.5 text-center font-bold text-slate-500">{idx + 1}</td>
                  <td className="p-2.5 font-mono font-bold text-purple-900">{res.itemCode || '---'}</td>
                  <td className="p-2.5 font-bold text-slate-900">{res.itemName}</td>
                  <td className="p-2.5">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-950 font-bold rounded-md border border-purple-200">
                      {res.projectCode} - {res.projectTitle}
                    </span>
                  </td>
                  <td className="p-2.5 text-center font-mono font-bold text-emerald-800">
                    <span className="px-2 py-0.5 bg-emerald-100 border border-emerald-300 rounded-md">
                      {res.reservedQty} {res.unit}
                    </span>
                  </td>
                  <td className="p-2.5 text-center font-bold text-[11px] text-amber-900">
                    فقط جهت پروژه {res.projectCode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 bg-white rounded-xl border border-purple-200 text-center text-xs text-purple-800 font-bold">
          در حال حاضر هیچ کالایی در انبار برای پروژه‌ها رزرو نگردیده است. تمامی موجودی‌های انبار آزاد و قابل خروج هستند.
        </div>
      )}
    </div>
  );
}

export default GlobalReservationsPanel;
