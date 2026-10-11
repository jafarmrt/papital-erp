import { useState } from 'react';
import { Edit3, GitBranch, X } from 'lucide-react';
import { cn, formatPersianCode, formatPersianDate, formatPersianNumber } from '../../../utils';
import { WorkflowStepperWidget } from '../../workflow/WorkflowStepperWidget';
import type { InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';
import { openProformaBadge, openProformasPageCount } from '../../../lib/invoices/openProformas';

/**
 * صفحه صدور فاکتور: جدول «پیش فاکتورهای باز» و پنجره گردش‌کار پیش‌فاکتور — منتقل‌شده بدون تغییر از CreateInvoicePage.
 */
interface OpenProformasPanelProps {
  proformas: InvoiceListDocument[];
  /** v9.0.301 (TD-792): شمار همه پیش‌فاکتورهای فروش باز و صفحه جاری فهرست */
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  editingDocId: number | null;
  onPrint: (proforma: InvoiceListDocument) => void;
  onEdit: (proforma: InvoiceListDocument) => void;
  onWorkflowStateChange: () => void;
}

export function OpenProformasPanel({ proformas, total, page, onPageChange, editingDocId, onPrint, onEdit, onWorkflowStateChange }: OpenProformasPanelProps) {
  const [workflowModalDoc, setWorkflowModalDoc] = useState<InvoiceListDocument | null>(null);
  const pageCount = openProformasPageCount(total);

  return (
    <>
      {proformas.length > 0 && (
        <div className="bg-white border rounded-xl shadow-sm flex flex-col p-6 mt-8">
          <h3 className="font-bold flex items-center gap-2 mb-4">⏳ پیش فاکتورهای باز ({formatPersianNumber(total)})</h3>
          <div className="border rounded-xl flex overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-500 border-b">
                <tr>
                  <th className="p-3 font-medium">شماره سند</th>
                  <th className="p-3 font-medium">تاریخ</th>
                  <th className="p-3 font-medium">نام خریدار</th>
                  <th className="p-3 font-medium text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {proformas.map((p, pIdx) => (
                  <tr key={`proforma-${p.id || pIdx}-${pIdx}`} className={cn("hover:bg-slate-50", editingDocId === p.id && "bg-amber-50/60 font-bold")}>
                    <td className="p-3 font-mono font-bold">
                      {p.ref_number}
                      {openProformaBadge(p) && (
                        <span className={cn('mr-2 px-2 py-0.5 rounded-md text-[11px] font-sans', p.workflowRejected ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-600 border border-slate-200')}>
                          {openProformaBadge(p)}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono">{formatPersianDate(p.date)}</td>
                    <td className="p-3">{p.buyer_name || '-'}</td>
                    <td className="p-3 text-center">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setWorkflowModalDoc(p)}
                          className="text-purple-700 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer border border-purple-200 shadow-xs"
                          title="مشاهده وضعیت تاییدات و پیگیری در کارتابل گردش‌کار"
                        >
                          <GitBranch size={13} /> گردش‌کار و تاییدات
                        </button>
                        <button type="button" onClick={() => onPrint(p)} className="text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-blue-200">نمایش / چاپ</button>
                        <button type="button" onClick={() => onEdit(p)} className="text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-amber-200">
                          <Edit3 size={13} /> ویرایش
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-3 text-xs">
              <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">قبلی</button>
              <span>صفحه {formatPersianNumber(page)} از {formatPersianNumber(pageCount)}</span>
              <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">بعدی</button>
            </div>
          )}
        </div>
      )}

      {/* Workflow Stepper Action Modal */}
      {workflowModalDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 my-auto">
            <div className="bg-slate-900 text-white p-4 shrink-0 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-purple-400 shrink-0" />
                <h3 className="font-bold text-xs sm:text-sm">
                  چرخه تاییدات و گردش‌کار پیش‌فاکتور {formatPersianCode(workflowModalDoc.ref_number)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWorkflowModalDoc(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
              <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4 text-purple-900 leading-relaxed">
                <p className="font-medium">
                  از طریق گام‌های زیر می‌توانید پیش‌فاکتور را بررسی کرده و با دکمه <strong className="text-purple-950 font-black">«ارسال به انبار»</strong>، وضعیت گردش‌کار را جهت تایید موجودی و آماده‌سازی به کارتابل انباردار ارسال نمایید.
                </p>
              </div>

              <WorkflowStepperWidget
                entityType="document"
                entityId={workflowModalDoc.id}
                workflowCode="DOC_APPROVAL_WORKFLOW"
                title="اقدام‌های گردش کار"
                onStateChange={onWorkflowStateChange}
              />
            </div>
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkflowModalDoc(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
