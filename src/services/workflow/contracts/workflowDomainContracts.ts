/**
 * Workflow Domain Contracts Specification (Subphase 5.1)
 * Strongly-typed domain interfaces, DTOs, invariants, and error contracts
 * for the 10 decoupled sub-modules of the Workflow Engine.
 */

// ============================================================================
// COMMON TYPES & ENUMS
// ============================================================================

export type WorkflowEntityType = 'invoice' | 'purchase' | 'document' | 'payment' | 'payroll' | 'item' | string;

export type WorkflowInstanceStatus = 'DRAFT' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELED' | 'SUSPENDED';

export type TaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DELEGATED' | 'EXPIRED' | 'CANCELED';

export type MultiSignQuorumType = 'SINGLE' | 'AND_ALL' | 'OR_ANY' | 'K_OF_N';

export type WorkflowPermission = 
  | 'workflow.view'
  | 'workflow.execute'
  | 'workflow.approve'
  | 'workflow.manage'
  | 'workflow.admin';

// ============================================================================
// 1. WORKFLOW DEFINITION CONTRACT
// ============================================================================

export interface CreateWorkflowDefinitionInput {
  code: string;
  title: string;
  entityType: WorkflowEntityType;
  description?: string;
  dslJson?: Record<string, any>;
}

export interface UpdateWorkflowDefinitionInput {
  title?: string;
  description?: string;
  isActive?: number;
  dslJson?: Record<string, any>;
}

export interface WorkflowDefinitionDTO {
  id: number;
  code: string;
  title: string;
  entityType: WorkflowEntityType;
  description: string;
  version: number;
  isActive: number;
  dslJson: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export interface IWorkflowDefinitionService {
  /**
   * Retrieves all workflow definitions matching optional filters.
   */
  getDefinitions(filter?: { isActive?: boolean; entityType?: string }): Promise<WorkflowDefinitionDTO[]>;

  /**
   * Retrieves a single workflow definition by numeric ID or string code.
   */
  getDefinitionById(id: number): Promise<WorkflowDefinitionDTO | null>;
  getDefinitionByCode(code: string): Promise<WorkflowDefinitionDTO | null>;

  /**
   * Creates a new workflow definition with initial version 1.
   * Invariant: 'code' must be globally unique.
   */
  createDefinition(input: CreateWorkflowDefinitionInput): Promise<WorkflowDefinitionDTO>;

  /**
   * Updates an existing workflow definition.
   */
  updateDefinition(id: number, input: UpdateWorkflowDefinitionInput): Promise<WorkflowDefinitionDTO>;
}

// ============================================================================
// 2. WORKFLOW VERSION CONTRACT
// ============================================================================

export interface WorkflowVersionDTO {
  id: number;
  definitionId: number;
  version: number;
  title: string;
  description: string;
  dslJson: Record<string, any>;
  createdAt: string;
}

export interface IWorkflowVersionService {
  /**
   * Creates an immutable published version snapshot from a definition dslJson.
   * Invariant: Versions are append-only and strictly immutable once created.
   */
  publishVersion(definitionId: number, title?: string, description?: string): Promise<WorkflowVersionDTO>;

  /**
   * Retrieves a specific version of a workflow definition.
   */
  getVersion(definitionId: number, version: number): Promise<WorkflowVersionDTO | null>;

  /**
   * Lists all historical published versions for a definition.
   */
  getVersionsForDefinition(definitionId: number): Promise<WorkflowVersionDTO[]>;
}

// ============================================================================
// 3. WORKFLOW AUTHORIZATION POLICY CONTRACT
// ============================================================================

export interface UserAuthContext {
  userId: number;
  username: string;
  role: string;
  permissions: string[];
}

export interface IWorkflowAuthorizationPolicy {
  /**
   * Evaluates if a user has permission to execute or approve a specific workflow action.
   * Policy Invariant: Same authorization evaluation logic MUST be used by getAvailableTransitions and executeTransition.
   */
  authorizeAction(
    userCtx: UserAuthContext,
    requiredRole?: string,
    requiredPermissions?: string[],
    actionScope?: WorkflowPermission
  ): boolean;

