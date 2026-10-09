import { registerBankAccountWorkflowAction } from '../accounting/treasury/bankAccountWorkflowAction.js';
import { registerVoucherWorkflowAction } from '../accounting/voucherWorkflowAction.js';
import { registerDocumentWorkflowAction } from '../documents/documentWorkflowAction.js';
import { registerItemOpeningWorkflowAction } from '../inventory/itemOpeningWorkflowAction.js';
import { registerPendingMaterialWorkflowAction } from '../inventory/pendingMaterialWorkflowAction.js';
import { registerRequisitionWorkflowAction } from '../procurement/requisitionWorkflowAction.js';
import { procurementOrderHooks } from '../procurement/requisitionOrderSync.js';
import { registerLinkedOrderHooks } from '../documents/linkedOrderHooks.js';

/**
 * v9.0.2 (TD-415): ریشه ترکیب اقدام‌های پس از انتقال گردش‌کار. server.ts هنگام راه‌اندازی و bootstrapTestMasterData برای
 * اجراکننده آزمون و شبیه‌ساز صدا می‌زنند؛ موتور گردش‌کار خودش هیچ دامنه‌ای را import نمی‌کند (workflowTransitionActions.ts).
 * جانشین registerWorkflowListeners (شنونده‌های workflowEventBus) است.
 */
export function registerWorkflowDomainActions(): void {
  registerDocumentWorkflowAction();
  registerItemOpeningWorkflowAction();
  registerBankAccountWorkflowAction();
  registerVoucherWorkflowAction();
  registerRequisitionWorkflowAction();
  // v9.0.398 (TD-826): approve or reject a raw material request
  registerPendingMaterialWorkflowAction();
  // v10.0.39 / v10.0.40 (TD-912 / TD-913): voiding or editing a procurement order updates its requisition (not a workflow
  // action, but the same composition root: the documents package may not import procurement)
  registerLinkedOrderHooks(procurementOrderHooks);
}
