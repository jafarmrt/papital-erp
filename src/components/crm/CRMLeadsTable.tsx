import React, { useState, useEffect } from 'react';
import { PhoneCall, Edit3, Trash2, FileText, ChevronRight, ChevronLeft } from 'lucide-react';
import { CRMLead } from '../../types';
import { STAGES } from '../../hooks/useCRMData';
import { formatPersianPrice, formatPersianNumber } from '../../utils';

interface CRMLeadsTableProps {
  leads: CRMLead[];
  onOpenLeadDrawer: (lead: CRMLead) => void;
  onOpenActivityModal: (lead: CRMLead) => void;
  onOpenLeadModal: (lead: CRMLead) => void;
  onDeleteLead: (leadId: number) => void;
  onConvertToInvoice?: (lead: CRMLead) => void;
  onOpenCustomerDossier?: (customerName: string) => void;
}

export function CRMLeadsTable({
  leads,
  onOpenLeadDrawer,
  onOpenActivityModal,
  onOpenLeadModal,
  onDeleteLead,
  onConvertToInvoice,
  onOpenCustomerDossier
}: CRMLeadsTableProps) {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Reset to page 1 if leads array changes
  useEffect(() => {
    setCurrentPage(1);
  }, [leads.length]);

  const totalItems = leads.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedLeads = leads.slice(startIndex, endIndex);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
            <tr>
              <th className="p-3">عنوان فرصت فروش</th>
              <th className="p-3">مشتری / شرکت</th>
              <th className="p-3">تلفن تماس</th>
              <th className="p-3">منبع</th>
              <th className="p-3">مرحله فروش</th>
              <th className="p-3">ارزش تخمینی</th>
              <th className="p-3">احتمال</th>
              <th className="p-3">فروشنده مسئول</th>
              <th className="p-3">تاریخ بسته‌شدن</th>
              <th className="p-3 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {totalItems === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-400">
                  هیچ پرونده فروشی یافت نشد.
                </td>
              </tr>
            ) : (
              paginatedLeads.map((lead) => {
                const stageObj = STAGES.find((s) => s.key === lead.stage);
                return (
                  <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-bold text-slate-900 cursor-pointer hover:text-blue-600" onClick={() => onOpenLeadDrawer(lead)}>
                      {lead.title}
                    </td>
                    <td className="p-3 text-slate-600">
                      {lead.customerName ? (
                        <button
                          onClick={() => onOpenCustomerDossier?.(lead.customerName)}
                          className="font-bold text-blue-700 hover:text-blue-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                          title="مشاهده پرونده جامع این مشتری"
                        >
                          {lead.customerName}{lead.company && lead.company !== lead.customerName && !lead.customerName.includes(lead.company) ? ` (${lead.company})` : ''}
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="p-3 text-slate-600 dir-ltr text-right">{lead.phone || '-'}</td>
                    <td className="p-3 text-slate-500">{lead.source || '-'}</td>
                    <td className="p-3">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${stageObj?.badge || 'bg-slate-100 text-slate-700'}`}>
                        {stageObj?.title || lead.stage}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-slate-900">
                      {formatPersianPrice(lead.estimatedValue, lead.currency)} 
                    </td>
                    <td className="p-3 font-bold text-blue-600">{formatPersianNumber(lead.probability)}٪</td>
                    <td className="p-3 text-slate-700 font-medium">{lead.assignedTo || '-'}</td>
                    <td className="p-3 text-slate-500">{lead.expectedCloseDate || '-'}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        {onConvertToInvoice && lead.stage === 'proposal' && (
                          <button
                            onClick={() => onConvertToInvoice(lead)}
                            className="p-1.5 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                            title="تبدیل به مشتری و صدور پیش‌فاکتور"
                          >
                            <FileText size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => onOpenActivityModal(lead)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="ثبت تماس / اقدام"
                        >
                          <PhoneCall size={15} />
                        </button>
                        <button
                          onClick={() => onOpenLeadModal(lead)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          title="ویرایش"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => onDeleteLead(lead.id)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer Controls */}
      {totalItems > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span>
              نمایش <span className="font-bold text-slate-900">{formatPersianNumber(startIndex + 1)}</span> تا{' '}
              <span className="font-bold text-slate-900">{formatPersianNumber(endIndex)}</span> از مجموع{' '}
              <span className="font-bold text-blue-600">{formatPersianNumber(totalItems)}</span> پرونده فروش
            </span>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">تعداد در صفحه:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value={10}>۱۰</option>
                <option value={20}>۲۰</option>
                <option value={50}>۵۰</option>
                <option value={100}>۱۰۰</option>
              </select>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={safeCurrentPage === 1}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all flex items-center gap-1 font-bold cursor-pointer"
              >
                <ChevronRight size={14} />
                قبلی
              </button>

              <div className="flex items-center gap-1 px-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                  .map((p, idx, arr) => {
                    const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                    return (
                      <React.Fragment key={p}>
                        {showEllipsis && <span className="text-slate-400 text-xs px-1">...</span>}
                        <button
                          onClick={() => setCurrentPage(p)}
                          className={`w-7 h-7 rounded-lg text-xs font-black transition-all cursor-pointer ${
                            p === safeCurrentPage
                              ? 'bg-blue-600 text-white shadow-2xs'
                              : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          {formatPersianNumber(p)}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={safeCurrentPage === totalPages}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all flex items-center gap-1 font-bold cursor-pointer"
              >
                بعدی
                <ChevronLeft size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CRMLeadsTable;
