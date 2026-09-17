import { WorkflowTransitionExecutor } from './workflowTransitionExecutor';

/**
 * V4.0.29 (TD-083): این کلاس یک کپی دوردیفیِ ~۵۰۰ خطی از WorkflowTaskService /
 * WorkflowDelegationService بود که هیچ مصرف‌کننده‌ای به‌جز processMultiSignApproval
 * نداشت (facade همه متدها را به سرویس‌های اصلی متصل می‌کند). کپی مرده حذف شد تا
 * واگرایی منطق تسک‌ها (صفحه‌بندی، markExpiredTasks، خطاهای تایپ‌دار) رخ ندهد.
 * نگه‌داشتن alias زیر صرفاً برای سازگاری facade و قرارداد دامنه است.
 */
export class WorkflowApprovalRules {
  /**
   * Process Multi-Signature / Parallel Approvals
   */
  static async processMultiSignApproval(params: {
    instanceId: number;
    transitionId: number;
    userId?: number;
    userName?: string;
    userRole?: string;
    comment?: string;
    snapshotData?: Record<string, unknown>;
  }) {
    return await WorkflowTransitionExecutor.executeTransition(params);
  }
}
