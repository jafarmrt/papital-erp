import { Printer, ShoppingCart, FileText, X } from 'lucide-react';
import { formatPersianCode, formatPersianDate } from '../../../utils';
import { WorkflowStepperWidget } from '../../workflow/WorkflowStepperWidget';
import { detailsTitleOf, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';
import { InvoiceDetailsInfoCards } from './InvoiceDetailsInfoCards';
import { InvoiceDetailsItemsTable } from './InvoiceDetailsItemsTable';
import { InvoiceDetailsTotals } from './InvoiceDetailsTotals';
import { InvoiceDetailsSettlementCard } from './InvoiceDetailsSettlementCard';

interface InvoiceDetailsModalProps {
  selectedDocDetails: InvoiceListDocument;
  setSelectedDocDetails: (doc: InvoiceListDocument | null) => void;
  setSettlementDoc: (doc: InvoiceListDocument | null) => void;
  printFromDetails: (docId: number) => void;
  loadData: () => void;
}

/** TD-080 (بخش ۳): مودال سریع جزئیات سند (طرف حساب، گردش‌کار، ریز اقلام، جمع‌ها و تسویه) */
export function InvoiceDetailsModal({ selectedDocDetails, setSelectedDocDetails, setSettlementDoc, printFromDetails, loadData }: InvoiceDetailsModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/90">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shadow-xs ${
              selectedDocDetails.type === 'receipt' ? 'bg-emerald-600' : selectedDocDetails.type === 'invoice' ? 'bg-blue-600' : 'bg-slate-700'
            }`}>
              {selectedDocDetails.type === 'receipt' ? <ShoppingCart size={20} /> : <FileText size={20} />}
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-2">
                <span>
                  {detailsTitleOf(selectedDocDetails.type)}
                </span>
                <span className="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                  شماره: {formatPersianCode(selectedDocDetails.ref_number)}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                تاریخ ثبت: {formatPersianDate(selectedDocDetails.date)} | ثبت توسط: {selectedDocDetails.user || 'سیستم'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => printFromDetails(selectedDocDetails.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
            >
              <Printer size={15} />
              <span>چاپ فاکتور رسمی</span>
            </button>
            <button
              onClick={() => setSelectedDocDetails(null)}
              className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Parties & Metadata Info Cards */}
          <InvoiceDetailsInfoCards selectedDocDetails={selectedDocDetails} />

          {/* Workflow Stepper in Document Details */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
            <WorkflowStepperWidget
              entityType="document"
              entityId={selectedDocDetails.id}
              workflowCode="DOC_APPROVAL_WORKFLOW"
              title={`چرخه تاییدات و گردش‌کار سند شماره ${formatPersianCode(selectedDocDetails.ref_number)}`}
              onStateChange={() => {
                loadData();
              }}
            />
          </div>

          {/* Items Table */}
          <InvoiceDetailsItemsTable selectedDocDetails={selectedDocDetails} />

          {/* Financial Totals Summary Bar */}
          <InvoiceDetailsTotals selectedDocDetails={selectedDocDetails} />

          {/* Settlement Status Card in Document Details */}
          {(selectedDocDetails.type === 'invoice' || selectedDocDetails.type === 'receipt') && (
            <InvoiceDetailsSettlementCard selectedDocDetails={selectedDocDetails} setSettlementDoc={setSettlementDoc} />
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={() => setSelectedDocDetails(null)}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
          >
            بستن پنجره
          </button>
        </div>
      </div>
    </div>
  );
}
