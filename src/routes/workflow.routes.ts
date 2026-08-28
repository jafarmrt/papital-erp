import { Router } from 'express';
import { WorkflowEngineService, WorkflowRuleEngine } from '../services/workflow/workflowEngineService';
import { RuleEngineService } from '../services/ruleEngine.service.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { getErrorMessage } from '../utils.js';
import { z } from 'zod';

const instanceIdParamSchema = z.object({
  params: z.object({
    instanceId: numericIdString,
  })
});

const taskIdParamSchema = z.object({
  params: z.object({
    taskId: numericIdString,
  })
});

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

const router = Router();

// Protect all workflow routes
router.use(authenticateToken);

/**
 * GET /api/workflow/inbox
 * Get approval inbox for current user's role
 */
router.get('/inbox', authorizePermission('workflow.view', 'workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '50');
    const userRole = req.user?.role;
    const userId = req.user?.id;

    const inbox = await WorkflowEngineService.getApprovalInbox({
      role: userRole,
      userId,
      page,
      limit
    });

    res.json(inbox);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /inbox] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/tasks/my-tasks
 * Get task inbox for current user (workflow_tasks model with delegation support)
 */
router.get('/tasks/my-tasks', authorizePermission('workflow.view', 'workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '50');
    const status = (req.query.status as string) || 'pending';
    const userId = req.user?.id;
    const userRole = req.user?.role || '';

    if (!userId) {
      return res.status(401).json({ error: 'کاربر معتبر نیست' });
    }

    const result = await WorkflowEngineService.getMyTasks({
      userId,
      userRole,
      status,
      page,
      limit
    });

    res.json(result);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /tasks/my-tasks] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/tasks/stats
 * Get summary stats for user's tasks
 */
router.get('/tasks/stats', authorizePermission('workflow.view', 'workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
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
});

/**
 * GET /api/workflow/tasks/instance/:instanceId
 * Get all tasks generated for a workflow instance
 */
router.get('/tasks/instance/:instanceId', authorizePermission('workflow.view', 'workflow.manage', 'workflow.admin'), validate(instanceIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const instanceId = Number(req.params.instanceId);
    const tasks = await WorkflowEngineService.getTasksForInstance(instanceId);
    res.json(tasks);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /tasks/instance/:instanceId] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/tasks/:taskId/execute
 * Execute a workflow task directly by task ID
 */
router.post('/tasks/:taskId/execute', authorizePermission('workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), validate(taskIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const { comment, snapshotData, action } = req.body;
    const userId = req.user?.id;
    const userName = req.user?.fullName || req.user?.username || '';
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
      comment,
      snapshotData
    });

    res.json({ success: true, message: 'وظیفه با موفقیت اجرا گردید', data: result });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /tasks/:taskId/execute] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/tasks/:taskId/delegate
 * Delegate a workflow task to another user
 */
router.post('/tasks/:taskId/delegate', authorizePermission('workflow.approve', 'workflow.manage', 'workflow.admin'), validate(taskIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const { toUserId, reason } = req.body;
    const fromUserId = req.user?.id;

    if (!fromUserId) {
      return res.status(401).json({ error: 'کاربر معتبر نیست' });
    }
    if (!toUserId) {
      return res.status(400).json({ error: 'کاربر مقصد تفویض الزامی است' });
    }

    const result = await WorkflowEngineService.delegateTask({
      taskId,
      fromUserId,
      toUserId: Number(toUserId),
      reason
    });

    res.json({ success: true, message: 'وظیفه با موفقیت تفویض گردید', data: result });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /tasks/:taskId/delegate] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/instance/:entityType/:entityId
 * Get active workflow instance, current state, available actions, and history
 */
router.get('/instance/:entityType/:entityId', authorizePermission('workflow.view', 'workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), validate(entityParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { entityType, entityId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userPermissions = req.user?.permissions || [];

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
});

/**
 * POST /api/workflow/start
 * Start or attach a workflow instance to an entity
 */
router.post('/start', authorizePermission('workflow.execute', 'workflow.manage', 'workflow.admin', 'workflow.approve', 'workflow.view', 'documents.create', 'documents.edit'), async (req: AuthenticatedRequest, res) => {
  try {
    const { workflowCode, entityType, entityId } = req.body;

    if (!workflowCode || !entityType || !entityId) {
      return res.status(400).json({ error: 'اطلاعات کد ورکفلو، نوع و شناسه موجودیت الزامی است' });
    }

    const instanceData = await WorkflowEngineService.startWorkflow({
      workflowCode,
      entityType,
      entityId: String(entityId),
      userId: req.user?.id,
      userName: req.user?.fullName || req.user?.username
    });

    res.json({ success: true, data: instanceData });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /start] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/transition
 * Execute a workflow transition
 */
router.post('/transition', authorizePermission('workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const { instanceId, transitionId, comment, snapshotData } = req.body;

    if (!instanceId || !transitionId) {
      return res.status(400).json({ error: 'شناسه نمونه ورکفلو و شناسه اکشن الزامی است' });
    }

    const updatedInstance = await WorkflowEngineService.executeTransition({
      instanceId: Number(instanceId),
      transitionId: Number(transitionId),
      userId: req.user?.id,
      userName: req.user?.fullName || req.user?.username,
      userRole: req.user?.role,
      userPermissions: req.user?.permissions || [],
      comment,
      snapshotData
    });

    res.json({ success: true, data: updatedInstance });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /transition] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/definitions
 * Get list of all workflow definitions for Visual Canvas Designer
 */
router.get('/definitions', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const definitions = await WorkflowEngineService.getWorkflowDefinitions();
    res.json(definitions);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/definitions/:id
 * Get single workflow definition detail with states & transitions
 */
router.get('/definitions/:id', authorizePermission('workflow.manage', 'workflow.admin'), validate(paramsIdSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const detail = await WorkflowEngineService.getWorkflowDefinitionDetail(id);
    res.json(detail);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/definitions/:id/versions
 * Get version history for a workflow definition
 */
router.get('/definitions/:id/versions', authorizePermission('workflow.manage', 'workflow.admin'), validate(paramsIdSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const versions = await WorkflowEngineService.getDefinitionVersions(id);
    res.json(versions);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id/versions] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/definitions/:id/versions/:version
 * Get specific version detail for a workflow definition
 */
router.get('/definitions/:id/versions/:version', authorizePermission('workflow.manage', 'workflow.admin'), validate(definitionVersionParamSchema), async (req: AuthenticatedRequest, res) => {
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
});

/**
 * POST /api/workflow/definitions/:id/rollback
 * Rollback workflow definition to a previous version
 */
router.post('/definitions/:id/rollback', authorizePermission('workflow.manage', 'workflow.admin'), validate(paramsIdSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ error: 'شماره نسخه جهت بازگردانی الزامی است' });
    }
    const result = await WorkflowEngineService.rollbackToVersion(id, Number(version), req.user?.id);
    res.json({ success: true, message: `ورکفلو با موفقیت به نسخه ${version} بازگردانی شد`, data: result });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id/rollback] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/definitions/:id/publish
 * Publish a new immutable version snapshot for a workflow definition
 */
router.post('/definitions/:id/publish', authorizePermission('workflow.manage', 'workflow.admin'), validate(paramsIdSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { title, description } = req.body;
    const published = await WorkflowEngineService.publishVersion(id, title, description, req.user?.id);
    res.json({ success: true, message: `نسخه ${published.version} فرآیند کاری با موفقیت انتشار یافت`, data: published });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /definitions/:id/publish] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/definitions
 * Save or update workflow definition (Visual Designer)
 */
router.post('/definitions', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const payload = req.body;
    if (!payload.title || !payload.code || !payload.entityType) {
      return res.status(400).json({ error: 'عنوان، کد و نوع موجودیت الزامی هستند' });
    }
    payload.userId = req.user?.id;
    const saved = await WorkflowEngineService.saveWorkflowDefinition(payload);
    res.json({ success: true, data: saved });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /definitions] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/positions
 * Quick update canvas node positions from drag
 */
router.post('/positions', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const { positions } = req.body;
    if (!positions || !Array.isArray(positions)) {
      return res.status(400).json({ error: 'موقعیت گره‌ها الزامی است' });
    }
    const result = await WorkflowEngineService.updateCanvasPositions(positions);
    res.json(result);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /positions] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/definitions/seed-default
 * Force re-seed / sync standard default workflow definitions
 */
router.post('/definitions/seed-default', authorizePermission('workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    // Delete existing standard definitions if forced
    await WorkflowEngineService.seedDefaultWorkflows();
    const definitions = await WorkflowEngineService.getWorkflowDefinitions();
    res.json({ success: true, message: 'الگوهای پیش‌فرض با موفقیت همگام‌سازی شدند', data: definitions });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /seed-default] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/rules/validate
 * Validate syntax of condition rules
 */
router.post('/rules/validate', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const { rules } = req.body;
    const result = WorkflowRuleEngine.validateRuleSyntax(rules);
    if (!result.valid) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, message: 'ساختار قوانین شرطی معتبر است' });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /rules/validate] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/rules/evaluate
 * Evaluate condition rules against mock context or live entity context
 */
router.post('/rules/evaluate', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const { rules, context, entityType, entityId } = req.body;
    let evalContext = context || {};

    if (entityType && entityId) {
      const fetchedContext = await WorkflowEngineService.getEntityContext(entityType, entityId);
      evalContext = { ...fetchedContext, ...evalContext };
    }

    const evaluation = WorkflowRuleEngine.evaluateRuleBreakdown(rules, evalContext);
    res.json({
      success: true,
      passed: evaluation.passed,
      matchType: evaluation.matchType,
      context: evalContext,
      breakdown: evaluation.breakdown
    });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /rules/evaluate] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/analytics/sla
 * SLA analytics and bottleneck reports
 */
router.get('/analytics/sla', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const report = await WorkflowEngineService.getSlaAnalytics();
    res.json(report);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /analytics/sla] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/analytics/bottlenecks
 * Get identified bottleneck states
 */
router.get('/analytics/bottlenecks', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const bottlenecks = await WorkflowEngineService.getBottleneckAnalytics();
    res.json({ success: true, count: bottlenecks.length, data: bottlenecks });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /analytics/bottlenecks] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/analytics/compliance
 * Get SLA compliance KPI rate
 */
router.get('/analytics/compliance', authorizePermission('workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const compliance = await WorkflowEngineService.getSlaComplianceStats();
    res.json({ success: true, data: compliance });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /analytics/compliance] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/instance/:instanceId/sla
 * Evaluate SLA status for a specific workflow instance
 */
router.get('/instance/:instanceId/sla', authorizePermission('workflow.view', 'workflow.manage', 'workflow.admin'), validate(instanceIdParamSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const instanceId = Number(req.params.instanceId);
    const slaStatus = await WorkflowEngineService.evaluateSlaStatus(instanceId);
    res.json({ success: true, instanceId, isOverdue: !!slaStatus, details: slaStatus });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route /instance/:instanceId/sla] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * GET /api/workflow/delegations
 * Get workflow delegations for current user or all (if admin)
 */
router.get('/delegations', authorizePermission('workflow.view', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
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
});

/**
 * POST /api/workflow/delegations
 * Create a new workflow delegation
 */
router.post('/delegations', authorizePermission('workflow.approve', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id || 0;
    const userName = req.user?.username || 'کاربر';
    const userRole = req.user?.role || 'user';

    const { fromUserId, toUserId, scope, startDate, endDate, reason } = req.body;

    const targetFromUserId = (userRole === 'admin' && fromUserId) ? Number(fromUserId) : userId;
    const targetToUserId = Number(toUserId);

    if (!targetToUserId) {
      return res.status(400).json({ error: 'کاربر دریافت‌کننده تفویض الزامی است' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'تاریخ شروع و پایان تفویض الزامی است' });
    }

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

    res.json({ success: true, message: 'تفویض اختیار با موفقیت ثبت گردید', data: created });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /delegations] Error: ${errMsg}`);
    throw err;
  }
});

/**
 * POST /api/workflow/delegations/:id/revoke
 * Revoke an active delegation
 */
router.post('/delegations/:id/revoke', authorizePermission('workflow.approve', 'workflow.manage', 'workflow.admin'), validate(paramsIdSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user?.id || 0;
    const userRole = req.user?.role || 'user';
    const userName = req.user?.username || 'کاربر';

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
});

/**
 * POST /api/workflow/rules/evaluate
 * Evaluate rule condition expression with detailed evaluation trace
 */
router.post('/rules/evaluate', authorizePermission('workflow.view', 'workflow.manage', 'workflow.admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const { expression, context } = req.body;

    const validation = RuleEngineService.validateExpression(expression);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error || 'ساختار قانون نا معتبر است' });
    }

    const evaluationTrace = RuleEngineService.evaluateWithTrace(expression, context || {});
    res.json({
      passed: evaluationTrace.passed,
      durationMs: evaluationTrace.durationMs,
      traceTree: evaluationTrace.traceTree,
      flatTrace: evaluationTrace.flatTrace
    });
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`[Workflow Route POST /rules/evaluate] Error: ${errMsg}`);
    throw err;
  }
});

export default router;
