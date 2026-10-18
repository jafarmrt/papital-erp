import { useState } from 'react';
import { PhoneCall, Edit3, Trash2, FileText, Loader2 } from 'lucide-react';
import { CRMLead } from '../../types';
import { STAGES } from '../../hooks/useCRMData';
import { formatPersianPrice, formatPersianNumber, formatPersianDate } from '../../utils';
import { useClampPage, useCrmLeadPage, useFilterPage } from '../../hooks/useCrmListPages';
import { CRM_LEAD_PAGE_SIZES } from '../../lib/crm/crmListPages';
import { CrmPager } from './CrmPager';

interface CRMLeadsTableProps {
  /** the page's search conditions (`useCRMData().leadFilterQuery`); the table reads one page of them from the server */
  filterQuery: string;
  onOpenLeadDrawer: (lead: CRMLead) => void;
  onOpenActivityModal: (lead: CRMLead) => void;
  onOpenLeadModal: (lead: CRMLead) => void;
  /** v9.0.148 (TD-893): فقط برای دارنده `crm.delete`؛ بی آن دکمه حذف نیست */
  onDeleteLead?: (leadId: number) => void;
  onConvertToInvoice?: (lead: CRMLead) => void;
  /** v10.2 package 7 (OBS-R2-24): the page opens the dossier of the file's own party */
  onOpenCustomerDossier?: (lead: CRMLead) => void;
  convertingLeadId?: number | null;
}

/**
 * v10.2 package 7 (OBS-R2-28): the table pages on the server (`GET /crm/leads?page=`), so every sales file under the
 * search conditions is reachable; before, it paged the board's list, which the server cut at 500 files.
 */
export function CRMLeadsTable({
  filterQuery,
  onOpenLeadDrawer,
  onOpenActivityModal,
  onOpenLeadModal,
  onDeleteLead,
  onConvertToInvoice,
  onOpenCustomerDossier,
  convertingLeadId = null,
}: CRMLeadsTableProps) {
  const [pageSize, setPageSize] = useState<number>(CRM_LEAD_PAGE_SIZES[0]);
  const [page, setPage] = useFilterPage(`${filterQuery}|${pageSize}`);
  const filters = new URLSearchParams(filterQuery);
  const { data: leads, total, totalPages, loading, error, refetch } = useCrmLeadPage(filters, page, pageSize);
  useClampPage(page, { totalPages, loading, error }, setPage);

  return (
    <div className="space-y-4" aria-busy={loading}>
      {error && (
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700" role="alert">
          <span>{error}</span>
          <button type="button" onClick={refetch} className="px-3 py-1 rounded-lg bg-white border border-rose-200 font-bold cursor-pointer">تلاش دوباره</button>
        </div>
      )}
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
            {loading && leads.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-500" role="status">
                  در حال دریافت پرونده‌های فروش…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-400">
                  هیچ پرونده فروشی یافت نشد.
                </td>
              </tr>
            ) : (
              leads.map((lead) => {
                const stageObj = STAGES.find((s) => s.key === lead.stage);
                return (
                  <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-bold text-slate-900 cursor-pointer hover:text-blue-600" onClick={() => onOpenLeadDrawer(lead)}>
                      {lead.title}
                    </td>
                    <td className="p-3 text-slate-600">
                      {lead.customerName ? (
                        <button
                          onClick={() => onOpenCustomerDossier?.(lead)}
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
                    <td className="p-3 text-slate-500">{formatPersianDate(lead.expectedCloseDate)}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        {onConvertToInvoice && lead.stage === 'proposal' && (
                          <button
                            onClick={() => onConvertToInvoice(lead)}
                            disabled={convertingLeadId !== null}
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
                        {onDeleteLead && (
                          <button
                            onClick={() => onDeleteLead(lead.id)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="حذف"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <label htmlFor="crm-lead-page-size" className="text-[11px] text-slate-500">تعداد در صفحه:</label>
          <select
            id="crm-lead-page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 cursor-pointer"
          >
            {CRM_LEAD_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{formatPersianNumber(size)}</option>
            ))}
          </select>
          {loading && <Loader2 size={14} className="animate-spin text-blue-600" aria-label="در حال دریافت" />}
        </div>
        <div className="flex-1 w-full">
          <CrmPager page={page} totalPages={totalPages} total={total} limit={pageSize} onPage={setPage} disabled={loading} />
        </div>
      </div>
    </div>
  );
}

export default CRMLeadsTable;
