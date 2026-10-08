import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { domainEventBus } from '../services/events/domainEventBus.js';
import { OutboxService } from '../services/events/outboxService.js';
import { DeadLetterQueueService } from '../services/events/deadLetterQueueService.js';
import { EventActionEngineService } from '../services/events/eventActionEngineService.js';
import { evaluateRuleDraft, testStoredRule } from '../services/events/ruleDraftEvaluation.js';
import { simulateDomainEvent } from '../services/events/eventSimulation.js';
import { retryFailedOutboxEvents } from '../services/events/outboxRetry.js';
import { WebhookSubscriptionService } from '../services/events/webhookSubscriptionService.js';
import { EventSourcingReplayService } from '../services/events/eventSourcingReplayService.js';
import { logActivity } from '../lib/auditLogger.js';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { z } from 'zod';
import { errorMessageOf } from '../utils.js';
import { AppError, NotFoundError } from '../errors/customErrors.js';
import { isEnteredSecret } from '../lib/secrets/maskedSecret.js';
import { actionRuleView, webhookSubscriptionView } from '../services/events/integrationSecrets.js';
import { assertWebhookSecretsReadable } from '../services/events/webhookSecretStorage.js';
import { utcTimestampResponses } from '../middleware/utcTimestampResponses.js';
import { EVENT_OPAQUE_KEYS, EVENT_TIMESTAMP_KEYS } from '../services/events/eventTimestamps.js';
import { setRuleActive } from '../services/events/ruleActiveState.js';

const eventIdParamSchema = z.object({
  params: z.object({
    eventId: z.string().min(1, 'شناسه رویداد الزامی است')
  })
});

const webhookPingSchema = z.object({
  body: z.object({
    targetUrl: z.string().max(2000).optional(),
    secretKey: z.string().max(500).optional(),
    customHeaders: z.record(z.string(), z.coerce.string()).optional(),
    subscriptionId: z.coerce.number().int().positive().optional(),
  }),
});

const router = Router();

// Public Webhook Simulator Echo Endpoint (exempt from auth, but validates signature token)
router.all('/webhook-echo', asyncHandler(async (req, res) => {
  try {
    const receivedToken = (req.headers['x-erp-signature-token'] || req.headers['X-ERP-Signature-Token']) as string | undefined;
    const expectedToken = await EventActionEngineService.getWebhookSecretToken();

    // V9-2.2 (Fail-Closed): در غیاب توکن امضا، اندپوینت اکوی هدرها (شامل کوکی‌ها) کاملاً غیرفعال است
    if (!expectedToken) {
      return res.status(403).json({
        success: false,
        message: 'توکن امضای وب‌هوک (ERP_WEBHOOK_SECRET_TOKEN) در تنظیمات سیستم تعیین نشده و اندپوینت شبیه‌ساز غیرفعال است.',
        error: 'Webhook echo simulator disabled: ERP_WEBHOOK_SECRET_TOKEN is not configured'
      });
    }

    if (receivedToken !== expectedToken) {
      return res.status(401).json({
        success: false,
        message: 'توکن امضای وب‌هوک معتبر نیست (Unauthorized)',
        error: 'Invalid or missing X-ERP-Signature-Token header'
      });
    }

    // پاسخ اکو فقط هدرهای غیرحساس را بازمی‌گرداند — کوکی احراز هویت هرگز اکو نمی‌شود
    const safeHeaders: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (k === 'cookie' || k === 'authorization' || k === 'x-csrf-token' || k === 'x-xsrf-token') {
        safeHeaders[k] = '[PROTECTED]';
      } else {
        safeHeaders[k] = value;
      }
    }

    res.json({
      success: true,
      message: 'وب‌هوک شبیه‌ساز با موفقیت در هدرها و محتوا دریافت شد.',
      echoed: {
        method: req.method,
        headers: safeHeaders,
        body: req.body
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    throw err;
  }
}));

// Enforce authentication on all event routes
router.use(authenticateToken);
// v9.0.436 (TD-725): server timestamps in every events answer carry a Z (AGENTS §1.10)
router.use(utcTimestampResponses(EVENT_TIMESTAMP_KEYS, EVENT_OPAQUE_KEYS));

// =========================================================================
// 1. Domain Events Inspection & Simulation (EDA Telemetry)
// =========================================================================

router.get('/domain-events', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const filter = req.query.filter as string | undefined;

    const recentEvents = domainEventBus.getRecentEvents(limit, filter);
    const stats = domainEventBus.getEventStats();

    res.json({
      success: true,
      stats,
      events: recentEvents
    });
  } catch (error) {
    throw error;
  }
}));