  /**
   * Evaluates task execution authorization for assigned user, candidate user/role, or valid delegate.
   */
  authorizeTaskExecution(
    userCtx: UserAuthContext,
    task: { assignedUserId?: number | null; candidateRoleKey?: string | null; id: number }
  ): Promise<boolean>;
}

// ============================================================================
// 4. WORKFLOW RULE ENGINE CONTRACT
// ============================================================================

export type RuleOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains';

export interface WorkflowConditionRule {
  field: string;
  operator: RuleOperator;
  value: any;
}

export interface WorkflowRuleGroup {
  combinator: 'AND' | 'OR';
  rules: (WorkflowConditionRule | WorkflowRuleGroup)[];
}

export interface RuleEvaluationResult {
  passed: boolean;
  failedRules: { field: string; operator: string; expected: any; actual: any }[];
  evaluationDetails: string;
}

export interface IWorkflowDslParser {
  /**
   * Dynamically constructs the entity context server-side from PostgreSQL DB & validated models.
   * Invariant: Never trust client-provided snapshotData for financial or security evaluation.
   */
  buildEntityContext(entityType: string, entityId: string): Promise<Record<string, any>>;

  /**
   * Evaluates DSL condition rules against server-constructed context.
   */
  evaluateConditions(
    conditions: WorkflowRuleGroup | WorkflowConditionRule[],
    context: Record<string, any>
  ): RuleEvaluationResult;
}

// ============================================================================
// 5. WORKFLOW TRANSITION EXECUTOR CONTRACT
// ============================================================================

export interface StartInstanceInput {
  workflowCode: string;
  entityType: string;
  entityId: string;
  userId: number;
  initialContext?: Record<string, any>;
}

export interface ExecuteTransitionInput {
  instanceId: number;
  actionKey: string;
  userId: number;
  userRole: string;
  userPermissions?: string[];
  comment?: string;
  payloadData?: Record<string, any>;
}

export interface TransitionExecutionResult {
  success: boolean;
  instanceId: number;
  fromStateKey: string;
  toStateKey: string;
  isCompleted: boolean;
  isRejected: boolean;
  message?: string;
}

export interface AvailableTransitionDTO {
  actionKey: string;
  actionTitle: string;
  fromStateKey: string;
  toStateKey: string;
  requiredRole?: string;
  isAllowed: boolean;
  reason?: string;
}

export interface IWorkflowTransitionExecutor {
  /**
   * Starts a new workflow instance bound to an immutable DSL version snapshot.
   */
  startInstance(input: StartInstanceInput): Promise<{ instanceId: number; currentStateKey: string }>;

  /**
   * Returns all available transitions for an instance given user context.
   */
  getAvailableTransitions(instanceId: number, userCtx: UserAuthContext): Promise<AvailableTransitionDTO[]>;

  /**
   * Atomically executes a workflow transition with row locking and state verification.
   * Invariant: Current State = last committed valid transition state.
   */
  executeTransition(input: ExecuteTransitionInput): Promise<TransitionExecutionResult>;
}

// ============================================================================
// 6. WORKFLOW APPROVAL CONTRACT
// ============================================================================

export interface ProcessMultiSignInput {
  instanceId: number;
  transitionId: number;
  userId: number;
  userRole: string;
  decision: 'APPROVE' | 'REJECT';
  comment?: string;
}

export interface MultiSignResult {
  isQuorumReached: boolean;
  finalDecision?: 'APPROVED' | 'REJECTED';
  approvedCount: number;
  rejectedCount: number;
  requiredCount: number;
}

export interface IWorkflowApprovalRules {
  /**
   * Evaluates multi-sign quorum rules (SINGLE, AND_ALL, OR_ANY, K_OF_N).
   * Invariant: Transaction-safe quorum calculations prevent double-approvals.
   */
  processMultiSignApproval(input: ProcessMultiSignInput): Promise<MultiSignResult>;

