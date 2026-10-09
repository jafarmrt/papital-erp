import { Router } from 'express';
import { WorkflowEngineService } from '../services/workflow/workflowEngineService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, userHasRoleOrPermission } from '../middleware/authorize.js';
import { WORKFLOW_ENTITY_READ_PERMISSIONS, WORKFLOW_WIDGET_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { ForbiddenError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { getErrorMessage } from '../utils.js';
import { z } from 'zod';
import { MY_TASK_FILTERS } from '../services/workflow/workflowTaskService.js';
import { withUtcTimestamps } from '../services/workflow/workflowTimestamps.js';
import { isSystemAdminRole } from '../lib/permissions/permissionCatalog.js';
import { canvasPositionsSchema, createDelegationSchema, executeTaskSchema, executeTransitionSchema, saveDefinitionSchema } from './workflowRouteSchemas.js';
import { WORKFLOW_EXECUTE_PERMISSIONS, WORKFLOW_INBOX_PERMISSIONS } from '../lib/permissions/workflowPermissions.js';

const entityParamSchema = z.object({
  params: z.object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
  })
});

const definitionVersionParamSchema = z.object({
  params: z.object({
    id: numericIdString,
    version: numericIdString,
  })
});

/** v9.0.33 (TD-443): بدنه شروع فرایند؛ شناسه موجودیت عدد یا رشته کوتاه است، نه شیء */
const workflowEntityIdInput = z.union([z.number().int().positive(), z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, 'شناسه موجودیت نامعتبر است')])
  .transform((v) => String(v));
const startWorkflowSchema = z.object({
  body: z.object({
    workflowCode: z.string().trim().min(1, 'کد گردش کار الزامی است').max(100),
    entityType: z.string().trim().min(1, 'نوع موجودیت الزامی است').max(50).regex(/^[a-z][a-z0-9_]*$/, 'نوع موجودیت نامعتبر است'),
    entityId: workflowEntityIdInput,
  }),
});

/** v9.0.41 (TD-448، ت۶): زبانه، صفحه و اندازه صفحه کارتابل؛ مقدار ناشناخته ۴۰۰ (پیش‌تر هر رشته‌ای پذیرفته می‌شد) */
const myTasksQuerySchema = z.object({
  query: z.object({
    status: z.enum(MY_TASK_FILTERS).default('pending'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(50),
  }).passthrough(),
});

const router = Router();

// Protect all workflow routes
router.use(authenticateToken);
// TD-468 (یافته B14-26): زمان‌های سرور در هر پاسخ گردش کار با Z (AGENTS §1.10)
router.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(withUtcTimestamps(body));
  next();
});

// v9.0.42 (TD-449، ت۷ الف): «نمای نمونه‌ها» (`GET /workflow/inbox`) حذف شد؛ کارتابل فقط نمای کارها (`/tasks/my-tasks`) را دارد

/**
 * GET /api/workflow/tasks/my-tasks
 * Get task inbox for current user (workflow_tasks model with delegation support)
 */
router.get('/tasks/my-tasks', authorizePermission(...WORKFLOW_INBOX_PERMISSIONS), validate(myTasksQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'کاربر معتبر نیست' });
  }
  const query = req.query as unknown as z.infer<typeof myTasksQuerySchema>['query'];
  const result = await WorkflowEngineService.getMyTasks({
    userId,
    userRole: req.user?.role || '',
    status: query.status,
    page: query.page,
    limit: query.limit
  });
  res.json(result);
}));

/**
 * GET /api/workflow/tasks/stats
 * Get summary stats for user's tasks
 */
router.get('/tasks/stats', authorizePermission(...WORKFLOW_INBOX_PERMISSIONS), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role || '';

    if (!userId) {
      return res.status(401).json({ error: 'کاربر معتبر نیست' });
    }

    const stats = await WorkflowEngineService.getTaskStats({
      userId,
      userRole
    });

    res.json(stats);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /tasks/stats] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/tasks/:taskId/execute
 * Execute a workflow task directly by task ID
 */