// v9.0.430 (TD-708, decision t5 a): the simulation publishes nothing; it only shows which rules and webhooks the event reaches
router.post('/domain-events/simulate', authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  const { eventType, aggregateType, aggregateId, payload } = req.body ?? {};
  const result = await simulateDomainEvent({ eventType, aggregateType, aggregateId, payload }, { id: req.user?.id, username: req.user?.username });
  res.json({ success: true, ...result });
}));

// =========================================================================
// 2. Transactional Outbox Pipeline & Management
// =========================================================================

router.get('/outbox/stats', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const stats = await OutboxService.getOutboxStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
}));

router.get('/outbox', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const eventType = req.query.eventType as string | undefined;

    const result = await OutboxService.getOutboxEvents({
      limit,
      offset,
      status,
      eventType
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    throw error;
  }
}));

router.post(['/outbox/process-now', '/outbox/process'], authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    const batchSize = req.body.batchSize ? parseInt(req.body.batchSize, 10) : 25;
    const result = await OutboxService.processPendingBatch(batchSize);

    res.json({
      success: true,
      message: `پردازش دسته خروجی انجام شد: ${result.processed} پردازش‌شده (${result.succeeded} موفق، ${result.failed} ناموفق)`,
      result
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/outbox/retry-failed', authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    // v9.0.432 (TD-716): the DLQ rows of the retried events are resolved in the same transaction
    const result = await retryFailedOutboxEvents({ userId: req.user?.id });

    res.json({
      success: true,
      ...result,
      message: result.skippedBusy.length > 0
        ? `${result.retried.toLocaleString('fa-IR')} رویداد ناموفق دوباره در صف قرار گرفت؛ ${result.skippedBusy.length.toLocaleString('fa-IR')} رویداد که هم‌اکنون از صف خطا بازپخش می‌شود کنار ماند.`
        : `${result.retried.toLocaleString('fa-IR')} رویداد ناموفق دوباره در صف قرار گرفت.`
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/outbox/:eventId/retry', authorizePermission('events.manage'), validate(eventIdParamSchema), asyncHandler(async (req, res) => {
  try {
    const { eventId } = req.params;
    // v9.0.432 (TD-716): only a failed event (else 409), and its DLQ row is resolved in the same transaction
    await retryFailedOutboxEvents({ eventId, userId: req.user?.id });

    res.json({
      success: true,
      message: `رویداد ${eventId} برای ارسال مجدد آماده شد.`
    });
  } catch (error) {
    throw error;
  }
}));

// =========================================================================
// 3. Automated Event Actions & Rules Engine
// =========================================================================

router.get(['/action-rules/stats', '/rules/stats'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const stats = await EventActionEngineService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
}));

router.get(['/action-rules', '/rules'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' || req.query.isActive === '1' : undefined;
    const eventType = req.query.eventType as string | undefined;

    const rules = await EventActionEngineService.getRules({
      isActive,
      eventType
    });

    res.json({
      success: true,
      // v9.0.360 (TD-710): the rule token and header values never reach a reader (events.view), admin included
      data: (Array.isArray(rules) ? rules : []).map(actionRuleView)
    });
  } catch (error) {
    throw error;
  }
}));

router.get(['/action-rules/:id', '/rules/:id'], authorizePermission('events.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rule = await EventActionEngineService.getRuleById(id);

    if (!rule) {
      return res.status(404).json({ success: false, message: 'قانون مورد نظر یافت نشد.' });
    }

    res.json({
      success: true,
      data: actionRuleView(rule)
    });
  } catch (error) {
    throw error;
  }
}));

