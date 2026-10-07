import { 
  WorkflowRuleEngine, 
  getEntityContext, 
  WorkflowConditionRule, 
  WorkflowRuleGroup, 
  RuleEvaluationResult 
} from './workflowDslParser.js';
import { WorkflowSlaEvaluator } from './workflowSlaEvaluator.js';
import { WorkflowApprovalRules } from './workflowApprovalRules.js';
import { WorkflowTransitionExecutor } from './workflowTransitionExecutor.js';
import { WorkflowDefinitionService } from './workflowDefinitionService.js';
import { WorkflowVersionService } from './workflowVersionService.js';
import { WorkflowTaskService } from './workflowTaskService.js';
import { WorkflowDelegationService } from './workflowDelegationService.js';
import { WorkflowEventPublisher } from './workflowEventPublisher.js';
import { WorkflowQuorumService } from './workflowQuorumService.js';
import { workflowDefinitions, workflowInstances } from '../../db/schema.js';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { and, asc, eq } from 'drizzle-orm';

export { WorkflowRuleEngine, WorkflowQuorumService };
export type { 
  WorkflowConditionRule, 
  WorkflowRuleGroup, 
  RuleEvaluationResult 
};

/**
 * WorkflowEngineService Facade
 * Provides a unified static interface delegating calls to 10 decoupled sub-services.
 * Guarantees 100% backward compatibility for routes, test suites, and internal caller modules.
 */
export class WorkflowEngineService {
  // v9.0.43 (TD-450، یافته B14-08): هر متد نما به کلاس خودش bind می‌شود؛ پیش‌تر متد ایستا بی bind کپی می‌شد و `this`
  // درون آن نما بود: «تحلیل مهلت انجام» همیشه ۵۰۰ «this.getReopenedTasksReport is not a function» می‌داد.
  // --- DSL & Rule Engine Delegation ---
  static getEntityContext = getEntityContext;
  static evaluateConditions = WorkflowRuleEngine.evaluateConditions.bind(WorkflowRuleEngine);

  // --- Authorization & Policy Delegation ---
  // v9.0.111 (TD-542): همان قاعده موتور؛ پیاده‌سازی دوم با جدول هم‌ارزی دیگر (workflowAuthorizationPolicy) حذف شد
  static checkUserRoleMatch = WorkflowTransitionExecutor.checkUserRoleMatch.bind(WorkflowTransitionExecutor);

  // --- Definition & Structure Management ---
  static getDefinitions = WorkflowDefinitionService.getDefinitions.bind(WorkflowDefinitionService);
  static getWorkflowDefinitions = WorkflowDefinitionService.getDefinitions.bind(WorkflowDefinitionService);
  static getDefinitionById = WorkflowDefinitionService.getDefinitionById.bind(WorkflowDefinitionService);
  static getDefinitionByCode = WorkflowDefinitionService.getDefinitionByCode.bind(WorkflowDefinitionService);
  static getWorkflowDefinitionDetail = WorkflowDefinitionService.getDefinitionById.bind(WorkflowDefinitionService);
  static createDefinition = WorkflowDefinitionService.createDefinition.bind(WorkflowDefinitionService);
  static updateDefinition = WorkflowDefinitionService.updateDefinition.bind(WorkflowDefinitionService);
  static saveWorkflowDefinition = WorkflowDefinitionService.saveWorkflowDefinition.bind(WorkflowDefinitionService);
  static updateCanvasPositions = WorkflowDefinitionService.updateCanvasPositions.bind(WorkflowDefinitionService);
  static addState = WorkflowDefinitionService.addState.bind(WorkflowDefinitionService);
  static addTransition = WorkflowDefinitionService.addTransition.bind(WorkflowDefinitionService);
  static seedDefaultWorkflows = WorkflowDefinitionService.seedDefaultWorkflows.bind(WorkflowDefinitionService);

  // --- Version History (read-only, TD-112) ---
  static getDefinitionVersions = WorkflowVersionService.getDefinitionVersions.bind(WorkflowVersionService);
  static getDefinitionVersionDetail = WorkflowVersionService.getDefinitionVersionDetail.bind(WorkflowVersionService);

  // --- SLA & Analytics Delegation ---
  static getSlaAnalytics = WorkflowSlaEvaluator.getSlaAnalytics.bind(WorkflowSlaEvaluator);
  static evaluateSlaStatus = WorkflowSlaEvaluator.evaluateSlaStatus.bind(WorkflowSlaEvaluator);
  static getWorkflowAnalytics = WorkflowSlaEvaluator.getWorkflowAnalytics.bind(WorkflowSlaEvaluator);

