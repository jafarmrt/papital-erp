import { orm } from '../../db/drizzle';
import { 
  workflowDefinitions, 
  workflowDefinitionVersions,
  workflowStates, 
  workflowTransitions, 
  workflowInstances, 
  workflowPendingApprovals, 
  workflowHistoryLogs,
  workflowTasks,
  users,
  roles
} from '../../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../errors/customErrors';
import { domainEventBus } from '../events/domainEventBus';
import { DomainEventType, AggregateType } from '../events/domainEvents';
import { OutboxService } from '../events/outboxService';
import { updateRequestContext } from '../../lib/requestContext.js';
import { logActivity } from '../../lib/auditLogger.js';
import { WorkflowRuleEngine, getEntityContext } from './workflowDslParser';
import { WorkflowQuorumService } from './workflowQuorumService';
import { WorkflowDelegationService, type ActingDelegation } from './workflowDelegationService.js';
import { ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { lockWorkflowEntity, runWorkflowTransitionAction, workflowActionPermissions, workflowEntityExists } from './workflowTransitionActions.js';
import { buildDefinitionSnapshot, isUsableSnapshot, snapshotTransitionsOf } from './workflowSnapshot.js';
import { describeUnmetWorkflowRule, describeWorkflowRule } from '../../lib/workflowRuleText.js';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels.js';
import type { RuleExpression } from '../ruleEngine.service.js';
import { isSystemAdminRole, permissionDefinition } from '../../lib/permissions/permissionCatalog.js';
import { STOCK_BACKDATE_PERMISSION } from '../../lib/permissions/documentPermissions.js';

type DbClient = typeof orm | Parameters<Parameters<typeof orm.transaction>[0]>[0];

export interface WorkflowStateSnapshot {
  id: number;
  workflowDefinitionId?: number;
  stateKey: string;
  title: string;
  stateType?: string | null;
  slaHours?: number | null;
  stepOrder?: number | null;
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
  requiredPermission?: string | null;
  isInitiatorExcluded?: number | null;
  isInitiatorOnly?: number | null;
  ruleConditionsJson?: unknown;
  approvalRuleType?: string | null;
  kValue?: number | null;
  autoActionKey?: string | null;
  isDeleted?: number;
}

/** v7.0.89 (TD-085): متن فارسی شرط‌های یک اقدام */
export interface WorkflowTransitionConditionText {
  conditions: string[];
  conditionsMatch: 'AND' | 'OR';
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
  version?: number | null;
  isActive?: number | null;
  dslJson?: unknown;
}

/** گام‌هایی که پایان موفق یا رد فرایند را منتشر می‌کنند (همان شرط پل درون‌فرایندی پیش از v9.0.2) */
const WORKFLOW_COMPLETED_STATE_KEYS = new Set(['approved', 'final', 'completed']);
const WORKFLOW_REJECTED_STATE_KEYS = new Set(['rejected', 'canceled']);

export class WorkflowTransitionExecutor {
  /**
   * نقش گام: نقش مشخصی که طراح از فهرست نقش‌ها برگزیده است، یا خالی / `*` / `ALL` برای همه. مدیر سیستم همه گام‌ها را
   * امضا می‌کند و هر کاربر دیگر فقط وقتی نقشش همان نقش است؛ «چه کسی» را مجوز لازم انتقال می‌گوید
   * (`holdsRequiredPermission`). v9.0.128 (TD-542، یافته B02-27، مدل مجوز §۴.۲): پیش‌تر جدول ثابت هم‌ارزی کدها
   * (accountant = cfo_accountant و …)، مجوز ثبت هر بخش و `*` هم گام نقش را باز می‌کردند و نقش سفارشی هیچ‌کدام را نداشت.
   */
  static checkUserRoleMatch(userRole?: string, requiredRole?: string): boolean {
    if (!requiredRole || requiredRole === '' || requiredRole === '*' || requiredRole === 'ALL') {
      return true;
    }
    if (isSystemAdminRole(userRole)) return true;
    return (userRole || '').trim().toLowerCase() === requiredRole.trim().toLowerCase();
  }

  /**
   * v9.0.34 (TD-444): مجوزهای امضاکننده = مجوزهای نقش او که موتور خودش با همان اتصال از جدول نقش‌ها می‌خواند، به‌اضافه
   * آنچه فراخواننده داده است. پیش‌تر موتور فقط req.user.permissions را می‌گرفت که هرگز پر نمی‌شود (توکن مجوز ندارد)، پس
   * قاعده «مجوز ثبت همان بخش» (TD-374) از هیچ مسیری اجرا نمی‌شد و کارتابل و ویجت سند دو جواب می‌دادند.
   */
  static async signerPermissions(userRole: string | undefined, given: string[] | undefined, txExecutor: DbClient = orm): Promise<string[]> {
    const role = (userRole || '').trim().toLowerCase();
    const own = Array.isArray(given) ? given : [];
    if (!role) return own;
    const [roleRow] = await txExecutor.select({ permissions: roles.permissions }).from(roles)
      .where(sql`lower(${roles.code}) = ${role}`);
    const rolePermissions = Array.isArray(roleRow?.permissions) ? (roleRow.permissions as string[]) : [];
    return Array.from(new Set([...rolePermissions, ...own]));
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
      return WorkflowTransitionExecutor.checkUserRoleMatch(userRole, t.requiredRole || undefined);
    });
    // v8.0.100 (TD-391): انتقالی که مجوز لازمش را کاربر ندارد پیشنهاد نمی‌شود
    const permitted: WorkflowTransitionSnapshot[] = [];
    for (const t of filtered) {
      if (await WorkflowTransitionExecutor.holdsRequiredPermission(t, { role: userRole, permissions: userPermissions, ownPermissions: true }, txExecutor)) permitted.push(t);
    }
    filtered = permitted;
    // v8.0.102 (TD-392): انتقالی که آغازکننده را کنار می‌گذارد به آغازکننده پیشنهاد نمی‌شود
    // v10.0.85 (TD-1220): انتقال «فقط آغازکننده» فقط به آغازکننده پیشنهاد می‌شود
    if (filtered.some(t => Number(t.isInitiatorExcluded) === 1 || Number(t.isInitiatorOnly) === 1)) {
      const [inst] = await txExecutor.select({ startedBy: workflowInstances.startedBy }).from(workflowInstances).where(eq(workflowInstances.id, instanceId));
      const signer = { userId, actorId: userId, role: userRole };
      filtered = filtered.filter(t => !WorkflowTransitionExecutor.initiatorExcluded(t, inst?.startedBy, signer)
        && !WorkflowTransitionExecutor.initiatorOnlyRefused(t, inst?.startedBy, signer));
    }

    if (entityContext) {
      filtered = filtered.filter(t => {
        return WorkflowRuleEngine.evaluateConditions(t.ruleConditionsJson as any, entityContext);
      });
    }

    return filtered;
  }

  /**
   * v8.0.90 (TD-370): انتقال‌های یک گام فرایند از تصویر نسخه خود فرایند (یا جدول‌های جاری وقتی تصویر قابل استفاده نیست)
   */
  static async transitionsFromState(
    instance: { workflowDefinitionId: number; snapshotDsl: unknown },
    stateId: number,
    txExecutor: DbClient = orm
  ): Promise<WorkflowTransitionSnapshot[]> {
    const snapshotTransitions = snapshotTransitionsOf(instance.snapshotDsl);
    const transitions = snapshotTransitions
      ?? await txExecutor.select().from(workflowTransitions).where(and(
        eq(workflowTransitions.workflowDefinitionId, instance.workflowDefinitionId),
        eq(workflowTransitions.fromStateId, stateId)
      ));
    return transitions.filter(t => t.fromStateId === stateId).sort((a, b) => a.id - b.id);
  }

  /**
   * v8.0.100 (TD-391، تصمیم مالک محصول «بررسی شود»): مجوز لازم انتقال. انتقالی که «مجوز لازم» دارد فقط برای کسی است که
   * علاوه بر نقش گام آن مجوز را دارد (ادمین همیشه). امضای جانشین با مجوزهای نقش تفویض‌کننده سنجیده می‌شود. مجوزهای
   * نقش با همان اتصال تراکنش خوانده می‌شوند. پیش‌تر این ستون ذخیره می‌شد ولی هیچ‌جا سنجیده نمی‌شد.
   */
  static async holdsRequiredPermission(
    transition: Pick<WorkflowTransitionSnapshot, 'requiredPermission'>,
    signer: { role?: string; permissions?: string[]; ownPermissions: boolean },
    txExecutor: DbClient = orm
  ): Promise<boolean> {
    const permission = (transition.requiredPermission || '').trim();
    if (!permission) return true;
    const role = (signer.role || '').trim().toLowerCase();
    if (isSystemAdminRole(role)) return true;
    const held = (list: string[]) => list.includes(permission);
    if (signer.ownPermissions && held(signer.permissions || [])) return true;
    if (!role) return false;
    const [roleRow] = await txExecutor.select({ permissions: roles.permissions }).from(roles)
      .where(sql`lower(${roles.code}) = ${role}`);
    return held(Array.isArray(roleRow?.permissions) ? (roleRow.permissions as string[]) : []);
  }

  /**
   * v8.0.102 (TD-392، تصمیم مالک محصول «گزینه در هر گام»): انتقالی که تیک «آغازکننده تأیید نکند» دارد برای آغازکننده
   * فرایند بسته است: نه به نام خودش، نه به‌عنوان جانشین کسی و نه از راه جانشینش. ادمین همیشه مجاز است.
   */
  static initiatorExcluded(
    transition: Pick<WorkflowTransitionSnapshot, 'isInitiatorExcluded'>,
    startedBy: number | null | undefined,
    signer: { userId?: number; actorId?: number; role?: string }
  ): boolean {
    if (Number(transition.isInitiatorExcluded) !== 1 || !startedBy) return false;
    if (isSystemAdminRole(signer.role)) return false;
    return signer.userId === startedBy || signer.actorId === startedBy;
  }

  /**
   * v10.0.85 (TD-1220، یافته B-01): انتقالی که تیک «فقط آغازکننده اجرا کند» دارد فقط برای آغازکننده فرایند باز است، به نام
   * خودش یا از راه جانشینی که به جای او امضا می‌کند (امضای به نام تفویض‌کننده، TD-377)؛ فرایند بی آغازکننده فقط برای مدیر
   * سیستم. خروجی true یعنی این امضاکننده رد می‌شود.
   */
  static initiatorOnlyRefused(
    transition: Pick<WorkflowTransitionSnapshot, 'isInitiatorOnly'>,
    startedBy: number | null | undefined,
    signer: { userId?: number; actorId?: number; role?: string }
  ): boolean {
    if (Number(transition.isInitiatorOnly) !== 1) return false;
    if (isSystemAdminRole(signer.role)) return false;
    return !startedBy || (signer.userId !== startedBy && signer.actorId !== startedBy);
  }

  /**
   * v8.0.97 (TD-377): اجازه کاربر برای گام؛ تفویضی که به جای آن امضا می‌کند، یا undefined برای امضای خود کاربر.
   * v9.0.128 (TD-542): «اجازه» یعنی نقش گام و مجوز لازم آن با هم؛ کسی که خودش مجوز را ندارد با تفویض دارنده‌ای امضا
   * می‌کند که هر دو را دارد (گامی که پس از مهاجرت فقط مجوز می‌خواهد همان جانشین پیشین را نگه می‌دارد).
   */
  static async resolveSigner(
    transition: Pick<WorkflowTransitionSnapshot, 'requiredRole' | 'requiredPermission' | 'title'>,
    workflowCode: string | undefined,
    params: { userId?: number; userRole?: string; userPermissions?: string[] },
    txExecutor: DbClient = orm
  ): Promise<ActingDelegation | undefined> {
    const requiredRole = transition.requiredRole || undefined;
    const ownRole = WorkflowTransitionExecutor.checkUserRoleMatch(params.userRole, requiredRole);
    if (ownRole && await WorkflowTransitionExecutor.holdsRequiredPermission(transition, { role: params.userRole, permissions: params.userPermissions, ownPermissions: true }, txExecutor)) {
      return undefined;
    }
    const delegations = params.userId
      ? await WorkflowDelegationService.activeDelegations(txExecutor, { toUserId: params.userId })
      : [];
    for (const d of delegations) {
      if (!WorkflowDelegationService.delegationCovers(d.scope, workflowCode)) continue;
      // v9.0.34 (TD-444): نقش تفویض‌کننده با مجوزهای همان نقش سنجیده می‌شود، همان قاعده‌ای که خود او را می‌سنجد
      if (WorkflowTransitionExecutor.checkUserRoleMatch(d.fromRole, requiredRole)
        && await WorkflowTransitionExecutor.holdsRequiredPermission(transition, { role: d.fromRole, ownPermissions: false }, txExecutor)) {
        return d;
      }
    }
    if (ownRole) {
      throw new ForbiddenError(`اقدام «${transition.title}» مجوز «${transition.requiredPermission}» را می‌خواهد.`, undefined, 'WF_PERMISSION_REQUIRED');
    }
    throw new ForbiddenError(`نقش شما اجازه اقدام «${transition.title}» را ندارد؛ از دارنده نقش این گام بخواهید آن را انجام دهد.`);
  }

  /**
   * v8.0.96 (TD-376، تصمیم مالک محصول «همه اعضای نقش»): اعضای فعال نقش لازم گام AND_ALL (کاربران حذف‌نشده با همان کد
   * نقش). گام بی‌نقش undefined می‌گیرد و همان K طراح را می‌خواهد.
   */
  static async andAllMemberIds(transition: Pick<WorkflowTransitionSnapshot, 'approvalRuleType' | 'requiredRole'>, txExecutor: DbClient = orm): Promise<number[] | undefined> {
    if (WorkflowQuorumService.normalizeRuleType(transition.approvalRuleType ?? undefined) !== 'AND_ALL') return undefined;
    const role = (transition.requiredRole || '').trim().toLowerCase();
    if (!role || role === '*' || role === 'all') return undefined;
    const members = await txExecutor.select({ id: users.id }).from(users)
      .where(and(sql`COALESCE(${users.isDeleted}, 0) = 0`, sql`lower(${users.role}) = ${role}`))
      .orderBy(users.id);
    return members.map(m => m.id);
  }

  /**
   * Helper to detect negative / rejection / cancellation transitions
   */
  static isNegativeTransition(actionKey?: string | null, title?: string | null): boolean {
    const ak = (actionKey || '').toLowerCase().trim();
    const t = (title || '').toLowerCase().trim();
    return (
      ak === 'reject' ||
      ak === 'cancel' ||
      ak === 'fail' ||
      ak.startsWith('reject_') ||
      ak.endsWith('_reject') ||
      ak.startsWith('cancel_') ||
      ak.endsWith('_cancel') ||
      ak === 'qc_fail' ||
      ak.includes('reject') ||
      ak.includes('cancel') ||
      t.includes('رد ') ||
      t.startsWith('رد') ||
      t.includes('لغو') ||
      t.includes('مخالفت') ||
      t.includes('عدم تایید')
    );
  }

  /**
   * Refresh pending approvals & tasks when instance state advances
   *
   * v8.0.92 (TD-372): مهلت و کارهای گام تازه از تصویر نسخه خود فرایند ساخته می‌شوند (snapshotDsl)، نه جدول‌های جاری.
   * ذخیره طرح در طراح وضعیت‌ها و انتقال‌ها را با شناسه تازه می‌سازد؛ پیش‌تر فرایند در جریان پس از ویرایش طرح در گام بعد
   * هیچ کار و مهلتی نمی‌گرفت و از کارتابل بیرون می‌رفت.
   */
  static async refreshPendingApprovals(instanceId: number, newStateId: number, workflowDefinitionId: number, txExecutor: DbClient = orm, snapshotDsl?: unknown) {
    // 1. Delete previous pending approvals & cancel pending tasks for prior states
    await txExecutor.delete(workflowPendingApprovals).where(eq(workflowPendingApprovals.instanceId, instanceId));
    await txExecutor.update(workflowTasks)
      .set({ status: 'canceled', completedAt: new Date().toISOString() })
      .where(and(
        eq(workflowTasks.instanceId, instanceId),
        eq(workflowTasks.status, 'pending')
      ));

    // 2. Fetch state details for SLA dueAt calculation
    const snapshot = snapshotDsl as WorkflowSnapshotDsl | null | undefined;
    let newState: { slaHours?: number | null } | undefined = isUsableSnapshot(snapshot)
      ? snapshot.states!.find(st => st.id === newStateId)
      : undefined;
    if (!newState) {
      [newState] = await txExecutor.select().from(workflowStates).where(eq(workflowStates.id, newStateId));
    }
    let dueAt: string | null = null;
    if (newState && newState.slaHours && newState.slaHours > 0) {
      dueAt = new Date(Date.now() + newState.slaHours * 3600 * 1000).toISOString();
    }

    // 3. Fetch outgoing transitions
    const transitions = await WorkflowTransitionExecutor.transitionsFromState({ workflowDefinitionId, snapshotDsl }, newStateId, txExecutor);

    // 3. Consolidated Pending Approvals & Task Cards:
    // Do NOT generate duplicate cards/tasks for rejection/cancellation actions.
    // The single approval/review card provides both approve and reject choices in its modal popup.
    const forwardTransitions = transitions.filter(tr => !WorkflowTransitionExecutor.isNegativeTransition(tr.actionKey, tr.title));
    const itemsToCreate = forwardTransitions.length > 0 ? forwardTransitions : transitions;

    for (const tr of itemsToCreate) {
      await txExecutor.insert(workflowPendingApprovals).values({
        instanceId,
        transitionId: tr.id,
        assignedRole: tr.requiredRole || '',
        createdAt: new Date().toISOString()
      });
    }

    for (const tr of itemsToCreate) {
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
    /** v8.0.71 (TD-326): تراکنش فراخواننده؛ بی آن تراکنش جدا (مانند executeTransition) */
    tx?: DbClient;
  }) {
    const runInTx = async (tx: DbClient) => {
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

      // v9.0.46 (TD-453، ت۸): شروع فرایند seed اجرا نمی‌کند؛ تعریف‌های پیش‌فرض هنگام راه‌اندازی ساخته می‌شوند
      if (!def) {
        throw new NotFoundError(`هیچ فرآیند کاری فعال برای موجودیت '${params.entityType}' پیدا نشد.`);
      }

      // v9.0.33 (TD-443): فرایند فقط با تعریف فعالِ همان نوع موجودیت و روی موجودیت موجود شروع می‌شود. پیش‌تر هر کد
      // گردش‌کاری روی هر نوع موجودیتی شروع می‌شد و اقدام دامنه نوع موجودیت را از نمونه برمی‌داشت: گردش‌کار بی‌نقش اسناد
      // روی سند حسابداری، آن را بی مجوز حسابداری تأیید می‌کرد.
      if (def.entityType !== params.entityType) {
        throw new ValidationError(`گردش کار «${def.title}» برای «${workflowEntityTypeLabel(def.entityType)}» است و روی «${workflowEntityTypeLabel(params.entityType)}» آغاز نمی‌شود.`, undefined, 'WF_ENTITY_TYPE_MISMATCH');
      }
      if (Number(def.isActive) !== 1) {
        throw new ValidationError(`گردش کار «${def.title}» فعال نیست`);
      }
      if (!(await workflowEntityExists(tx, params.entityType, String(params.entityId)))) {
        throw new NotFoundError(`موجودیت «${params.entityType}» با شناسه ${params.entityId} یافت نشد`);
      }

      // v9.0.37 (TD-455): شروع‌های هم‌زمان یک موجودیت پشت هم می‌آیند (قفل تراکنشی تا پایان تراکنش فراخواننده) و فرایند
      // در جریانِ هر تعریفی دیده می‌شود؛ شاخص یکتای جزئی uq_workflow_instances_open_entity (مهاجرت 0056) پشتوانه است.
      // پیش‌تر بررسی سپس درج بی قفل بود و شش شروع هم‌زمان دو فرایند در جریان می‌ساخت.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROW_ADVISORY_LOCK_NAMESPACES.WORKFLOW_ENTITY_START}::int, hashtext(${`${params.entityType}:${String(params.entityId)}`}::text))`);
      const [existing] = await tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.entityType, params.entityType),
        eq(workflowInstances.entityId, String(params.entityId)),
        eq(workflowInstances.status, 'IN_PROGRESS')
      )).orderBy(desc(workflowInstances.id)).limit(1);

      if (existing) {
        if (existing.workflowDefinitionId === def.id) return existing;
        throw new ConflictError(`این ${workflowEntityTypeLabel(params.entityType)} گردش کار در جریان دیگری دارد؛ نخست آن را به پایان برسانید.`, undefined, 'WF_INSTANCE_ALREADY_OPEN');
      }

      const targetVersionNumber = params.definitionVersion || def.version || 1;

      // Query explicit published version snapshot from workflowDefinitionVersions
      const [versionSnapshotEntry] = await tx.select().from(workflowDefinitionVersions).where(and(
        eq(workflowDefinitionVersions.definitionId, def.id),
        eq(workflowDefinitionVersions.version, targetVersionNumber)
      ));

      let snapshotDsl: WorkflowSnapshotDsl;
      const storedSnapshot = versionSnapshotEntry?.dslJson as WorkflowSnapshotDsl | null | undefined;

      if (isUsableSnapshot(storedSnapshot)) {
        snapshotDsl = storedSnapshot;
      } else {
        // v7.0.87 (TD-112): بدون نسخه، یا نسخه قدیمی که payload خام طراح را (بدون شناسه پایگاه‌داده) نگه می‌داشت:
        // تصویر از جدول‌های جاری ساخته می‌شود؛ ردیف نسخه فقط وقتی نبود ثبت می‌شود (نسخه ثبت‌شده هرگز بازنویسی نمی‌شود)
        snapshotDsl = await buildDefinitionSnapshot(tx, def.id, targetVersionNumber);
        if (!versionSnapshotEntry) {
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
        throw new ValidationError('این گردش کار گام آغاز ندارد؛ در طراح یک گام آغاز تعیین کنید.');
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

      await WorkflowTransitionExecutor.refreshPendingApprovals(newInstance.id, initialStateId, def.id, tx, snapshotDsl);

      await tx.insert(workflowHistoryLogs).values({
        instanceId: newInstance.id,
        toStateId: initialStateId,
        performedBy: params.userId || null,
        performedByName: params.userName || 'سیستم',
        actionKey: 'START_WORKFLOW',
        actionTitle: 'شروع فرآیند کاری',
        comment: `گردش کار «${def.title}» (نسخه ${targetVersionNumber}) آغاز شد`
      });

      return newInstance;
    };

    if (params.tx) {
      return await runInTx(params.tx);
    }
    return await orm.transaction(async (tx) => runInTx(tx));
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
    /**
     * v9.0.2 (TD-415): مجوز تاریخ گذشته‌ای که فراخواننده برای همین کاربر سنجیده است، برای اقدام خودکار پس از انتقال.
     * v9.0.456 (TD-928): بی آن، موتور همان مجوز را از امضاکننده (یا نقش تفویض‌کننده) می‌خواند.
     */
    allowBackdate?: boolean;
    tx?: DbClient;
  }) {
    const runInTx = async (tx: DbClient) => {
      // v9.0.2 (TD-415): ردیف موجودیتی که اقدام پس از انتقالش آن را می‌نویسد، پیش از ردیف فرایند (ترتیب مسیر دامنه)
      await lockWorkflowEntity(tx, params.instanceId);
      const [instance] = await tx.select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, params.instanceId))
        .for('update');

      if (!instance) {
        throw new NotFoundError('این فرایند گردش کار یافت نشد.');
      }

      // v8.0.99 (TD-379): فرایند ردشده فقط با انتقالی ادامه می‌یابد که طراح از گام ردشده کشیده است (مثل «بازگشایی»)؛
      // پایین‌تر انتقال باید از گام جاری باشد. فرایند تکمیل‌شده هرگز ادامه نمی‌یابد.
      if (instance.status !== 'IN_PROGRESS' && instance.status !== 'REJECTED') {
        throw new ConflictError('این چرخه کاری قبلاً خاتمه یافته یا نهایی شده است');
      }

      // v9.0.33 (TD-443): فرایندی که تعریفش برای نوع دیگری است (ساخته‌شده پیش از v9.0.33 با کد دلخواه) پیش نمی‌رود؛
      // اقدام دامنه فقط برای تعریفِ همان نوع موجودیت اجرا می‌شود
      const definitionEntityType = (instance.snapshotDsl as WorkflowSnapshotDsl | null)?.entityType
        ?? (await tx.select({ entityType: workflowDefinitions.entityType }).from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, instance.workflowDefinitionId)))[0]?.entityType;
      if (definitionEntityType !== instance.entityType) {
        throw new ConflictError(`این فرایند با گردش کار «${workflowEntityTypeLabel(definitionEntityType)}» روی «${workflowEntityTypeLabel(instance.entityType)}» ساخته شده و پیش نمی‌رود.`, undefined, 'WF_ENTITY_TYPE_MISMATCH');
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

      if (isUsableSnapshot(snapshot)) {
        transition = snapshot.transitions!.find((t: WorkflowTransitionSnapshot) => t.id === params.transitionId);
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
        throw new NotFoundError('این اقدام در گردش کار یافت نشد؛ صفحه را تازه کنید.');
      }

      if (!fromState || !toState) {
        throw new NotFoundError('گام‌های این اقدام یافت نشدند؛ طرح گردش کار را بررسی کنید.');
      }

      if (transition.fromStateId !== instance.currentStateId) {
        throw new ConflictError('این اقدام از گام جاری سند نیست؛ صفحه را تازه کنید.');
      }

      // v9.0.34 (TD-444): مجوزهای نقش امضاکننده از پایگاه‌داده، از هر مسیری (ویجت، کارتابل، تدارکات)
      const userPermissions = await WorkflowTransitionExecutor.signerPermissions(params.userRole, params.userPermissions, tx);
      // v8.0.97 (TD-377، تصمیم مالک محصول «کارهای نقش او»): کسی که نقش گام را ندارد با تفویض فعالِ هم‌حوزه از کاربری
      // که نقش را دارد امضا می‌کند؛ امضا به نام تفویض‌کننده و با signedBy جانشین ثبت می‌شود
      const actingFor = await WorkflowTransitionExecutor.resolveSigner(transition, definition?.code, { ...params, userPermissions }, tx);
      const signerHoldsPermission = await WorkflowTransitionExecutor.holdsRequiredPermission(transition, actingFor
        ? { role: actingFor.fromRole, ownPermissions: false }
        : { role: params.userRole, permissions: userPermissions, ownPermissions: true }, tx);
      if (!signerHoldsPermission) {
        throw new ForbiddenError(`اقدام «${transition.title}» مجوز «${transition.requiredPermission}» را می‌خواهد.`, undefined, 'WF_PERMISSION_REQUIRED');
      }
      if (WorkflowTransitionExecutor.initiatorExcluded(transition, instance.startedBy, {
        userId: actingFor ? actingFor.fromUserId : params.userId, actorId: params.userId, role: params.userRole,
      })) {
        throw new ForbiddenError(`آغازکننده فرایند گام «${transition.title}» را برای سند خودش اجرا نمی‌کند.`, undefined, 'WF_INITIATOR_EXCLUDED');
      }
      if (WorkflowTransitionExecutor.initiatorOnlyRefused(transition, instance.startedBy, {
        userId: actingFor ? actingFor.fromUserId : params.userId, actorId: params.userId, role: params.userRole,
      })) {
        throw new ForbiddenError(`اقدام «${transition.title}» را فقط آغازکننده فرایند اجرا می‌کند.`, undefined, 'WF_INITIATOR_ONLY');
      }
      // v9.0.35 (TD-445، تصمیم مالک محصول ت۳ الف): گامی که اقدام دامنه دارد مجوز همان موجودیت را از امضاکننده (یا نقش
      // تفویض‌کننده) می‌خواهد؛ پیش‌تر نقش گام بس بود و خزانه‌دار بی مجوز قطعی‌سازی، سند را از گردش‌کار قطعی می‌کرد
      const signerRole = (actingFor ? actingFor.fromRole : params.userRole || '').trim().toLowerCase();
      const signerHeld = actingFor ? await WorkflowTransitionExecutor.signerPermissions(actingFor.fromRole, [], tx) : userPermissions;
      const entityPermissions = await workflowActionPermissions(instance.entityType, { toStateKey: toState.stateKey, autoActionKey: transition.autoActionKey || '' }, { tx, entityId: instance.entityId });
      if (entityPermissions.length > 0) {
        if (!isSystemAdminRole(signerRole) && !entityPermissions.some(p => signerHeld.includes(p))) {
          // v9.0.455 (TD-904): نام فارسی مجوز در پیام، کلید آن در جزئیات
          const titles = entityPermissions.map(p => permissionDefinition(p)?.title ?? p);
          throw new ForbiddenError(`اقدام «${transition.title}» یکی از مجوزهای «${titles.join('، ')}» را می‌خواهد.`, { permissions: entityPermissions }, 'WF_ENTITY_PERMISSION_REQUIRED');
        }
      }
      // v9.0.456 (TD-928، یافته P5-S-04، تصمیم ت۳ الف فاز ۵): مجوز تاریخ گذشته اقدام دامنه (قطعی‌سازی سند، دریافت کالا)
      // از همان امضاکننده (یا نقش تفویض‌کننده) خوانده می‌شود، مانند `PUT /documents/:id/finalize`؛ هرگز از بدنه درخواست.
      // پیش‌تر فقط فراخواننده تدارکات آن را می‌فرستاد و تأیید سند تاریخ گذشته از گردش کار حتی برای دارنده مجوز ۴۲۲ بود.
      const allowBackdate = params.allowBackdate === true || isSystemAdminRole(signerRole) || signerHeld.includes(STOCK_BACKDATE_PERMISSION);

      // Authoritative Server-side Entity Context & Rule Evaluation (Subphase 1.3: Never trust client snapshotData for rule conditions)
      const authoritativeContext = await getEntityContext(instance.entityType, instance.entityId, tx);
      if (transition.ruleConditionsJson) {
        const ruleEval = WorkflowRuleEngine.evaluateRuleBreakdown(transition.ruleConditionsJson, authoritativeContext);
        if (!ruleEval.passed) {
          const failedRules = ruleEval.breakdown.filter(b => !b.passed).map(b => describeUnmetWorkflowRule(b.rule, b.actualValue));
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
        kValue: transition.kValue ?? undefined,
        memberIds: await WorkflowTransitionExecutor.andAllMemberIds(transition, tx),
        existingSignatures,
        userId: actingFor ? actingFor.fromUserId : (params.userId || 0),
        userName: actingFor ? `${actingFor.fromName} (جانشین: ${params.userName || params.userId})` : params.userName,
        userRole: actingFor ? actingFor.fromRole : params.userRole,
        actorId: params.userId || 0,
        delegationId: actingFor?.id,
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
          comment: `امضای کاربر (${params.userName || params.userId})${actingFor ? ` به جانشینی ${actingFor.fromName}` : ''} ثبت شد (${quorumEval.signaturesCount} از ${quorumEval.requiredCount} امضا).`,
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

      // v8.0.93 (TD-373): امضاهای انتقال‌های گامی که فرایند واردش می‌شود از نو شمرده می‌شوند. پیش‌تر امضای دور قبل
      // (پیش از رد یا بازگشت) می‌ماند: همان کاربر گام را دوباره اجرا نمی‌توانست و امضای کهنه حدنصاب را پر می‌کرد.
      const enteredStepTransitionIds = new Set(
        (await WorkflowTransitionExecutor.transitionsFromState(instance, toState.id, tx)).map(t => String(t.id))
      );
      const progressAfterMove = Object.fromEntries(
        Object.entries(updatedProgressMap).filter(([id]) => !enteredStepTransitionIds.has(id))
      );

      await tx.update(workflowInstances)
        .set({
          currentStateId: toState.id,
          status: newStatus,
          approvalProgressJson: progressAfterMove,
          updatedAt: new Date().toISOString()
        })
        .where(eq(workflowInstances.id, instance.id));

      if (newStatus === 'IN_PROGRESS') {
        await WorkflowTransitionExecutor.refreshPendingApprovals(instance.id, toState.id, instance.workflowDefinitionId, tx, instance.snapshotDsl);
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

      const workflowCode = definition?.code || '';
      const isCompleted = WORKFLOW_COMPLETED_STATE_KEYS.has(toState.stateKey);
      const isRejected = WORKFLOW_REJECTED_STATE_KEYS.has(toState.stateKey);
      const transitionPayload = {
        instanceId: instance.id,
        entityType: instance.entityType,
        entityId: instance.entityId,
        workflowCode,
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
        snapshotData: params.snapshotData,
        isCompleted,
        isRejected
      };

      // v9.0.2 (TD-415، یافته A02-01): اقدام خودکار دامنه (قطعی‌سازی سند، سند افتتاحیه، وضعیت سند حسابداری، دریافت کالای
      // درخواست خرید) همین‌جا و با همین تراکنش اجرا می‌شود؛ خطایش انتقال را رد می‌کند. پیش‌تر workflowEventBus پیش از
      // commit پرتاب می‌شد و شنونده‌ها با اتصال جدا و خطای بلعیده کار می‌کردند (انتقالِ برگشت‌خورده هم اثر می‌گذاشت).
      await runWorkflowTransitionAction(tx, {
        instanceId: instance.id,
        entityType: instance.entityType,
        entityId: instance.entityId,
        workflowCode,
        fromStateKey: fromState.stateKey,
        toStateKey: toState.stateKey,
        actionKey: transition.actionKey,
        autoActionKey: transition.autoActionKey || '',
        performedBy: params.userId,
        performedByName: params.userName,
        allowBackdate,
      });

      await logActivity({
        userId: params.userId || 0,
        username: params.userName || 'سیستم گردش کار',
        action: 'UPDATE',
        entity: `ورکفلو (${instance.entityType})`,
        entityId: instance.entityId,
        description: `گردش کار ${workflowCode}: ${instance.entityType} شماره ${instance.entityId} از گام «${fromState.title}» به گام «${toState.title}» رفت`,
        details: {
          before: { state: fromState.stateKey },
          after: { state: toState.stateKey, action: transition.actionKey, comment: params.comment },
          changes: { instanceId: instance.id, entityId: instance.entityId }
        },
        tx
      });

      // v9.0.2 (TD-415): هر انتقال یک بار و فقط از outbox (پس از commit) منتشر می‌شود؛ پل درون‌فرایندی که همان را پیش از
      // commit و حتی برای انتقالِ برگشت‌خورده دوباره منتشر می‌کرد حذف شد و رویداد پایان فرایند هم به outbox آمد
      const eventMetadata = { userId: params.userId, userName: params.userName };
      await OutboxService.recordEvent(tx, domainEventBus.createEvent(
        DomainEventType.WORKFLOW_TRANSITIONED,
        instance.entityType as AggregateType,
        String(instance.entityId),
        transitionPayload,
        eventMetadata
      ));
      if (isCompleted || isRejected) {
        await OutboxService.recordEvent(tx, domainEventBus.createEvent(
          isCompleted ? DomainEventType.WORKFLOW_COMPLETED : DomainEventType.WORKFLOW_REJECTED,
          'Workflow',
          String(instance.id),
          {
            instanceId: instance.id,
            workflowCode,
            entityType: instance.entityType,
            entityId: instance.entityId,
            finalState: toState.stateKey,
            ...(isRejected ? { comment: params.comment } : {})
          },
          eventMetadata
        ));
      }

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
    if (isUsableSnapshot(snapshot)) {
      transition = snapshot.transitions!.find((t: WorkflowTransitionSnapshot) => t.id === params.transitionId);
    }
    if (!transition) {
      const [dbTr] = await orm.select().from(workflowTransitions).where(eq(workflowTransitions.id, params.transitionId));
      if (dbTr) transition = dbTr;
    }

    if (!transition) {
      return { allowed: false, reason: 'اقدام یافت نشد' };
    }

    if (transition.fromStateId !== instance.currentStateId) {
      return { allowed: false, reason: 'این اقدام از گام جاری نیست' };
    }

    const userPermissions = await WorkflowTransitionExecutor.signerPermissions(params.userRole, params.userPermissions);
    const isAuthorized = WorkflowTransitionExecutor.checkUserRoleMatch(params.userRole, transition.requiredRole || undefined);
    if (!isAuthorized) {
      return { allowed: false, reason: `نقش شما (${params.userRole}) مجوز لازم را ندارد` };
    }
    if (!(await WorkflowTransitionExecutor.holdsRequiredPermission(transition, { role: params.userRole, permissions: userPermissions, ownPermissions: true }))) {
      return { allowed: false, reason: `این اقدام مجوز «${transition.requiredPermission}» را می‌خواهد` };
    }

    // Authoritative Server-side Context & Rule Check (Subphase 1.3)
    if (transition.ruleConditionsJson) {
      const authoritativeContext = await getEntityContext(instance.entityType, instance.entityId);
      const ruleEval = WorkflowRuleEngine.evaluateRuleBreakdown(transition.ruleConditionsJson, authoritativeContext);
      if (!ruleEval.passed) {
        const failedRules = ruleEval.breakdown.filter(b => !b.passed).map(b => describeUnmetWorkflowRule(b.rule, b.actualValue));
        return { allowed: false, reason: `شرط‌های این اقدام برقرار نیست (${failedRules.join('، ')})` };
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
    // v9.0.33 (TD-443): فقط فرایند تعریفِ همان نوع موجودیت؛ فرایند ناهمخوان جای فرایند واقعی را در ویجت نمی‌گیرد
    const [row] = await txExecutor.select({ instance: workflowInstances }).from(workflowInstances)
      .innerJoin(workflowDefinitions, and(
        eq(workflowDefinitions.id, workflowInstances.workflowDefinitionId),
        eq(workflowDefinitions.entityType, workflowInstances.entityType)
      ))
      .where(and(
        eq(workflowInstances.entityType, entityType),
        eq(workflowInstances.entityId, String(entityId))
      )).orderBy(desc(workflowInstances.createdAt), desc(workflowInstances.id)); // v7.0.127 (TD-247): زمان برابر → بزرگ‌ترین شناسه
    const inst = row?.instance;

    if (!inst) return null;

    const history = await txExecutor.select().from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, inst.id)).orderBy(workflowHistoryLogs.createdAt);
    
    // Server-side authoritative entity context resolution
    const entityContext = await getEntityContext(entityType, entityId, txExecutor);

    // v7.0.89 (TD-085 بند ۱): اقدام‌هایی که نقش کاربر اجازه می‌دهد؛ آن‌هایی که شرط‌شان برقرار نیست با دلیل فارسی
    // جدا برمی‌گردند (پیش از این بی‌صدا پنهان می‌شدند) و هر اقدام متن شرط‌هایش را دارد
    const roleAllowedTransitions = await WorkflowTransitionExecutor.getAvailableTransitions(
      inst.id, 
      inst.currentStateId, 
      userRole, 
      userId, 
      snapshotTransitionsOf(inst.snapshotDsl), 
      undefined, 
      txExecutor,
      await WorkflowTransitionExecutor.signerPermissions(userRole, userPermissions, txExecutor) // v9.0.34 (TD-444)
    );
    const availableTransitions: Array<WorkflowTransitionSnapshot & WorkflowTransitionConditionText> = [];
    const blockedTransitions: Array<Pick<WorkflowTransitionSnapshot, 'id' | 'title' | 'actionKey'> & WorkflowTransitionConditionText & { unmetConditions: string[] }> = [];
    for (const t of roleAllowedTransitions) {
      const rules = t.ruleConditionsJson as RuleExpression;
      const breakdown = WorkflowRuleEngine.evaluateRuleBreakdown(rules, entityContext);
      const conditionText: WorkflowTransitionConditionText = {
        conditions: breakdown.breakdown.map((b) => describeWorkflowRule(b.rule)),
        conditionsMatch: breakdown.matchType,
      };
      if (WorkflowRuleEngine.evaluateConditions(rules, entityContext)) {
        availableTransitions.push({ ...t, ...conditionText });
      } else {
        blockedTransitions.push({
          id: t.id,
          title: t.title,
          actionKey: t.actionKey,
          ...conditionText,
          unmetConditions: breakdown.breakdown.filter((b) => !b.passed).map((b) => describeUnmetWorkflowRule(b.rule, b.actualValue)),
        });
      }
    }

    // v7.0.88 (TD-085): ساختاری که ویجت مراحل ورکفلو (WorkflowInstanceData) می‌خواند؛ پیش از این نمونه تخت برمی‌گشت
    // و ویجت هیچ‌وقت فرایند در جریان را نمی‌دید. مراحل از تصویر نسخه خود فرایند خوانده می‌شوند.
    const [def] = await txExecutor.select({
      id: workflowDefinitions.id,
      code: workflowDefinitions.code,
      title: workflowDefinitions.title,
      entityType: workflowDefinitions.entityType,
      version: workflowDefinitions.version
    }).from(workflowDefinitions).where(eq(workflowDefinitions.id, inst.workflowDefinitionId));
    const snapshot = inst.snapshotDsl as WorkflowSnapshotDsl | null;
    const states: WorkflowStateSnapshot[] = isUsableSnapshot(snapshot)
      ? snapshot.states!
      : await txExecutor.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, inst.workflowDefinitionId));
    const allStates = [...states].sort((a, b) => (Number(a.stepOrder) || 0) - (Number(b.stepOrder) || 0) || a.id - b.id);
    let currentState = allStates.find((st) => st.id === inst.currentStateId);
    if (!currentState) {
      [currentState] = await txExecutor.select().from(workflowStates).where(eq(workflowStates.id, inst.currentStateId));
    }

    // v10.0.80 (TD-1172): only the progress of the current step's actions; a finished step's signatures stay stored (history,
    // TD-373) but the stepper showed them under the step being signed
    const currentStepTransitionIds = new Set(
      (await WorkflowTransitionExecutor.transitionsFromState(inst, inst.currentStateId, txExecutor)).map(t => String(t.id))
    );
    const currentStepProgress = Object.fromEntries(
      Object.entries((inst.approvalProgressJson as Record<string, unknown> | null) || {}).filter(([id]) => currentStepTransitionIds.has(id))
    );

    return {
      instance: inst,
      definition: def ? { ...def, version: inst.definitionVersion ?? def.version } : undefined,
      currentState: currentState ?? null,
      allStates,
      availableTransitions,
      blockedTransitions,
      history,
      approvalProgress: currentStepProgress,
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