router.post(['/action-rules', '/rules'], authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    const { name, description, eventType, conditions, conditionsJson, actionType, actionConfigJson, actions, isActive } = req.body;

    if (!name || !eventType) {
      return res.status(400).json({
        success: false,
        message: 'نام و نوع رویداد الزامی می‌باشد.'
      });
    }

    const firstAction = Array.isArray(actions) && actions.length > 0 ? actions[0] : null;

    const newRule = await EventActionEngineService.createRule(
      {
        name,
        description,
        eventType,
        conditionsJson: conditionsJson || conditions || [],
        actionType: actionType || (firstAction?.type || 'in_app_notification'),
        actionConfigJson: actionConfigJson || (firstAction?.config || {}),
        isActive: isActive !== undefined ? Number(isActive) : 1
      },
      req.user?.id
    );

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username,
      userFullName: req.user?.full_name || '',
      action: 'CREATE',
      entity: `قانون واکنش خودکار: ${name}`,
      description: `ایجاد قانون جدید '${name}' برای رویداد '${eventType}'`
    });

    res.status(201).json({
      success: true,
      message: 'قانون اکشن خودکار با موفقیت ثبت گردید.',
      data: actionRuleView(newRule)
    });
  } catch (error) {
    throw error;
  }
}));

router.put(['/action-rules/:id', '/rules/:id'], authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updatedRule = await EventActionEngineService.updateRule(id, req.body);

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username,
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: `قانون واکنش خودکار #${id}`,
      description: `ویرایش تنظیمات قانون شناسه #${id}`
    });

    res.json({
      success: true,
      message: 'قانون اکشن با موفقیت به‌روزرسانی شد.',
      data: updatedRule ? actionRuleView(updatedRule) : updatedRule
    });
  } catch (error) {
    throw error;
  }
}));

router.delete(['/action-rules/:id', '/rules/:id'], authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await EventActionEngineService.deleteRule(id);

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username,
      userFullName: req.user?.full_name || '',
      action: 'DELETE',
      entity: `قانون واکنش خودکار #${id}`,
      description: `حذف قانون شناسه #${id}`
    });

    res.json({
      success: true,
      message: 'قانون با موفقیت حذف گردید.'
    });
  } catch (error) {
    throw error;
  }
}));

// v9.0.438 (TD-729): the body names the target state ({ active }); a repeat changes nothing
const ruleActiveSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  body: z.object({ active: z.boolean({ message: 'وضعیت هدف قانون (active) باید درست یا نادرست باشد.' }) }),
}).passthrough();

router.post(['/action-rules/:id/toggle', '/rules/:id/toggle'], authorizePermission('events.manage'), validate(ruleActiveSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rule, changed } = await setRuleActive(id, req.body.active === true, req);
  const state = rule.isActive === 1 ? 'فعال' : 'غیرفعال';
  res.json({
    success: true,
    changed,
    message: changed ? `قانون «${rule.name}» ${state} شد.` : `قانون «${rule.name}» از پیش ${state} است.`,
    data: actionRuleView(rule)
  });
}));

// v9.0.430 (TD-708, decision t5 a): a rule test evaluates the stored rule and shows what its action would do; it never runs it
router.post(['/action-rules/:id/test', '/rules/:id/test'], authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const testResult = await testStoredRule(id, req.body?.customEvent);
  res.json({
    success: true,
    ...testResult,
    rule: actionRuleView(testResult.rule)
  });
}));

// v9.0.377 (TD-712): the draft is really evaluated (invalid draft → 422 RULE_DRAFT_INVALID) and nothing is sent or written
router.post('/action-rules/test-draft', authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  const evaluation = await evaluateRuleDraft(req.body?.rule);
  res.json({ success: true, ...evaluation, evaluatedConditions: evaluation.conditionMatches });
}));

router.get(['/action-logs', '/action-rules/logs'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const ruleId = req.query.ruleId ? parseInt(req.query.ruleId as string, 10) : undefined;
    const status = req.query.status as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const offset = (page - 1) * limit;

    const logsResult = await EventActionEngineService.getLogs({
      ruleId,
      status,
      eventType,
      limit,
      offset
    });

    res.json({
      success: true,
      ...logsResult
    });
  } catch (error) {
    throw error;
  }
}));

// =========================================================================
// 4. Dead Letter Queue (DLQ) Quarantine & Error Recovery
// =========================================================================

router.get('/dlq/stats', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const stats = await DeadLetterQueueService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
}));

