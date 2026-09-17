import { Eye } from 'lucide-react';
import { formatPersianNumber, formatPersianDate } from '../../utils';

interface PastAuditReportsTabProps {
  auditDocsLoading: boolean;
  auditDocs: any[];
  handleViewAudit: (docId: number) => void;
}

export function PastAuditReportsTab({
  auditDocsLoading,
  auditDocs,
  handleViewAudit
}: PastAuditReportsTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-sm">سوابق و تاریخچه اسناد انبارگردانی صادرشده</h3>
        <span className="text-xs text-slate-500 font-mono">
          تعداد اسناد: {formatPersianNumber(auditDocs.length)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
              <th className="py-3 px-3 text-center">#</th>
              <th className="py-3 px-3">شماره سند انبارگردانی</th>
              <th className="py-3 px-3">تاریخ ثبت</th>
              <th className="py-3 px-3">موقعیت انبار</th>
              <th className="py-3 px-3">کاربر ثبت‌کننده</th>
              <th className="py-3 px-4">توضیحات و بابت</th>
              <th className="py-3 px-3 text-center">مشاهده جزئیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {auditDocsLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                  در حال بارگذاری سوابق اسناد انبارگردانی...
                </td>
              </tr>
            ) : auditDocs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                  هیچ سند انبارگردانی ثبت نشده است.
                </td>
              </tr>
            ) : (
              auditDocs.map((doc, idx) => (
                <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-3 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                  <td className="py-3 px-3 font-mono font-bold text-blue-600">{doc.refNumber || `#${doc.id}`}</td>
                  <td className="py-3 px-3 font-mono">{formatPersianDate(doc.date)}</td>
                  <td className="py-3 px-3 font-bold text-slate-700">{doc.location || 'انبار مرکزی'}</td>
                  <td className="py-3 px-3 text-slate-600">{doc.user || 'سیستم'}</td>
                  <td className="py-3 px-4 text-slate-600">{doc.notes || '-'}</td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => handleViewAudit(doc.id)}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                    >
                      <Eye size={14} />
                      <span>مشاهده جزئیات</span>
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
