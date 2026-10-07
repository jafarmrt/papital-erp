import { InvoiceSettlementModal } from '../components/invoices/InvoiceSettlementModal';
import { InvoicePrintScreen } from '../components/invoices/list/InvoicePrintScreen';
import { InvoiceListKpiCards } from '../components/invoices/list/InvoiceListKpiCards';
import { InvoiceListHeader } from '../components/invoices/list/InvoiceListHeader';
import { InvoiceListFilters } from '../components/invoices/list/InvoiceListFilters';
import { InvoiceListTable } from '../components/invoices/list/InvoiceListTable';
import { InvoiceListPagination } from '../components/invoices/list/InvoiceListPagination';
import { InvoiceDetailsModal } from '../components/invoices/list/InvoiceDetailsModal';
import { InvoiceWorkflowModal } from '../components/invoices/list/InvoiceWorkflowModal';
import { useInvoiceListQuery } from '../hooks/invoices/useInvoiceListQuery';
import { useInvoiceListActions } from '../hooks/invoices/useInvoiceListActions';

/**
 * «لیست اسناد، فاکتورها و رسیدهای انبار». TD-080 (بخش ۳): فقط ترکیب بخش‌ها؛ فیلترها و کوئری لیست،
 * عملیات ردیف‌ها و مودال‌ها در hooks/invoices، منطق جمع‌ها و نگاشت نوع/وضعیت در lib/invoices هستند.
 */
export default function InvoicesListPage() {
  const query = useInvoiceListQuery();
  const actions = useInvoiceListActions(query.loadData);
  const { loadData } = query;
  const { printedDoc, selectedDocDetails, workflowDoc, settlementDoc } = actions;

  if (printedDoc) {
    return <InvoicePrintScreen printedDoc={printedDoc} setPrintedDoc={actions.setPrintedDoc} />;
  }

  return (
    <div className="space-y-5">
      {/* Top Quick KPI Cards */}
      <InvoiceListKpiCards summaryMetrics={query.summaryMetrics} />

      {/* Main Document Table Container */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs flex flex-col min-h-[500px] overflow-hidden">
        {/* Header Bar */}
        <InvoiceListHeader
          totalItems={query.totalItems}
          loading={query.loading}
          loadData={loadData}
          pageSize={query.pageSize}
          setPageSize={query.setPageSize}
        />

        {/* Filter Toolbar */}
        <InvoiceListFilters query={query} />

        {/* Table Content */}
        <InvoiceListTable safeDocs={query.safeDocs} loading={query.loading} actions={actions} />

        {/* Pagination Bar */}
        <InvoiceListPagination query={query} />
      </div>

      {/* Quick Document Details Modal */}
      {selectedDocDetails && (
        <InvoiceDetailsModal
          selectedDocDetails={selectedDocDetails}
          setSelectedDocDetails={actions.setSelectedDocDetails}
          setSettlementDoc={actions.setSettlementDoc}
          printFromDetails={actions.printFromDetails}
          loadData={loadData}
          canSettle={actions.access.settle}
        />
      )}

      {/* Quick Workflow Action Modal */}
      {workflowDoc && (
        <InvoiceWorkflowModal workflowDoc={workflowDoc} setWorkflowDoc={actions.setWorkflowDoc} loadData={loadData} />
      )}

      {/* Quick Invoice Settlement Modal */}
      <InvoiceSettlementModal
        isOpen={!!settlementDoc}
        onClose={() => actions.setSettlementDoc(null)}
        onSuccess={actions.handleSettlementSuccess}
        document={settlementDoc}
      />
    </div>
  );
}
