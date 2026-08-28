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

  // --- Versioning & Rollback ---
  static getDefinitionVersions = WorkflowVersionService.getDefinitionVersions;
  static getDefinitionVersionDetail = WorkflowVersionService.getDefinitionVersionDetail;
  static publishVersion = WorkflowVersionService.publishVersion;
  static rollbackToVersion = WorkflowVersionService.rollbackToVersion;

  // --- SLA & Analytics Delegation ---
  static getSlaAnalytics = WorkflowSlaEvaluator.getSlaAnalytics;
  static evaluateSlaStatus = WorkflowSlaEvaluator.evaluateSlaStatus;
  static getBottleneckAnalytics = WorkflowSlaEvaluator.getBottleneckAnalytics;
  static getSlaComplianceStats = WorkflowSlaEvaluator.getSlaComplianceStats;
  static getWorkflowAnalytics = WorkflowSlaEvaluator.getWorkflowAnalytics;

  // --- Task & Approval Inbox Management ---
  static getMyTasks = WorkflowTaskService.getMyTasks;
  static getTaskStats = WorkflowTaskService.getTaskStats;
  static getTasksForInstance = WorkflowTaskService.getTasksForInstance;
  static executeTaskById = WorkflowTaskService.executeTaskById;
  static delegateTask = WorkflowTaskService.delegateTask;
  static markExpiredTasks = WorkflowTaskService.markExpiredTasks;
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
}