router.post('/tasks/:taskId/execute', authorizePermission(...WORKFLOW_EXECUTE_PERMISSIONS), validate(executeTaskSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const { comment, snapshotData, action, transitionId } = req.body;
    const userId = req.user?.id;
    const userName = req.user?.full_name || req.user?.username || '';
    const userRole = req.user?.role || '';
    const userPermissions = req.user?.permissions || [];

    if (!userId) {
      return res.status(401).json({ error: 'کاربر معتبر نیست' });
    }

    const result = await WorkflowEngineService.executeTaskById({
      taskId,
      userId,
      userName,
      userRole,
      userPermissions,
      action: action === 'reject' ? 'reject' : 'approve',
      transitionId: Number(transitionId) > 0 ? Number(transitionId) : undefined,
      comment: comment ?? undefined,
      snapshotData: snapshotData ?? undefined
    });

    // v8.0.91 (TD-371): امضایی که حدنصاب را کامل نکرده کار را باز می‌گذارد و پیام شمار امضاها را برمی‌گرداند
    const pendingSignature = 'task' in result && result.task.status === 'pending';
    const alreadyDecided = 'idempotent' in result && result.idempotent;
    const message = (pendingSignature || alreadyDecided) && 'message' in result && result.message ? result.message : 'کار انجام شد.';
    res.json({ success: true, message, data: result });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /tasks/:taskId/execute] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * GET /api/workflow/instance/:entityType/:entityId
 * Get active workflow instance, current state, available actions, and history
 */
router.get('/instance/:entityType/:entityId', authorizePermission(...WORKFLOW_WIDGET_PERMISSIONS), validate(entityParamSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { entityType, entityId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userPermissions = req.user?.permissions || [];
    // v9.0.38 (TD-458، ت۹ الف): داده موجودیت فقط برای دارنده مجوز خواندن همان موجودیت (پیش‌تر workflow.view بس بود و
    // بیننده بی مجوز حسابداری شماره، وضعیت و جمع سند حسابداری و تاریخچه آن را می‌دید)
    const entityRead = WORKFLOW_ENTITY_READ_PERMISSIONS[String(entityType)];
    if (entityRead && !(await userHasRoleOrPermission(req.user, ...entityRead))) {
      throw new ForbiddenError('برای دیدن گردش کار این مورد، مجوز دیدن خود آن را لازم دارید.');
    }

    const instanceData = await WorkflowEngineService.getInstanceByEntity(
      entityType,
      entityId,
      userId,
      userRole,
      userPermissions
    );

    res.json(instanceData || { instance: null });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /instance] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/start
 * Start or attach a workflow instance to an entity
 */
// حوزه H (TD-298): شروع فرآیند تغییر است؛ workflow.view (مشاهده) کافی نیست
router.post('/start', authorizePermission('workflow.execute', 'workflow.manage', 'workflow.admin', 'workflow.approve', 'documents.create', 'documents.edit'), validate(startWorkflowSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { workflowCode, entityType, entityId } = req.body as z.infer<typeof startWorkflowSchema>['body'];

    const instanceData = await WorkflowEngineService.startWorkflow({
      workflowCode,
      entityType,
      entityId,
      userId: req.user?.id,
      userName: req.user?.full_name || req.user?.username
    });

    res.json({ success: true, data: instanceData });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /start] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/transition
 * Execute a workflow transition
 */
router.post('/transition', authorizePermission(...WORKFLOW_EXECUTE_PERMISSIONS), validate(executeTransitionSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { instanceId, transitionId, comment, snapshotData } = req.body as z.infer<typeof executeTransitionSchema>['body'];

    const updatedInstance = await WorkflowEngineService.executeTransition({
      instanceId,
      transitionId,
      userId: req.user?.id,
      userName: req.user?.full_name || req.user?.username,
      userRole: req.user?.role,
      userPermissions: req.user?.permissions || [],
      comment: comment ?? undefined,
      snapshotData: snapshotData ?? undefined
    });

    res.json({ success: true, data: updatedInstance });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /transition] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * GET /api/workflow/definitions
 * Get list of all workflow definitions for Visual Canvas Designer
 */
router.get('/definitions', authorizePermission('workflow.manage', 'workflow.admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const definitions = await WorkflowEngineService.getWorkflowDefinitions();
    res.json(definitions);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * GET /api/workflow/definitions/:id
 * Get single workflow definition detail with states & transitions
 */
router.get('/definitions/:id', authorizePermission('workflow.manage', 'workflow.admin'), validate(paramsIdSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const detail = await WorkflowEngineService.getWorkflowDefinitionDetail(id);
    res.json(detail);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * GET /api/workflow/definitions/:id/versions
 * Get version history for a workflow definition
 */
router.get('/definitions/:id/versions', authorizePermission('workflow.manage', 'workflow.admin'), validate(paramsIdSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const versions = await WorkflowEngineService.getDefinitionVersions(id);
    res.json(versions);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id/versions] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * GET /api/workflow/definitions/:id/versions/:version
 * Get specific version detail for a workflow definition
 */
router.get('/definitions/:id/versions/:version', authorizePermission('workflow.manage', 'workflow.admin'), validate(definitionVersionParamSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const versionNumber = Number(req.params.version);
    const versionDetail = await WorkflowEngineService.getDefinitionVersionDetail(id, versionNumber);
    res.json(versionDetail);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id/versions/:version] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/definitions
 * Save or update workflow definition (Visual Designer)
 */
router.post('/definitions', authorizePermission('workflow.manage', 'workflow.admin'), validate(saveDefinitionSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const payload = req.body as z.infer<typeof saveDefinitionSchema>['body'];
    const saved = await WorkflowEngineService.saveWorkflowDefinition({ ...payload, userId: req.user?.id });
    res.json({ success: true, data: saved });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /definitions] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/positions
 * Quick update canvas node positions from drag
 */
router.post('/positions', authorizePermission('workflow.manage', 'workflow.admin'), validate(canvasPositionsSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const { definitionId, positions } = req.body as z.infer<typeof canvasPositionsSchema>['body'];
    const result = await WorkflowEngineService.updateCanvasPositions(definitionId, positions, req);
    res.json(result);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /positions] Error: ${errMsg}`);
    throw err;
  }
}));

// v9.0.46 (TD-453، ت۸ الف): «همگام‌سازی الگوهای پیش‌فرض» (`POST /definitions/seed-default`) حذف شد؛ seed فقط تعریفِ
// نبود را و فقط هنگام راه‌اندازی می‌سازد

/**
 * GET /api/workflow/analytics/sla
 * SLA analytics and bottleneck reports
 */
router.get('/analytics/sla', authorizePermission('workflow.manage', 'workflow.admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const report = await WorkflowEngineService.getSlaAnalytics();
    res.json(report);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /analytics/sla] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * GET /api/workflow/delegations
 * Get workflow delegations for current user or all (if admin)
 */
router.get('/delegations', authorizePermission('workflow.view', 'workflow.manage', 'workflow.admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id || 0;
    const userRole = req.user?.role || 'user';
    const delegations = await WorkflowEngineService.getDelegations({ userId, userRole });
    res.json({ success: true, data: delegations });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route GET /delegations] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/delegations
 * Create a new workflow delegation
 */
router.post('/delegations', authorizePermission('workflow.approve', 'workflow.manage', 'workflow.admin'), validate(createDelegationSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id || 0;
    const userName = req.user?.full_name || req.user?.username || 'کاربر';
    const userRole = req.user?.role || 'user';

    const { fromUserId, toUserId, scope, startDate, endDate, reason } = req.body as z.infer<typeof createDelegationSchema>['body'];

    const targetFromUserId = (isSystemAdminRole(userRole) && fromUserId) ? fromUserId : userId;
    const targetToUserId = toUserId;

    const created = await WorkflowEngineService.createDelegation({
      fromUserId: targetFromUserId,
      toUserId: targetToUserId,
      scope,
      startDate,
      endDate,
      reason,
      createdByUserId: userId,
      createdByName: userName
    });

    res.json({ success: true, message: 'تفویض اختیار ثبت شد.', data: created });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /delegations] Error: ${errMsg}`);
    throw err;
  }
}));

/**
 * POST /api/workflow/delegations/:id/revoke
 * Revoke an active delegation
 */
router.post('/delegations/:id/revoke', authorizePermission('workflow.approve', 'workflow.manage', 'workflow.admin'), validate(paramsIdSchema), asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user?.id || 0;
    const userRole = req.user?.role || 'user';
    const userName = req.user?.full_name || req.user?.username || 'کاربر';

    const result = await WorkflowEngineService.revokeDelegation({
      id,
      userId,
      userRole,
      userName
    });

    res.json(result);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /delegations/:id/revoke] Error: ${errMsg}`);
    throw err;
  }
}));

export default router;
