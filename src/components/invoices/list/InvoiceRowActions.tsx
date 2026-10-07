import { Printer, Trash2, Eye, CreditCard, GitBranch } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '../../ActionMenu';
import type { InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';
import type { InvoiceListActions } from '../../../hooks/invoices/useInvoiceListActions';

interface InvoiceRowActionsProps {
  doc: InvoiceListDocument;
  isCommercial: boolean;
  settlementStatus: string;
  actions: InvoiceListActions;
}

/** TD-080 (بخش ۳): ستون «عملیات» یک ردیف (تسویه سریع، جزئیات، چاپ، گردش‌کار، ابطال) */
export function InvoiceRowActions({ doc, isCommercial, settlementStatus, actions }: InvoiceRowActionsProps) {
  const { access, setSettlementDoc, handleOpenDetails, handlePrint, setWorkflowDoc, handleDeleteDoc } = actions;
  // v9.0.291 (TD-795): هر گزینه فقط با مجوز API خودش
  const menuItems: ActionMenuItem[] = [
    {
      label: 'چاپ سند / فاکتور رسمی',
      icon: Printer,
      onClick: () => { void handlePrint(doc.id); },
    },
  ];
  if (access.workflow) {
    menuItems.push({
      label: 'چرخه تأییدات و گردش کار',
      icon: GitBranch,
      onClick: () => setWorkflowDoc(doc),
    });
  }
  if (access.void) {
    menuItems.push({
      label: 'ابطال / حذف سند',
      icon: Trash2,
      onClick: () => { void handleDeleteDoc(doc.id, doc.ref_number); },
      variant: 'danger',
    });
  }
  return (
    <td className="p-3 text-center whitespace-nowrap">
      <div className="flex items-center justify-center gap-1">
        {isCommercial && doc.status === 'final' && access.settle && (
          <button 
            onClick={() => setSettlementDoc(doc)} 
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1 font-bold ${
              settlementStatus === 'fully_paid'
                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/60'
                : 'text-white bg-emerald-600 hover:bg-emerald-700 shadow-2xs'
            }`}
            title={settlementStatus === 'fully_paid' ? 'مشاهده سوابق تسویه' : 'تسویه سریع فاکتور'}
          >
            <CreditCard size={13} />
            <span className="text-[10px]">
              {settlementStatus === 'fully_paid' ? 'تسویه‌شده' : 'تسویه سریع'}
            </span>
          </button>
        )}
        <button 
          onClick={() => handleOpenDetails(doc)} 
          className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs transition-colors cursor-pointer"
          title="مشاهده ریز اقلام و ارقام سند"
        >
          <Eye size={14} />
        </button>
        <ActionMenu
          align="left"
          title="عملیات سند"
          items={menuItems}
        />
      </div>
    </td>
  );
}
