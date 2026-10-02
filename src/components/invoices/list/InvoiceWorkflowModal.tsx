import { X, GitBranch } from 'lucide-react';
import { formatPersianCode } from '../../../utils';
import { WorkflowStepperWidget } from '../../workflow/WorkflowStepperWidget';
import { documentStatusLabelOf, workflowTypeLabelOf, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';

interface InvoiceWorkflowModalProps {
  workflowDoc: InvoiceListDocument;
  setWorkflowDoc: (doc: InvoiceListDocument | null) => void;
  loadData: () => void;
}

/** TD-080 (بخش ۳): مودال سریع چرخه تاییدات و گردش‌کار یک سند */
export function InvoiceWorkflowModal({ workflowDoc, setWorkflowDoc, loadData }: InvoiceWorkflowModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 my-auto">
        <div className="bg-slate-900 text-white p-4 shrink-0 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-purple-400 shrink-0" />
            <h3 className="font-bold text-xs sm:text-sm">
              چرخه تاییدات و گردش‌کار سند شماره {formatPersianCode(workflowDoc.ref_number)}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setWorkflowDoc(null)}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-slate-500 block text-[11px]">طرف حساب:</span>
              <span className="font-bold text-slate-900">{workflowDoc.buyer_name || 'عمومی / ثبت نشده'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">نوع سند:</span>
              <span className="font-bold text-blue-700 font-mono">
                {workflowTypeLabelOf(workflowDoc.type)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">وضعیت فعلی:</span>
              <span className="font-bold text-emerald-700">
                {documentStatusLabelOf(workflowDoc.status)}
              </span>
            </div>
          </div>

          <WorkflowStepperWidget
            entityType="document"
            entityId={workflowDoc.id}
            workflowCode="DOC_APPROVAL_WORKFLOW"
            title="اقدامات و گام‌های چرخه تایید"
            onStateChange={() => {
              loadData();
            }}
          />
        </div>
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={() => setWorkflowDoc(null)}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}
