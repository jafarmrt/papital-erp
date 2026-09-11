import { orm } from '../../db/drizzle';
import { 
  workflowDefinitions, 
  workflowDefinitionVersions,
  workflowStates, 
  workflowTransitions, 
  workflowInstances, 
  workflowPendingApprovals, 
  workflowHistoryLogs,
  workflowTasks
} from '../../db/schema';
import { eq, and, or, inArray, desc } from 'drizzle-orm';
import { workflowEventBus } from './workflowEventBus';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../errors/customErrors';
import { domainEventBus } from '../events/domainEventBus';
import { DomainEventType, AggregateType } from '../events/domainEvents';
import { OutboxService } from '../events/outboxService';
import { logger } from '../../middleware/logger';
import { updateRequestContext } from '../../lib/requestContext.js';
import { WorkflowRuleEngine, getEntityContext } from './workflowDslParser';
import { WorkflowQuorumService } from './workflowQuorumService';
import { WorkflowDefinitionService } from './workflowDefinitionService';

type DbClient = typeof orm | Parameters<Parameters<typeof orm.transaction>[0]>[0];

export interface WorkflowStateSnapshot {
  id: number;
  workflowDefinitionId?: number;
  stateKey: string;
  title: string;
  stateType: string;
  slaHours?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  isDeleted?: number;
}

export interface WorkflowTransitionSnapshot {
  id: number;
  workflowDefinitionId?: number;
  fromStateId: number;
  toStateId: number;
  actionKey: string;
  title: string;
  requiredRole?: string | null;
  ruleConditionsJson?: unknown;
  approvalRuleType?: string | null;
  kValue?: number | null;
  autoActionKey?: string | null;
  isDeleted?: number;
}

export interface WorkflowSnapshotDsl {
  definitionId?: number;
  code?: string;
  title?: string;
  entityType?: string;
  version?: number;
  states?: WorkflowStateSnapshot[];
  transitions?: WorkflowTransitionSnapshot[];
  publishedAt?: string;
}

export interface WorkflowDefinitionRow {
  id: number;
  code: string;
  title: string;
  entityType: string;
  description?: string | null;
  version: number;
  isActive: number;
  dslJson?: unknown;
}

export class WorkflowTransitionExecutor {
  /**
   * Helper: Find equivalent roles
   */
  static getEquivalentRoles(roleName: string): string[] {
    const r = (roleName || '').trim().toLowerCase();
    const res = new Set<string>([r]);
    if (r === 'admin') {
      res.add('*');
      res.add('all');
      res.add('warehouse');
      res.add('warehouse_keeper');
      res.add('accounting');
      res.add('accountant');
      res.add('cfo_accountant');
      res.add('sales');
      res.add('sales_manager');
      res.add('production');
      res.add('production_manager');
      res.add('procurement_officer');
      res.add('manager');
    } else if (r === 'warehouse' || r === 'warehouse_keeper') {
      res.add('warehouse');
      res.add('warehouse_keeper');
    } else if (r === 'accounting' || r === 'accountant' || r === 'cfo_accountant') {
      res.add('accounting');
      res.add('accountant');
      res.add('cfo_accountant');
    } else if (r === 'sales' || r === 'sales_manager') {
      res.add('sales');
      res.add('sales_manager');
    } else if (r === 'production' || r === 'production_manager') {
      res.add('production');
      res.add('production_manager');
      res.add('manager');
    }
    return Array.from(res);
  }