router.get('/dlq', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const source = req.query.source as string | undefined;
    const search = req.query.search as string | undefined;

    const result = await DeadLetterQueueService.getEvents({
      limit,
      offset,
      status,
      eventType,
      source,
      search
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/dlq/:id/replay', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { payload, adjustedPayload } = req.body;
    const finalPayload = payload || adjustedPayload;
    const userId = req.user?.id;

    const result = await DeadLetterQueueService.replayEvent(id, finalPayload, userId);

    await logActivity({
      userId,
      username: req.user?.username,
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: `صف خطاهای قرنطینه #${id}`,
      description: `بازپخش دستی رویداد قرنطینه شناسه #${id}`
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
}));

router.post('/dlq/replay-batch', authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'لیست شناسه‌های بازپخش الزامی است.' });
    }

    const userId = req.user?.id;
    const result = await DeadLetterQueueService.replayBatch(ids, userId);

    await logActivity({
      userId,
      username: req.user?.username,
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: 'صف خطاهای قرنطینه (DLQ)',
      description: `بازپخش گروهی ${result.succeeded} از ${result.total} رویداد قرنطینه`
    });

    res.json({
      success: true,
      message: `بازپخش گروهی انجام شد: ${result.succeeded} موفق، ${result.failed} ناموفق`,
      ...result
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/dlq/:id/dismiss', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { notes } = req.body;
    const userId = req.user?.id;

    const item = await DeadLetterQueueService.dismissEvent(id, userId, notes);

    res.json({
      success: true,
      message: 'رویداد با موفقیت از صف اخطارها رد شد.',
      event: item
    });
  } catch (error) {
    throw error;
  }
}));

router.put('/dlq/:id/payload', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { payload } = req.body;
    const userId = req.user?.id;

    // v9.0.432 (TD-716): under the row lock, never for a replayed row, audited with the request
    const updated = await DeadLetterQueueService.editPayload(id, payload, { userId, req });

    res.json({
      success: true,
      message: 'بدنه داده رویداد قرنطینه اصلاح گردید.',
      event: updated
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/dlq/purge', authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    const result = await DeadLetterQueueService.purgeResolved();

    res.json({
      success: true,
      message: `تعداد ${result.purgedCount} رکورد بازپخش‌شده یا ردشده پاکسازی گردید.`,
      ...result
    });
  } catch (error) {
    throw error;
  }
}));

// =========================================================================
// 5. Event Sourcing Timeline Replay & Simulation
// =========================================================================

router.get(['/event-sourcing/types', '/timeline/types'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const types = await EventSourcingReplayService.getAggregateTypes();
    res.json({
      success: true,
      types
    });
  } catch (error) {
    throw error;
  }
}));

router.get(['/event-sourcing/aggregates', '/timeline/aggregates'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const type = ((req.query.type as string) || (req.query.aggregateType as string) || '').trim();
    const search = (req.query.search as string) || '';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    if (!type) {
      return res.status(400).json({ success: false, message: 'پارامتر نوع موجودیت (type) الزامی است.' });
    }

    const aggregates = await EventSourcingReplayService.searchAggregates(type, search, limit);

    res.json({
      success: true,
      data: aggregates
    });
  } catch (error) {
    throw error;
  }
}));

router.get(['/event-sourcing/timeline', '/timeline'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const type = ((req.query.type as string) || (req.query.aggregateType as string) || '').trim();
    const id = ((req.query.id as string) || (req.query.aggregateId as string) || '').trim();

    if (!type || !id) {
      return res.status(400).json({ success: false, message: 'پارامترهای type و id الزامی هستند.' });
    }

    // v9.0.431 (TD-711): audit rows only for holders of the audit log permission, computed here, never read from the request
    const auditIncluded = await can(req.user, 'audit_logs.view');
    const timeline = await EventSourcingReplayService.getAggregateTimeline(type, id, { includeAudit: auditIncluded });

    res.json({
      success: true,
      data: timeline,
      timeline,
      auditIncluded
    });
  } catch (error) {
    throw error;
  }
}));

