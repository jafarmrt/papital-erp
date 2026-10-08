import { useHasAnyPermission } from '../../contexts/AuthContext';
import { INVOICE_ROW_ACTION_PERMISSIONS, type InvoiceRowAccess } from '../../lib/invoices/invoiceRowAccess';

/** v9.0.340 (TD-795): کدام دکمه‌های ردیف فهرست اسناد به کاربر جاری نمایش داده شود */
export function useInvoiceRowAccess(): InvoiceRowAccess {
  return {
    settle: useHasAnyPermission(INVOICE_ROW_ACTION_PERMISSIONS.settle),
    editNotes: useHasAnyPermission(INVOICE_ROW_ACTION_PERMISSIONS.editNotes),
    void: useHasAnyPermission(INVOICE_ROW_ACTION_PERMISSIONS.void),
    workflow: useHasAnyPermission(INVOICE_ROW_ACTION_PERMISSIONS.workflow),
  };
}