  /**
   * Check if a user's role or granular permissions satisfy a required transition role
   */
  static checkUserRoleMatch(userRole?: string, requiredRole?: string, userPermissions: string[] = []): boolean {
    if (!requiredRole || requiredRole === '' || requiredRole === '*' || requiredRole === 'ALL') {
      return true;
    }
    const uRole = (userRole || '').trim().toLowerCase();
    const rRole = (requiredRole || '').trim().toLowerCase();

    if (
      uRole === 'admin' || 
      userPermissions.includes('workflow.admin') || 
      userPermissions.includes('workflow.manage') || 
      userPermissions.includes('*')
    ) {
      return true;
    }

    if (userPermissions.includes(requiredRole) || userPermissions.includes(rRole)) {
      return true;
    }

    const equivalentRoles = this.getEquivalentRoles(uRole);
    if (equivalentRoles.some(eqR => eqR.toLowerCase() === rRole)) {
      return true;
    }

    if (rRole === 'warehouse' || rRole === 'warehouse_keeper') {
      if (userPermissions.includes('warehouse.in') || userPermissions.includes('warehouse.out') || userPermissions.includes('warehouse.view')) return true;
    }
    if (rRole === 'accounting' || rRole === 'accountant' || rRole === 'cfo_accountant') {
      if (userPermissions.includes('accounting.vouchers') || userPermissions.includes('accounting.view') || userPermissions.includes('accounting.treasury')) return true;
    }
    if (rRole === 'sales' || rRole === 'sales_manager') {
      if (userPermissions.includes('documents.create') || userPermissions.includes('crm.manage')) return true;
    }
    if (rRole === 'production' || rRole === 'production_manager' || rRole === 'manager') {
      if (userPermissions.includes('projects.edit') || userPermissions.includes('projects.create')) return true;
    }

    return false;
  }

  /**
   * Get valid transitions from a state for a specific user role, permissions, and JSON rule evaluation
   */
  static async getAvailableTransitions(
    instanceId: number, 
    currentStateId: number, 
    userRole?: string, 
    userId?: number,
    snapshotTransitions?: WorkflowTransitionSnapshot[],
    entityContext?: Record<string, unknown>,
    txExecutor: DbClient = orm,
    userPermissions: string[] = []
  ) {
    let transitions: WorkflowTransitionSnapshot[] = [];

    if (snapshotTransitions && Array.isArray(snapshotTransitions) && snapshotTransitions.length > 0) {
      transitions = snapshotTransitions.filter((t: WorkflowTransitionSnapshot) => t.fromStateId === currentStateId);
    } else {
      transitions = await txExecutor.select()
        .from(workflowTransitions)
        .where(eq(workflowTransitions.fromStateId, currentStateId));
    }

    let filtered = transitions.filter(t => {
      return this.checkUserRoleMatch(userRole, t.requiredRole || undefined, userPermissions);
    });

    if (entityContext) {
      filtered = filtered.filter(t => {
        return WorkflowRuleEngine.evaluateConditions(t.ruleConditionsJson, entityContext);
      });
    }

    return filtered;
  }

  /**
   * Refresh pending approvals & tasks when instance state advances
   */
  static async refreshPendingApprovals(instanceId: number, newStateId: number, workflowDefinitionId: number, txExecutor: DbClient = orm) {
    // 1. Delete previous pending approvals & cancel pending tasks for prior states
    await txExecutor.delete(workflowPendingApprovals).where(eq(workflowPendingApprovals.instanceId, instanceId));
    await txExecutor.update(workflowTasks)
      .set({ status: 'canceled', completedAt: new Date().toISOString() })
      .where(and(
        eq(workflowTasks.instanceId, instanceId),
        eq(workflowTasks.status, 'pending')
      ));

    // 2. Fetch state details for SLA dueAt calculation
    const [newState] = await txExecutor.select().from(workflowStates).where(eq(workflowStates.id, newStateId));
    let dueAt: string | null = null;
    if (newState && newState.slaHours && newState.slaHours > 0) {
      dueAt = new Date(Date.now() + newState.slaHours * 3600 * 1000).toISOString();
    }

    // 3. Fetch outgoing transitions
    const transitions = await txExecutor.select()
      .from(workflowTransitions)
      .where(and(
        eq(workflowTransitions.workflowDefinitionId, workflowDefinitionId),
        eq(workflowTransitions.fromStateId, newStateId)
      ));

    for (const tr of transitions) {
      await txExecutor.insert(workflowPendingApprovals).values({
        instanceId,
        transitionId: tr.id,
        assignedRole: tr.requiredRole || '',
        createdAt: new Date().toISOString()
      });

      // Also create corresponding workflow task
      await txExecutor.insert(workflowTasks).values({
        instanceId,
        transitionId: tr.id,
        assignedRole: tr.requiredRole || '',
        candidateRoles: tr.requiredRole ? [tr.requiredRole] : ['ALL'],
        candidateUsers: [],
        status: 'pending',
        title: tr.title || 'بررسی و تایید مرحله فرآیند',
        description: `وظیفه جهت اقدام «${tr.title}» در فرآیند شماره #${instanceId}`,
        dueAt,
        createdAt: new Date().toISOString()
      });
    }
  }