  /**
   * Refreshes pending approval records for an instance after a transition.
   */
  refreshPendingApprovals(instanceId: number): Promise<void>;
}

// ============================================================================
// 7. WORKFLOW TASK CONTRACT
// ============================================================================

export interface WorkflowTaskDTO {
  id: number;
  instanceId: number;
  stepKey: string;
  title: string;
  assignedUserId?: number | null;
  candidateRoleKey?: string | null;
  status: TaskStatus;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IWorkflowTaskService {
  /**
   * Retrieves active tasks assigned to a user or user's role/delegation.
   */
  getMyTasks(userId: number, userRole: string, permissions?: string[]): Promise<WorkflowTaskDTO[]>;

  /**
   * Executes a specific workflow task by ID.
   * Invariant: Completed Task -> cannot be executed again.
   */
  executeTaskById(taskId: number, userCtx: UserAuthContext, decision: 'APPROVE' | 'REJECT', comment?: string): Promise<TransitionExecutionResult>;

  /**
   * Returns task statistics for user dashboard.
   */
  getTaskStats(userId: number, userRole: string): Promise<{ pending: number; completed: number; overdue: number }>;
}

// ============================================================================
// 8. WORKFLOW DELEGATION CONTRACT
// ============================================================================

export interface CreateDelegationInput {
  fromUserId: number;
  toUserId: number;
  workflowCode?: string;
  startTime: string;
  endTime: string;
  reason?: string;
}

export interface WorkflowDelegationDTO {
  id: number;
  fromUserId: number;
  toUserId: number;
  workflowCode?: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: string;
}

export interface IWorkflowDelegationService {
  /**
   * Creates a time-bounded delegation rule.
   */
  createDelegation(input: CreateDelegationInput): Promise<WorkflowDelegationDTO>;

  /**
   * Retrieves active delegations for a user during a time window.
   */
  getActiveDelegationsForUser(userId: number): Promise<WorkflowDelegationDTO[]>;

  /**
   * Revokes an existing delegation before its scheduled expiration.
   */
  revokeDelegation(delegationId: number, revokingUserId: number): Promise<boolean>;
}

// ============================================================================
// 9. WORKFLOW SLA EVALUATOR CONTRACT
// ============================================================================

export interface SlaStatusDTO {
  instanceId: number;
  stateKey: string;
  slaHours: number;
  elapsedHours: number;
  isOverdue: boolean;
  remainingHours: number;
}

export interface SlaAnalyticsDTO {
  totalInstances: number;
  activeOverdueInstances: number;
  slaComplianceRate: number;
  bottleneckStates: { stateKey: string; avgHours: number; totalCount: number }[];
}

export interface IWorkflowSlaEvaluator {
  /**
   * Evaluates current SLA status for an active instance.
   */
  evaluateSlaStatus(instanceId: number): Promise<SlaStatusDTO>;

  /**
   * Computes bottleneck states and SLA compliance statistics.
   */
  getSlaAnalytics(workflowCode?: string): Promise<SlaAnalyticsDTO>;
}

// ============================================================================
// 10. WORKFLOW EVENT PUBLISHER CONTRACT
// ============================================================================

export interface WorkflowEventPayload {
  instanceId: number;
  workflowCode: string;
  entityType: string;
  entityId: string;
  fromStateKey: string;
  toStateKey: string;
  actionKey: string;
  actionTitle: string;
  performedBy?: number;
  performedByName?: string;
  comment?: string;
}

export interface IWorkflowEventPublisher {
  /**
   * Emits workflow transition events to local listeners and publishes to the domain event bus.
   * Invariant: Every completed mutation MUST publish a corresponding domain event atomically or via Outbox.
   */
  publishTransitionCompleted(payload: WorkflowEventPayload): Promise<void>;
  publishWorkflowCompleted(payload: WorkflowEventPayload): Promise<void>;
  publishWorkflowRejected(payload: WorkflowEventPayload): Promise<void>;
}

// ============================================================================
// 11. UNIFIED WORKFLOW ENGINE FACADE CONTRACT
// ============================================================================

export interface IWorkflowEngineFacade extends 
  IWorkflowDefinitionService,
  IWorkflowVersionService,
  IWorkflowAuthorizationPolicy,
  IWorkflowDslParser,
  IWorkflowTransitionExecutor,
  IWorkflowApprovalRules,
  IWorkflowTaskService,
  IWorkflowDelegationService,
  IWorkflowSlaEvaluator,
  IWorkflowEventPublisher {
    // Unifies all sub-services for 100% backwards compatibility in Express routes & API handlers.
}
