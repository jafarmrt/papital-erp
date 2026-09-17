import InvoicePrintView from '../InvoicePrintView';
import { PrintModal } from '../common/PrintModal';
import type { ApprovalDocumentDetails } from './DocumentDetailsPreview';

interface PrintDocModalProps {
  printDoc: ApprovalDocumentDetails | null;
  onClose: () => void;
}

/**
 * Standard Print Modal for document approval workflow using reusable PrintModal.
 */
export function PrintDocModal({ printDoc, onClose }: PrintDocModalProps) {
  if (!printDoc) return null;

  const refCode = printDoc.refNumber || printDoc.ref_number || (printDoc.id ? String(printDoc.id) : '---');

  return (
    <PrintModal
      id="approval-print-doc-modal"
      isOpen={!!printDoc}
      onClose={onClose}
      title="نسخه چاپی پیش‌فاکتور / فاکتور"
      subtitle={`شماره عطف / شناسه سند: ${refCode}`}
      printButtonText="چاپ فاکتور"
      size="3xl"
      showSignatures={false}
    >
      <div className="overflow-y-auto max-h-[70vh]">
        <InvoicePrintView printedDoc={printDoc as any} />
      </div>
    </PrintModal>
  );
}

export default PrintDocModal;