router.post(['/event-sourcing/simulate-replay', '/timeline/simulate-replay'], authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    const { event, eventId, eventType, aggregateType, aggregateId, payload, dryRun } = req.body;

    const simulationResult = await EventSourcingReplayService.simulateEventReplay({
      eventId: eventId || (event?.eventId),
      eventType: eventType || (event?.eventType) || 'SimulatedEvent',
      aggregateType: aggregateType || (event?.aggregateType) || 'document',
      aggregateId: String(aggregateId || (event?.aggregateId) || '1'),
      payload: payload || (event?.payload) || {},
      dryRun,
      userId: req.user?.id,
      userName: req.user?.username
    });

    res.json(simulationResult);
  } catch (error) {
    throw error;
  }
}));

// =========================================================================
// 6. Webhook Subscriptions & Deliveries Pipeline
// =========================================================================

// v9.0.360 (TD-710, decision t6 a): the signing key and the custom header values are masked in every answer, for every
// user and the system admin too (`webhookSubscriptionView`); the key is shown once, by create and rotate-secret only.

router.get('/webhooks/stats', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const stats = await WebhookSubscriptionService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
}));

router.get('/webhooks', authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const subs = await WebhookSubscriptionService.getSubscriptions();
    res.json({
      success: true,
      data: (Array.isArray(subs) ? subs : []).map(s => webhookSubscriptionView(s))
    });
  } catch (error) {
    throw error;
  }
}));

router.get('/webhooks/:id', authorizePermission('events.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sub = await WebhookSubscriptionService.getSubscriptionById(id);

    if (!sub) {
      return res.status(404).json({ success: false, message: 'اشتراک وب‌هوک یافت نشد.' });
    }

    res.json({
      success: true,
      data: webhookSubscriptionView(sub)
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/webhooks', authorizePermission('events.manage'), asyncHandler(async (req, res) => {
  try {
    const { name, targetUrl, eventPatterns, secretKey, customHeaders, retryLimit, timeoutMs, timeoutSeconds } = req.body;

    if (!name || !targetUrl || !eventPatterns || !Array.isArray(eventPatterns)) {
      return res.status(400).json({
        success: false,
        message: 'نام، آدرس مقصد و الگوهای رویداد الزامی هستند.'
      });
    }

    const newSub = await WebhookSubscriptionService.createSubscription(
      {
        name,
        targetUrl,
        eventPatterns,
        // V3.0.7 (TD-057): default ضعیف Math.random حذف شد — سرویس در نبود کلید
        // خودش secret امن CSPRNG (generateSecretKey) تولید می‌کند.
        secretKey: secretKey?.trim() || undefined,
        customHeaders: customHeaders || {},
        retryLimit: retryLimit || 3,
        // v9.0.359 (TD-720): the form's timeoutMs (legacy timeoutSeconds), checked by the service; it used to become 10 s
        timeoutMs,
        timeoutSeconds
      },
      req.user?.id
    );

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username,
      userFullName: req.user?.full_name || '',
      action: 'CREATE',
      entity: `اشتراک وب‌هوک: ${name}`,
      description: `ثبت اشتراک وب‌هوک به آدرس ${targetUrl}`
    });

    res.status(201).json({
      success: true,
      message: 'اشتراک وب‌هوک با موفقیت ایجاد شد. کلید امضا را همین حالا کپی کنید؛ دیگر نشان داده نمی‌شود.',
      data: webhookSubscriptionView(newSub, { revealSecret: true })
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const isClientError = errorMessageOf(error)?.includes('SSRF') || errorMessageOf(error)?.includes('Disallowed') || errorMessageOf(error)?.includes('Invalid URL');
    res.status(isClientError ? 400 : 500).json({
      success: false,
      message: isClientError ? errorMessageOf(error) : 'خطا در ایجاد وب‌هوک',
      error: errorMessageOf(error)
    });
  }
}));

router.put('/webhooks/:id', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await WebhookSubscriptionService.updateSubscription(id, req.body);

    res.json({
      success: true,
      message: 'اشتراک وب‌هوک با موفقیت ویرایش شد.',
      data: webhookSubscriptionView(updated)
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const isClientError = errorMessageOf(error)?.includes('SSRF') || errorMessageOf(error)?.includes('Disallowed') || errorMessageOf(error)?.includes('Invalid URL');
    res.status(isClientError ? 400 : 500).json({
      success: false,
      message: isClientError ? errorMessageOf(error) : 'خطا در ویرایش وب‌هوک',
      error: errorMessageOf(error)
    });
  }
}));

