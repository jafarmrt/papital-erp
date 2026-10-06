import { ArrowLeftRight, Ban, Eye } from 'lucide-react';
import { formatPersianNumber, formatPersianDate } from '../../utils';

interface WarehouseTransfersListTabProps {
  transfersLoading: boolean;
  transfers: any[];
  handleViewTransfer: (docId: number) => void;
  onOpenTransferModal: () => void;
  /** v9.0.58 (TD-489): ابطال حواله با مسیر ابطال اسناد */
  onVoidTransfer: (transfer: { id: number; refNumber?: string }) => void;
  voidingId: number | null;
}

export function WarehouseTransfersListTab({
  transfersLoading,
  transfers,
  handleViewTransfer,
  onOpenTransferModal,
  onVoidTransfer,
  voidingId
}: WarehouseTransfersListTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="text-blue-600" size={18} />
          <h3 className="font-bold text-slate-800 text-sm">سوابق حواله‌های جابه‌جایی و انتقال بین انبارها</h3>
        </div>
        <button
          onClick={onOpenTransferModal}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
        >
          ثبت حواله انتقال جدید
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
              <th className="py-3 px-3 text-center">#</th>
              <th className="py-3 px-3">شماره حواله</th>
              <th className="py-3 px-3">تاریخ ثبت</th>
              <th className="py-3 px-3">انبار مبدأ</th>
              <th className="py-3 px-3">انبار مقصد</th>
              <th className="py-3 px-3">کاربر ثبت‌کننده</th>
              <th className="py-3 px-4">توضیحات</th>
              <th className="py-3 px-3 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transfersLoading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 font-medium">
                  در حال بارگذاری سوابق حواله‌های جابه‌جایی انبار...
                </td>
              </tr>
            ) : transfers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 font-medium">
                  هیچ حواله انتقالی ثبت نشده است.
                </td>
              </tr>
            ) : (
              transfers.map((t, idx) => (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-3 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                  <td className="py-3 px-3 font-mono font-bold text-blue-600">{t.refNumber || `#${t.id}`}</td>
                  <td className="py-3 px-3 font-mono">{formatPersianDate(t.date)}</td>
                  <td className="py-3 px-3 font-bold text-slate-700">{t.sourceLocation || '-'}</td>
                  <td className="py-3 px-3 font-bold text-slate-700">{t.destinationLocation || '-'}</td>
                  <td className="py-3 px-3 text-slate-600">{t.user || 'انباردار'}</td>
                  <td className="py-3 px-4 text-slate-600">{t.notes || '-'}</td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => handleViewTransfer(t.id)}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                    >
                      <Eye size={14} />
                      <span>مشاهده</span>
                    </button>
                    <button
                      onClick={() => onVoidTransfer({ id: t.id, refNumber: t.refNumber })}
                      disabled={voidingId !== null}
                      className="mr-1.5 p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Ban size={14} />
                      <span>{voidingId === t.id ? 'در حال ابطال...' : 'ابطال'}</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