  /**
   * Start a new workflow instance with immutable snapshot DSL from explicit published version
   */
  static async startInstance(params: {
    workflowDefinitionId?: number;
    workflowCode?: string;
    definitionVersion?: number;
    entityType: string;
    entityId: string;
    userId?: number;
    userName?: string;
  }) {
    return await orm.transaction(async (tx) => {
      let def: WorkflowDefinitionRow | undefined;
      if (params.workflowCode) {
        [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, params.workflowCode));
      } else if (params.workflowDefinitionId) {
        [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, params.workflowDefinitionId));
      }

      if (!def) {
        [def] = await tx.select().from(workflowDefinitions).where(and(
          eq(workflowDefinitions.entityType, params.entityType),
          eq(workflowDefinitions.isActive, 1)
        ));
      }

      if (!def) {
        // Fallback: auto-seed default workflows if missing
        await WorkflowDefinitionService.seedDefaultWorkflows();
        if (params.workflowCode) {
          [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, params.workflowCode));
        } else if (params.workflowDefinitionId) {
          [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, params.workflowDefinitionId));
        }
        if (!def) {
          [def] = await tx.select().from(workflowDefinitions).where(and(
            eq(workflowDefinitions.entityType, params.entityType),
            eq(workflowDefinitions.isActive, 1)
          ));
        }
      }

      if (!def) {
        throw new NotFoundError(`هیچ فرآیند کاری فعال برای موجودیت '${params.entityType}' پیدا نشد.`);
      }

      // Check if instance already exists
      const [existing] = await tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.workflowDefinitionId, def.id),
        eq(workflowInstances.entityType, params.entityType),
        eq(workflowInstances.entityId, String(params.entityId))
      ));

      if (existing && existing.status === 'IN_PROGRESS') {
        return existing;
      }

      const targetVersionNumber = params.definitionVersion || def.version || 1;

      // Query explicit published version snapshot from workflowDefinitionVersions
      const [versionSnapshotEntry] = await tx.select().from(workflowDefinitionVersions).where(and(
        eq(workflowDefinitionVersions.definitionId, def.id),
        eq(workflowDefinitionVersions.version, targetVersionNumber)
      ));

      let snapshotDsl: WorkflowSnapshotDsl;

      if (versionSnapshotEntry && versionSnapshotEntry.dslJson) {
        snapshotDsl = versionSnapshotEntry.dslJson as WorkflowSnapshotDsl;
      } else {
        // Fallback: build snapshot DSL from active states & transitions and persist as published version entry
        const allStates = await tx.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, def.id));
        const allTransitions = await tx.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, def.id));

        snapshotDsl = {
          definitionId: def.id,
          code: def.code,
          title: def.title,
          entityType: def.entityType,
          version: targetVersionNumber,
          states: allStates,
          transitions: allTransitions,
          publishedAt: new Date().toISOString()
        };

        // Auto-persist missing version snapshot
        await tx.insert(workflowDefinitionVersions).values({
          definitionId: def.id,
          version: targetVersionNumber,
          title: def.title,
          description: `نسخه اولیه تولیدشده سیستمی (${targetVersionNumber})`,
          dslJson: snapshotDsl,
          createdBy: params.userId || null,
          createdAt: new Date().toISOString()
        });
      }

      // Fetch initial state (prefer snapshotDsl states if available)
      let initialStateId: number | null = null;
      if (snapshotDsl.states && Array.isArray(snapshotDsl.states)) {
        const initSt = snapshotDsl.states.find((s: WorkflowStateSnapshot) => s.stateType === 'initial');
        if (initSt) initialStateId = initSt.id;
      }

      if (!initialStateId) {
        const [initialState] = await tx.select().from(workflowStates).where(and(
          eq(workflowStates.workflowDefinitionId, def.id),
          eq(workflowStates.stateType, 'initial')
        ));
        if (initialState) initialStateId = initialState.id;
      }

      if (!initialStateId) {
        throw new ValidationError('وضعیت اولیه (Initial State) برای این چرخه تعیین نشده است');
      }

      const [newInstance] = await tx.insert(workflowInstances).values({
        workflowDefinitionId: def.id,
        definitionVersion: targetVersionNumber,
        entityType: params.entityType,
        entityId: String(params.entityId),
        currentStateId: initialStateId,
        status: 'IN_PROGRESS',
        snapshotDsl,
        startedBy: params.userId || null,
        startedByName: params.userName || 'سیستم',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }).returning();

      await this.refreshPendingApprovals(newInstance.id, initialStateId, def.id, tx);

      await tx.insert(workflowHistoryLogs).values({
        instanceId: newInstance.id,
        toStateId: initialStateId,
        performedBy: params.userId || null,
        performedByName: params.userName || 'سیستم',
        actionKey: 'START_WORKFLOW',
        actionTitle: 'شروع فرآیند کاری',
        comment: `چرخه کاری '${def.title}' (نسخه ${targetVersionNumber}) آغاز گردید`
      });

      return newInstance;
    });
  }

  /**
   * Execute state transition
   */
  static async executeTransition(params: {
    instanceId: number;
    transitionId: number;
    userId?: number;
    userName?: string;
    userRole?: string;
    userPermissions?: string[];
    comment?: string;
    snapshotData?: Record<string, unknown>;
    tx?: DbClient;
  }) {
    const runInTx = async (tx: DbClient) => {
      const [instance] = await tx.select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, params.instanceId))
        .for('update');

      if (!instance) {
        throw new NotFoundError('نمونه ورکفلو یافت نشد');
      }

      if (instance.status !== 'IN_PROGRESS') {
        throw new ConflictError('این چرخه کاری قبلاً خاتمه یافته یا نهایی شده است');
      }

      updateRequestContext({
        workflowId: String(instance.id),
        entityId: `${instance.entityType}:${instance.entityId}`,
        userId: params.userId
      });

      const snapshot = instance.snapshotDsl as WorkflowSnapshotDsl | null;
      let transition: WorkflowTransitionSnapshot | undefined;
      let fromState: WorkflowStateSnapshot | undefined;
      let toState: WorkflowStateSnapshot | undefined;
      let definition: { id: number; code?: string; title?: string } | undefined;

      if (snapshot && Array.isArray(snapshot.transitions) && snapshot.transitions.length > 0) {
        transition = snapshot.transitions.find((t: WorkflowTransitionSnapshot) => t.id === params.transitionId);
        fromState = snapshot.states?.find((s: WorkflowStateSnapshot) => s.id === transition?.fromStateId);
        toState = snapshot.states?.find((s: WorkflowStateSnapshot) => s.id === transition?.toStateId);
        definition = { id: instance.workflowDefinitionId, code: snapshot.code, title: snapshot.title };
      }

      if (!transition) {
        const [dbTransition] = await tx.select().from(workflowTransitions).where(eq(workflowTransitions.id, params.transitionId));
        if (dbTransition) {
          transition = dbTransition;
          const [dbFromState] = await tx.select().from(workflowStates).where(eq(workflowStates.id, dbTransition.fromStateId));
          const [dbToState] = await tx.select().from(workflowStates).where(eq(workflowStates.id, dbTransition.toStateId));
          const [dbDef] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, instance.workflowDefinitionId));
          fromState = dbFromState;
          toState = dbToState;
          if (dbDef) definition = { id: dbDef.id, code: dbDef.code, title: dbDef.title };
        }
      }

      if (!transition) {
        throw new NotFoundError('انتقال (Transition) مورد نظر یافت نشد');
      }

      if (!fromState || !toState) {
        throw new NotFoundError('وضعیت‌های مرتبط با این انتقال یافت نشدند');
      }

      if (transition.fromStateId !== instance.currentStateId) {
        throw new ConflictError('انتقال در نظر گرفته شده با وضعیت فعلی سند مطابقت ندارد');
      }

      const isAuthorized = this.checkUserRoleMatch(params.userRole, transition.requiredRole || undefined, params.userPermissions || []);
      if (!isAuthorized) {
        throw new ForbiddenError(`نقش شما (${params.userRole || 'ناشناس'}) اجازه انجام این انتقال (${transition.title}) را ندارد.`);
      }

      // Authoritative Server-side Entity Context & Rule Evaluation (Subphase 1.3: Never trust client snapshotData for rule conditions)
      const authoritativeContext = await getEntityContext(instance.entityType, instance.entityId, tx);
      if (transition.ruleConditionsJson) {
        const ruleEval = WorkflowRuleEngine.evaluateRuleBreakdown(transition.ruleConditionsJson, authoritativeContext);
        if (!ruleEval.passed) {
          const failedRules = ruleEval.breakdown.filter(b => !b.passed).map(b => `${b.rule.field} ${b.rule.operator} ${b.rule.value} (مقدار واقعی: ${b.actualValue ?? 'خالی'})`);
          throw new ValidationError(`شرایط سیستمی لازم برای اجرای این مرحله احراز نشد: ${failedRules.join('، ')}`);
        }
      }

      // Quorum & Parallel Approval Evaluation (Subphase 7.3)
      const currentProgressMap = (instance.approvalProgressJson as Record<string, {
        approvalRuleType?: string | null;
        kValue?: number | null;
        requiredCount?: number;
        signatures?: Array<{ userId: number; userName?: string; userRole?: string; signedAt: string; comment?: string }>;
        status?: string;
        updatedAt?: string;
      }>) || {};
      const existingTransitionProgress = currentProgressMap[String(transition.id)] || {};
      const existingSignatures = existingTransitionProgress.signatures || [];

      const quorumEval = WorkflowQuorumService.evaluateAndAddSignature({
        approvalRuleType: transition.approvalRuleType as 'SINGLE' | 'AND_ALL' | 'OR_ANY' | 'K_OF_N' | undefined,
        kValue: transition.kValue,
        existingSignatures,
        userId: params.userId || 0,
        userName: params.userName,
        userRole: params.userRole,
        comment: params.comment
      });

      // If user has already signed for this transition
      if (quorumEval.alreadySigned) {
        return {
          instanceId: instance.id,
          transition,
          quorumMet: quorumEval.quorumMet,
          alreadySigned: true,
          message: quorumEval.message,
          signaturesCollected: quorumEval.signaturesCount,
          requiredSignatures: quorumEval.requiredCount
        };
      }

      // Persist updated quorum signatures in approvalProgressJson
      const updatedProgressMap = {
        ...currentProgressMap,
        [String(transition.id)]: {
          approvalRuleType: transition.approvalRuleType,
          kValue: transition.kValue,
          requiredCount: quorumEval.requiredCount,
          signatures: quorumEval.signatures,
          status: quorumEval.quorumMet ? 'FULFILLED' : 'PENDING',
          updatedAt: new Date().toISOString()
        }
      };

      if (!quorumEval.quorumMet) {
        // Quorum not yet met: Record signature and progress without advancing workflow state
        await tx.update(workflowInstances)
          .set({
            approvalProgressJson: updatedProgressMap,
            updatedAt: new Date().toISOString()
          })
          .where(eq(workflowInstances.id, instance.id));

        await tx.insert(workflowHistoryLogs).values({
          instanceId: instance.id,
          fromStateId: fromState.id,
          toStateId: fromState.id, // Remains in current state
          transitionId: transition.id,
          performedBy: params.userId || null,
          performedByName: params.userName || 'کاربر',
          actionKey: `${transition.actionKey}_SIGN`,
          actionTitle: `ثبت امضا (${transition.title})`,
          comment: `امضای کاربر (${params.userName || params.userId}) ثبت گردید. (${quorumEval.signaturesCount} از ${quorumEval.requiredCount} امضا)`,
          snapshotData: { quorum: quorumEval }
        });

        return {
          instanceId: instance.id,
          transition,
          quorumMet: false,
          alreadySigned: false,
          message: quorumEval.message,
          signaturesCollected: quorumEval.signaturesCount,
          requiredSignatures: quorumEval.requiredCount
        };
      }

      // Quorum met: Advance state to toState
      let newStatus = 'IN_PROGRESS';
      if (toState.stateType === 'terminal') {
        newStatus = toState.stateKey === 'rejected' ? 'REJECTED' : 'COMPLETED';
      }

      await tx.update(workflowInstances)
        .set({
          currentStateId: toState.id,
          status: newStatus,
          approvalProgressJson: updatedProgressMap,
          updatedAt: new Date().toISOString()
        })
        .where(eq(workflowInstances.id, instance.id));

      if (newStatus === 'IN_PROGRESS') {
        await this.refreshPendingApprovals(instance.id, toState.id, instance.workflowDefinitionId, tx);
      } else {
        await tx.delete(workflowPendingApprovals).where(eq(workflowPendingApprovals.instanceId, instance.id));
        await tx.update(workflowTasks)
          .set({ status: 'canceled', completedAt: new Date().toISOString() })
          .where(and(
            eq(workflowTasks.instanceId, instance.id),
            eq(workflowTasks.status, 'pending')
          ));
      }

      await tx.insert(workflowHistoryLogs).values({
        instanceId: instance.id,
        fromStateId: fromState.id,
        toStateId: toState.id,
        transitionId: transition.id,
        performedBy: params.userId || null,
        performedByName: params.userName || 'کاربر',
        actionKey: transition.actionKey,
        actionTitle: transition.title,
        comment: params.comment || '',
        snapshotData: params.snapshotData || {}
      });

      const transitionPayload = {
        instanceId: instance.id,
        entityType: instance.entityType,
        entityId: instance.entityId,
        workflowCode: definition?.code || '',
        fromStateId: fromState.id,
        fromStateKey: fromState.stateKey,
        toStateId: toState.id,
        toStateKey: toState.stateKey,
        actionKey: transition.actionKey,
        actionTitle: transition.title,
        autoActionKey: transition.autoActionKey || '',
        performedBy: params.userId,
        performedByName: params.userName,
        comment: params.comment,
        snapshotData: params.snapshotData
      };

      workflowEventBus.emit('TRANSITION_COMPLETED', transitionPayload);

      const workflowOutboxEvent = domainEventBus.createEvent(
        DomainEventType.WORKFLOW_TRANSITIONED,
        instance.entityType as AggregateType,
        String(instance.entityId),
        transitionPayload,
        { userId: params.userId, username: params.userName }
      );

      await OutboxService.recordEvent(tx, workflowOutboxEvent);

      return {
        instanceId: instance.id,
        fromState,
        toState,
        status: newStatus,
        transition
      };
    };

    if (params.tx) {
      return await runInTx(params.tx);
    }
    return await orm.transaction(async (tx) => {
      return await runInTx(tx);
    });
  }

  /**
   * Check if a transition can be performed
   */
  static async checkCanTransition(params: {
    instanceId: number;
    transitionId: number;
    userRole?: string;
    userPermissions?: string[];
  }): Promise<{ allowed: boolean; reason?: string }> {
    const [instance] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, params.instanceId));
    if (!instance || instance.status !== 'IN_PROGRESS') {
      return { allowed: false, reason: 'چرخه کاری فعال نیست' };
    }

    const snapshot = instance.snapshotDsl as WorkflowSnapshotDsl | null;
    let transition: WorkflowTransitionSnapshot | undefined;
    if (snapshot && Array.isArray(snapshot.transitions)) {
      transition = snapshot.transitions.find((t: WorkflowTransitionSnapshot) => t.id === params.transitionId);
    }
    if (!transition) {
      const [dbTr] = await orm.select().from(workflowTransitions).where(eq(workflowTransitions.id, params.transitionId));
      if (dbTr) transition = dbTr;
    }

    if (!transition) {
      return { allowed: false, reason: 'انتقال یافت نشد' };
    }

    if (transition.fromStateId !== instance.currentStateId) {
      return { allowed: false, reason: 'انتقال با وضعیت فعلی مطابقت ندارد' };
    }

    const isAuthorized = this.checkUserRoleMatch(params.userRole, transition.requiredRole || undefined, params.userPermissions || []);
    if (!isAuthorized) {
      return { allowed: false, reason: `نقش شما (${params.userRole}) مجوز لازم را ندارد` };
    }

    // Authoritative Server-side Context & Rule Check (Subphase 1.3)
    if (transition.ruleConditionsJson) {
      const authoritativeContext = await getEntityContext(instance.entityType, instance.entityId);
      const ruleEval = WorkflowRuleEngine.evaluateRuleBreakdown(transition.ruleConditionsJson, authoritativeContext);
      if (!ruleEval.passed) {
        const failedRules = ruleEval.breakdown.filter(b => !b.passed).map(b => `${b.rule.field} ${b.rule.operator} ${b.rule.value}`);
        return { allowed: false, reason: `شرایط لازم برای این انتقال احراز نشده است (${failedRules.join('، ')})` };
      }
    }

    return { allowed: true };
  }

  /**
   * Get Workflow Instance by ID
   */
  static async getInstanceById(instanceId: number) {
    const [inst] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
    if (!inst) return null;

    const history = await orm.select().from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, instanceId)).orderBy(workflowHistoryLogs.createdAt);
    return {
      ...inst,
      history
    };
  }

  /**
   * Get Workflow Instance by Entity Type and Entity ID
   */
  static async getInstanceByEntity(
    entityType: string, 
    entityId: string, 
    userId?: number, 
    userRole?: string, 
    userPermissions: string[] = [],
    txExecutor: DbClient = orm
  ) {
    const [inst] = await txExecutor.select().from(workflowInstances).where(and(
      eq(workflowInstances.entityType, entityType),
      eq(workflowInstances.entityId, String(entityId))
    )).orderBy(desc(workflowInstances.createdAt));

    if (!inst) return null;

    const history = await txExecutor.select().from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, inst.id)).orderBy(workflowHistoryLogs.createdAt);
    
    // Server-side authoritative entity context resolution
    const entityContext = await getEntityContext(entityType, entityId, txExecutor);

    const availableTransitions = await WorkflowTransitionExecutor.getAvailableTransitions(
      inst.id, 
      inst.currentStateId, 
      userRole, 
      userId, 
      (inst.snapshotDsl as WorkflowSnapshotDsl | null)?.transitions, 
      entityContext, 
      txExecutor,
      userPermissions
    );

    return {
      ...inst,
      history,
      availableTransitions,
      entityContext
    };
  }

  /**
   * Get Workflow History Logs
   */
  static async getWorkflowHistory(instanceId: number) {
    return await orm.select().from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, instanceId)).orderBy(workflowHistoryLogs.createdAt);
  }
}
