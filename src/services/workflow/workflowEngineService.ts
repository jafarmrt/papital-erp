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
import { WorkflowAuthorizationPolicy } from './workflowAuthorizationPolicy.js';
import { WorkflowTaskService } from './workflowTaskService.js';
import { WorkflowDelegationService } from './workflowDelegationService.js';
import { WorkflowEventPublisher } from './workflowEventPublisher.js';
import { WorkflowQuorumService } from './workflowQuorumService.js';
import { logger } from '../../middleware/logger.js';
import { workflowDefinitions, workflowInstances } from '../../db/schema.js';
import type { DbExecutor } from '../../db/drizzle.js';
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
  // --- DSL & Rule Engine Delegation ---
  static getEntityContext = getEntityContext;
  static evaluateConditions = WorkflowRuleEngine.evaluateConditions;

  // --- Authorization & Policy Delegation ---
  static checkUserRoleMatch = WorkflowAuthorizationPolicy.checkUserRoleMatch;
  static getEquivalentRoles = WorkflowAuthorizationPolicy.getEquivalentRoles;
  static authorizeAction = WorkflowAuthorizationPolicy.authorizeAction;

  // --- Definition & Structure Management ---
  static getDefinitions = WorkflowDefinitionService.getDefinitions;
  static getWorkflowDefinitions = WorkflowDefinitionService.getDefinitions;
  static getDefinitionById = WorkflowDefinitionService.getDefinitionById;
  static getDefinitionByCode = WorkflowDefinitionService.getDefinitionByCode;
  static getWorkflowDefinitionDetail = WorkflowDefinitionService.getDefinitionById;
  static createDefinition = WorkflowDefinitionService.createDefinition;
  static updateDefinition = WorkflowDefinitionService.updateDefinition;
  static saveWorkflowDefinition = WorkflowDefinitionService.saveWorkflowDefinition;
  static updateCanvasPositions = WorkflowDefinitionService.updateCanvasPositions;
  static addState = WorkflowDefinitionService.addState;
  static addTransition = WorkflowDefinitionService.addTransition;
  static seedDefaultWorkflows = WorkflowDefinitionService.seedDefaultWorkflows;

  // --- Version History (read-only, TD-112) ---
  static getDefinitionVersions = WorkflowVersionService.getDefinitionVersions;
  static getDefinitionVersionDetail = WorkflowVersionService.getDefinitionVersionDetail;

  // --- SLA & Analytics Delegation ---
  static getSlaAnalytics = WorkflowSlaEvaluator.getSlaAnalytics;
  static evaluateSlaStatus = WorkflowSlaEvaluator.evaluateSlaStatus;
  static getWorkflowAnalytics = WorkflowSlaEvaluator.getWorkflowAnalytics;

  // --- Task & Approval Inbox Management ---
  static getMyTasks = WorkflowTaskService.getMyTasks;
  static getTaskStats = WorkflowTaskService.getTaskStats;
  static getTasksForInstance = WorkflowTaskService.getTasksForInstance;
  static executeTaskById = WorkflowTaskService.executeTaskById;
  static delegateTask = WorkflowTaskService.delegateTask;
  static getPendingApprovalsForUser = WorkflowTaskService.getPendingApprovalsForUser;
  static getApprovalInbox = WorkflowTaskService.getApprovalInbox;
  static processMultiSignApproval = WorkflowApprovalRules.processMultiSignApproval;
  static evaluateAndAddSignature = WorkflowQuorumService.evaluateAndAddSignature;
  static getRequiredSignaturesCount = WorkflowQuorumService.getRequiredSignaturesCount;

  // --- Delegation Management ---
  static createDelegation = WorkflowDelegationService.createDelegation;
  static getDelegations = WorkflowDelegationService.getDelegations;
  static revokeDelegation = WorkflowDelegationService.revokeDelegation;

  // --- Transition Execution Delegation ---
  static getAvailableTransitions = WorkflowTransitionExecutor.getAvailableTransitions;
  static refreshPendingApprovals = WorkflowTransitionExecutor.refreshPendingApprovals;
  static startInstance = WorkflowTransitionExecutor.startInstance;
  static startWorkflow = WorkflowTransitionExecutor.startInstance; // Alias
  static executeTransition = WorkflowTransitionExecutor.executeTransition;
  static checkCanTransition = WorkflowTransitionExecutor.checkCanTransition;
  static getInstanceById = WorkflowTransitionExecutor.getInstanceById;
  static getInstanceByEntity = WorkflowTransitionExecutor.getInstanceByEntity;
  static getWorkflowHistory = WorkflowTransitionExecutor.getWorkflowHistory;

  // --- Event Publishing Delegation ---
  static publishTransitionCompleted = WorkflowEventPublisher.publishTransitionCompleted;
  static publishWorkflowCompleted = WorkflowEventPublisher.publishWorkflowCompleted;
  static publishWorkflowRejected = WorkflowEventPublisher.publishWorkflowRejected;

  /**
   * V2.0.0: شروع شرطی workflow — اگر تعریف فعال/منتشرشده‌ای برای entityType وجود داشته باشد
   * instance ساخته می‌شود؛ در غیر این صورت null (موجودیت بدون workflow مستقیم ادامه می‌دهد).
   * الگوی استفاده: تعریف کالا، حساب خزانه و سایر موجودیت‌های آینده.
   */
  static async maybeStartWorkflow(params: {
    entityType: string;
    entityId: string | number;
    userId?: number;
    userName?: string;
    /** v8.0.77 (TD-324): تراکنش فراخواننده؛ گردش‌کار درون savepoint همان تراکنش شروع می‌شود */
    tx?: DbExecutor;
  }): Promise<typeof workflowInstances.$inferSelect | null> {
    try {
      if (params.tx) {
        // تعریف فعال با همان تراکنش خوانده می‌شود (نه getDefinitions که seed و آمار را روی اتصال جدا می‌خواند)؛ شکست
        // فقط savepoint را برمی‌گرداند و عملیات اصلی ادامه می‌یابد
        return await params.tx.transaction(async (sp) => {
          const [def] = await sp.select({ code: workflowDefinitions.code }).from(workflowDefinitions)
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
            tx: sp
          });
        });
      }
      const defs = await WorkflowDefinitionService.getDefinitions({ isActive: true, entityType: params.entityType });
      if (!defs || defs.length === 0) return null;
      const def = defs[0];
      return await WorkflowTransitionExecutor.startInstance({
        workflowCode: def.code,
        entityType: params.entityType,
        entityId: String(params.entityId),
        userId: params.userId,
        userName: params.userName || 'سیستم'
      });
    } catch (err: unknown) {
      // workflow هرگز نباید عملیات اصلی اصلی را مسدود کند
      logger.warn({ message: `maybeStartWorkflow failed for ${params.entityType}#${params.entityId}`, error: err });
      return null;
    }
  }
}