  // --- Task & Approval Inbox Management ---
  static getMyTasks = WorkflowTaskService.getMyTasks.bind(WorkflowTaskService);
  static getTaskStats = WorkflowTaskService.getTaskStats.bind(WorkflowTaskService);
  static getTasksForInstance = WorkflowTaskService.getTasksForInstance.bind(WorkflowTaskService);
  static executeTaskById = WorkflowTaskService.executeTaskById.bind(WorkflowTaskService);
  static delegateTask = WorkflowTaskService.delegateTask.bind(WorkflowTaskService);
  static processMultiSignApproval = WorkflowApprovalRules.processMultiSignApproval.bind(WorkflowApprovalRules);
  static evaluateAndAddSignature = WorkflowQuorumService.evaluateAndAddSignature.bind(WorkflowQuorumService);
  static getRequiredSignaturesCount = WorkflowQuorumService.getRequiredSignaturesCount.bind(WorkflowQuorumService);

  // --- Delegation Management ---
  static createDelegation = WorkflowDelegationService.createDelegation.bind(WorkflowDelegationService);
  static getDelegations = WorkflowDelegationService.getDelegations.bind(WorkflowDelegationService);
  static revokeDelegation = WorkflowDelegationService.revokeDelegation.bind(WorkflowDelegationService);

  // --- Transition Execution Delegation ---
  static getAvailableTransitions = WorkflowTransitionExecutor.getAvailableTransitions.bind(WorkflowTransitionExecutor);
  static refreshPendingApprovals = WorkflowTransitionExecutor.refreshPendingApprovals.bind(WorkflowTransitionExecutor);
  static startInstance = WorkflowTransitionExecutor.startInstance.bind(WorkflowTransitionExecutor);
  static startWorkflow = WorkflowTransitionExecutor.startInstance.bind(WorkflowTransitionExecutor); // Alias
  static executeTransition = WorkflowTransitionExecutor.executeTransition.bind(WorkflowTransitionExecutor);
  static checkCanTransition = WorkflowTransitionExecutor.checkCanTransition.bind(WorkflowTransitionExecutor);
  static getInstanceById = WorkflowTransitionExecutor.getInstanceById.bind(WorkflowTransitionExecutor);
  static getInstanceByEntity = WorkflowTransitionExecutor.getInstanceByEntity.bind(WorkflowTransitionExecutor);
  static getWorkflowHistory = WorkflowTransitionExecutor.getWorkflowHistory.bind(WorkflowTransitionExecutor);

  // --- Event Publishing Delegation ---
  static publishTransitionCompleted = WorkflowEventPublisher.publishTransitionCompleted.bind(WorkflowEventPublisher);
  static publishWorkflowCompleted = WorkflowEventPublisher.publishWorkflowCompleted.bind(WorkflowEventPublisher);
  static publishWorkflowRejected = WorkflowEventPublisher.publishWorkflowRejected.bind(WorkflowEventPublisher);

  /**
   * V2.0.0: شروع شرطی workflow — اگر تعریف فعالی برای entityType وجود داشته باشد instance ساخته می‌شود؛ در غیر این صورت
   * null (موجودیت بدون workflow مستقیم ادامه می‌دهد). الگوی استفاده: تعریف کالا، حساب خزانه و سایر موجودیت‌های آینده.
   *
   * v9.0.36 (TD-451، یافته B14-09): فقط «تعریف فعالی نیست» null است؛ خطای شروع (تعریف بی گام آغازین، خطای اتصال یا
   * تصویر) پرتاب می‌شود و عملیات اصلی را رد می‌کند. پیش‌تر خطا بلعیده می‌شد و فراخواننده آن را «بی گردش‌کار» می‌فهمید:
   * سند افتتاحیه حساب خزانه و کالا بی تأیید صادر می‌شد. تعریف فعال با همان اتصال خوانده می‌شود، بی seed.
   */
  static async maybeStartWorkflow(params: {
    entityType: string;
    entityId: string | number;
    userId?: number;
    userName?: string;
    /** v8.0.77 (TD-324): تراکنش فراخواننده؛ گردش‌کار درون savepoint همان تراکنش شروع می‌شود */
    tx?: DbExecutor;
  }): Promise<typeof workflowInstances.$inferSelect | null> {
    const start = async (db: DbExecutor) => {
      const [def] = await db.select({ code: workflowDefinitions.code }).from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.entityType, params.entityType), eq(workflowDefinitions.isActive, 1)))
        .orderBy(asc(workflowDefinitions.id))
        .limit(1);
      if (!def) return null;
      return WorkflowTransitionExecutor.startInstance({
        workflowCode: def.code,
        entityType: params.entityType,
        entityId: String(params.entityId),
        userId: params.userId,
        userName: params.userName || 'سیستم',
        tx: db
      });
    };
    return params.tx ? params.tx.transaction(start) : orm.transaction(start);
  }
}