router.delete('/webhooks/:id', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await WebhookSubscriptionService.deleteSubscription(id);

    res.json({
      success: true,
      message: 'اشتراک وب‌هوک با موفقیت حذف گردید.'
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/webhooks/:id/toggle', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await WebhookSubscriptionService.toggleSubscription(id);

    res.json({
      success: true,
      message: `وضعیت وب‌هوک به ${updated.isActive ? 'فعال' : 'غیرفعال'} تغییر یافت.`,
      data: webhookSubscriptionView(updated)
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/webhooks/:id/rotate-secret', authorizePermission('events.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rotated = await WebhookSubscriptionService.rotateSecret(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username,
    userFullName: req.user?.full_name || '',
    action: 'UPDATE',
    entity: `اشتراک وب‌هوک: ${rotated.name}`,
    entityId: id,
    description: `ساخت کلید امضای تازه برای اشتراک وب‌هوک «${rotated.name}»`
  });
  res.json({
    success: true,
    message: 'کلید امضای تازه ساخته شد. آن را همین حالا کپی کنید و به سامانه مقصد بدهید؛ این کلید دیگر نشان داده نمی‌شود.',
    data: webhookSubscriptionView(rotated, { revealSecret: true })
  });
}));

router.post('/webhooks/ping', authorizePermission('events.manage'), validate(webhookPingSchema), asyncHandler(async (req, res) => {
  // v9.0.358 (TD-719): a saved webhook is pinged with its stored signing key (`subscriptionId`), never with the masked key
  // the browser holds; a draft without an entered key is signed with a one-time key, never a fixed 'test_secret_key'
  const { targetUrl, secretKey, customHeaders, subscriptionId } = req.body as z.infer<typeof webhookPingSchema>['body'];
  const stored = subscriptionId ? await WebhookSubscriptionService.getSubscriptionById(subscriptionId) : null;
  if (subscriptionId && !stored) {
    throw new NotFoundError('اشتراک وب‌هوک یافت نشد.', undefined, 'WEBHOOK_NOT_FOUND');
  }
  const url = (targetUrl || stored?.targetUrl || '').trim();
  if (!url) {
    return res.status(400).json({ success: false, message: 'آدرس مقصد برای ارسال پینگ آزمایشی الزامی است.' });
  }
  const keySource = isEnteredSecret(secretKey) ? 'entered' : stored ? 'stored' : 'temporary';
  const signingKey = keySource === 'entered' ? String(secretKey).trim()
    : keySource === 'stored' ? stored!.secretKey
      : WebhookSubscriptionService.generateSecretKey();
  // the stored custom headers go only to the stored address
  const headers = customHeaders ?? (stored && url === stored.targetUrl ? stored.customHeaders : undefined);
  // v9.0.361 (TD-898): a stored key or header the current ERP_SECRETS_KEY cannot decrypt is never sent
  const usesStoredKey = keySource === 'stored';
  const usesStoredHeaders = !customHeaders && headers !== undefined;
  if (stored && (usesStoredKey || usesStoredHeaders)) {
    assertWebhookSecretsReadable({
      unreadableSecrets: stored.unreadableSecrets.filter(f => (f === 'secretKey' ? usesStoredKey : usesStoredHeaders)),
    });
  }

  const pingResult = await WebhookSubscriptionService.pingTest(url, signingKey, headers);
  res.json({ ...pingResult, keySource });
}));

router.get(['/webhooks/deliveries/list', '/webhooks/deliveries'], authorizePermission('events.view'), asyncHandler(async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const offset = (page - 1) * limit;
    const subscriptionId = req.query.subscriptionId ? parseInt(req.query.subscriptionId as string, 10) : undefined;

    const result = await WebhookSubscriptionService.getDeliveries({
      limit,
      offset,
      subscriptionId
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    throw error;
  }
}));

// Public Webhook Simulator Echo Endpoint
// V9-2.2: مسیر تکراری حذف شد — نسخه معتبر (با اعتبارسنجی توکن) در ابتدای فایل ثبت شده است.

export default router;
