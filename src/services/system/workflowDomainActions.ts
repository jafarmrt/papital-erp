import { registerBankAccountWorkflowAction } from '../accounting/treasury/bankAccountWorkflowAction.js';
import { registerVoucherWorkflowAction } from '../accounting/voucherWorkflowAction.js';
import { registerDocumentWorkflowAction } from '../documents/documentWorkflowAction.js';
import { registerItemOpeningWorkflowAction } from '../inventory/itemOpeningWorkflowAction.js';
import { registerPendingMaterialWorkflowAction } from '../inventory/pendingMaterialWorkflowAction.js';
import { registerRequisitionWorkflowAction } from '../procurement/requisitionWorkflowAction.js';

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
  // v9.0.379 (TD-826): approve or reject a raw material request
  registerPendingMaterialWorkflowAction();
}
