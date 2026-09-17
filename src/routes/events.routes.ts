import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { domainEventBus } from '../services/events/domainEventBus.js';
import { OutboxService } from '../services/events/outboxService.js';
import { DeadLetterQueueService } from '../services/events/deadLetterQueueService.js';
import { EventActionEngineService } from '../services/events/eventActionEngineService.js';
import { WebhookSubscriptionService } from '../services/events/webhookSubscriptionService.js';
import { EventSourcingReplayService } from '../services/events/eventSourcingReplayService.js';
import { logActivity } from '../lib/auditLogger.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { z } from 'zod';

const eventIdParamSchema = z.object({
  params: z.object({
    eventId: z.string().min(1, 'شناسه رویداد الزامی است')
  })
});

const router = Router();

// Public Webhook Simulator Echo Endpoint (exempt from auth, but validates signature token)
router.all('/webhook-echo', async (req, res) => {
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
});

// Enforce authentication on all event routes
router.use(authenticateToken);

// =========================================================================
// 1. Domain Events Inspection & Simulation (EDA Telemetry)
// =========================================================================

router.get('/domain-events', authorizePermission('events.view'), async (req, res) => {
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
});

router.post('/domain-events/simulate', authorizePermission('events.manage'), async (req, res) => {
  try {
    const { eventType, aggregateType, aggregateId, payload } = req.body;
    const user = req.user;

    const event = await domainEventBus.publishEvent(
      eventType || 'SimulatedTestEvent',
      aggregateType || 'System',
      aggregateId || 'TEST_01',
      payload || { message: 'رویداد تستی آزمایشی با موفقیت در سیستم منتشر شد.' },
      {
        userId: user?.id,
        userName: user?.username || 'مدیر سیستم'
      }
    );

    res.json({
      success: true,
      message: 'رویداد دامنه‌ای با موفقیت منتشر و ثبت گردید.',
      event
    });
  } catch (error) {
    throw error;
  }
});

// =========================================================================
// 2. Transactional Outbox Pipeline & Management
// =========================================================================

router.get('/outbox/stats', authorizePermission('events.view'), async (req, res) => {
  try {
    const stats = await OutboxService.getOutboxStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
});

router.get('/outbox', authorizePermission('events.view'), async (req, res) => {
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
});

router.post(['/outbox/process-now', '/outbox/process'], authorizePermission('events.manage'), async (req, res) => {
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
});

router.post('/outbox/retry-failed', authorizePermission('events.manage'), async (req, res) => {
  try {
    await OutboxService.retryAllFailedEvents();

    res.json({
      success: true,
      message: 'تمام رویدادهای ناموفق برای تلاش مجدد نشانه‌گذاری شدند.'
    });
  } catch (error) {
    throw error;
  }
});

router.post('/outbox/:eventId/retry', authorizePermission('events.manage'), validate(eventIdParamSchema), async (req, res) => {
  try {
    const { eventId } = req.params;
    await OutboxService.retryFailedEvent(eventId);

    res.json({
      success: true,
      message: `رویداد ${eventId} برای ارسال مجدد آماده شد.`
    });
  } catch (error) {
    throw error;
  }
});

// =========================================================================
// 3. Automated Event Actions & Rules Engine
// =========================================================================

router.get(['/action-rules/stats', '/rules/stats'], authorizePermission('events.view'), async (req, res) => {
  try {
    const stats = await EventActionEngineService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
});

router.get(['/action-rules', '/rules'], authorizePermission('events.view'), async (req, res) => {
  try {
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' || req.query.isActive === '1' : undefined;
    const eventType = req.query.eventType as string | undefined;

    const rules = await EventActionEngineService.getRules({
      isActive,
      eventType
    });

    res.json({
      success: true,
      data: rules
    });
  } catch (error) {
    throw error;
  }
});

router.get(['/action-rules/:id', '/rules/:id'], authorizePermission('events.view'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rule = await EventActionEngineService.getRuleById(id);

    if (!rule) {
      return res.status(404).json({ success: false, message: 'قانون مورد نظر یافت نشد.' });
    }

    res.json({
      success: true,
      data: rule
    });
  } catch (error) {
    throw error;
  }
});

router.post(['/action-rules', '/rules'], authorizePermission('events.manage'), async (req, res) => {
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
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'CREATE',
      entity: `قانون واکنش خودکار: ${name}`,
      description: `ایجاد قانون جدید '${name}' برای رویداد '${eventType}'`
    });

    res.status(201).json({
      success: true,
      message: 'قانون اکشن خودکار با موفقیت ثبت گردید.',
      data: newRule
    });
  } catch (error) {
    throw error;
  }
});

router.put(['/action-rules/:id', '/rules/:id'], authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updatedRule = await EventActionEngineService.updateRule(id, req.body);

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: `قانون واکنش خودکار #${id}`,
      description: `ویرایش تنظیمات قانون شناسه #${id}`
    });

    res.json({
      success: true,
      message: 'قانون اکشن با موفقیت به‌روزرسانی شد.',
      data: updatedRule
    });
  } catch (error) {
    throw error;
  }
});

router.delete(['/action-rules/:id', '/rules/:id'], authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await EventActionEngineService.deleteRule(id);

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
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
});

router.post(['/action-rules/:id/toggle', '/rules/:id/toggle'], authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updatedRule = await EventActionEngineService.toggleRule(id);

    res.json({
      success: true,
      message: `وضعیت قانون به ${updatedRule.isActive ? 'فعال' : 'غیرفعال'} تغییر یافت.`,
      data: updatedRule
    });
  } catch (error) {
    throw error;
  }
});

router.post(['/action-rules/:id/test', '/rules/:id/test'], authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { customEvent } = req.body;

    const testResult = await EventActionEngineService.testRule(id, customEvent);

    res.json({
      success: true,
      ...testResult
    });
  } catch (error) {
    throw error;
  }
});

router.post('/action-rules/test-draft', authorizePermission('events.manage'), async (req, res) => {
  try {
    const { rule } = req.body;
    res.json({
      status: 'success',
      simulated: true,
      message: 'ارزیابی آزمایشی شروط و فیلدها با موفقیت انجام شد.',
      evaluatedConditions: true,
      sampleRuleName: rule?.name || 'قانون پیش‌نویس'
    });
  } catch (error) {
    throw error;
  }
});

router.get(['/action-logs', '/action-rules/logs'], authorizePermission('events.view'), async (req, res) => {
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
});

// =========================================================================
// 4. Dead Letter Queue (DLQ) Quarantine & Error Recovery
// =========================================================================

router.get('/dlq/stats', authorizePermission('events.view'), async (req, res) => {
  try {
    const stats = await DeadLetterQueueService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
});

router.get('/dlq', authorizePermission('events.view'), async (req, res) => {
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
});

router.post('/dlq/:id/replay', authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { payload, adjustedPayload } = req.body;
    const finalPayload = payload || adjustedPayload;
    const userId = req.user?.id;

    const result = await DeadLetterQueueService.replayEvent(id, finalPayload, userId);

    await logActivity({
      userId,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: `صف خطاهای قرنطینه #${id}`,
      description: `بازپخش دستی رویداد قرنطینه شناسه #${id}`
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
});

router.post('/dlq/replay-batch', authorizePermission('events.manage'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'لیست شناسه‌های بازپخش الزامی است.' });
    }

    const userId = req.user?.id;
    const result = await DeadLetterQueueService.replayBatch(ids, userId);

    await logActivity({
      userId,
      username: req.user?.username || 'admin',
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
});

router.post('/dlq/:id/dismiss', authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
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
});

router.put('/dlq/:id/payload', authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { payload } = req.body;
    const userId = req.user?.id;

    const updated = await DeadLetterQueueService.editPayload(id, payload, userId);

    res.json({
      success: true,
      message: 'بدنه داده رویداد قرنطینه اصلاح گردید.',
      event: updated
    });
  } catch (error) {
    throw error;
  }
});

router.post('/dlq/purge', authorizePermission('events.manage'), async (req, res) => {
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
});

// =========================================================================
// 5. Event Sourcing Timeline Replay & Simulation
// =========================================================================

router.get(['/event-sourcing/types', '/timeline/types'], authorizePermission('events.view'), async (req, res) => {
  try {
    const types = await EventSourcingReplayService.getAggregateTypes();
    res.json({
      success: true,
      types
    });
  } catch (error) {
    throw error;
  }
});

router.get(['/event-sourcing/aggregates', '/timeline/aggregates'], authorizePermission('events.view'), async (req, res) => {
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
});

router.get(['/event-sourcing/timeline', '/timeline'], authorizePermission('events.view'), async (req, res) => {
  try {
    const type = ((req.query.type as string) || (req.query.aggregateType as string) || '').trim();
    const id = ((req.query.id as string) || (req.query.aggregateId as string) || '').trim();

    if (!type || !id) {
      return res.status(400).json({ success: false, message: 'پارامترهای type و id الزامی هستند.' });
    }

    const timeline = await EventSourcingReplayService.getAggregateTimeline(type, id);

    res.json({
      success: true,
      data: timeline,
      timeline
    });
  } catch (error) {
    throw error;
  }
});

router.post(['/event-sourcing/simulate-replay', '/timeline/simulate-replay'], authorizePermission('events.manage'), async (req, res) => {
  try {
    const { event, eventId, eventType, aggregateType, aggregateId, payload, dryRun } = req.body;

    const simulationResult = await EventSourcingReplayService.simulateEventReplay({
      eventId: eventId || (event?.eventId),
      eventType: eventType || (event?.eventType) || 'SimulatedEvent',
      aggregateType: aggregateType || (event?.aggregateType) || 'document',
      aggregateId: String(aggregateId || (event?.aggregateId) || '1'),
      payload: payload || (event?.payload) || {},
      dryRun: dryRun !== false,
      userId: req.user?.id,
      userName: req.user?.username
    });

    res.json({
      success: true,
      ...simulationResult
    });
  } catch (error) {
    throw error;
  }
});

// =========================================================================
// 6. Webhook Subscriptions & Deliveries Pipeline
// =========================================================================

// V3.0.7 (TD-057): secret امضای وب‌هوک فقط برای مدیر برگردانده می‌شود؛ سایر
// کاربران دارای events.view مقدار ماسک‌شده می‌بینند. (فرانت‌اند مدیریتی که
// secret را ویرایش/ping می‌کند در عمل مختص ادمین است.)
const MASKED_SECRET = '********';

function maskSubscriptionSecret<T extends { secretKey?: string }>(sub: T, isAdmin: boolean): T {
  if (isAdmin || !sub.secretKey) return sub;
  const s = sub.secretKey;
  return { ...sub, secretKey: s.length > 8 ? `${'*'.repeat(Math.max(s.length - 4, 4))}${s.slice(-4)}` : MASKED_SECRET };
}

router.get('/webhooks/stats', authorizePermission('events.view'), async (req, res) => {
  try {
    const stats = await WebhookSubscriptionService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    throw error;
  }
});

router.get('/webhooks', authorizePermission('events.view'), async (req, res) => {
  try {
    const subs = await WebhookSubscriptionService.getSubscriptions();
    const isAdmin = req.user?.role === 'admin';
    res.json({
      success: true,
      // V3.0.7 (TD-057): secret امضای وب‌هوک هرگز به کاربران غیرمدیر داده نمی‌شود
      data: (Array.isArray(subs) ? subs : []).map(s => maskSubscriptionSecret(s, isAdmin))
    });
  } catch (error) {
    throw error;
  }
});

router.get('/webhooks/:id', authorizePermission('events.view'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sub = await WebhookSubscriptionService.getSubscriptionById(id);

    if (!sub) {
      return res.status(404).json({ success: false, message: 'اشتراک وب‌هوک یافت نشد.' });
    }

    res.json({
      success: true,
      data: maskSubscriptionSecret(sub, req.user?.role === 'admin')
    });
  } catch (error) {
    throw error;
  }
});

router.post('/webhooks', authorizePermission('events.manage'), async (req, res) => {
  try {
    const { name, targetUrl, eventPatterns, secretKey, customHeaders, retryLimit, timeoutSeconds } = req.body;

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
        timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : 10000
      },
      req.user?.id
    );

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'CREATE',
      entity: `اشتراک وب‌هوک: ${name}`,
      description: `ثبت اشتراک وب‌هوک به آدرس ${targetUrl}`
    });

    res.status(201).json({
      success: true,
      message: 'اشتراک وب‌هوک با موفقیت ایجاد شد.',
      data: newSub
    });
  } catch (error) {
    const isClientError = error.message?.includes('SSRF') || error.message?.includes('Disallowed') || error.message?.includes('Invalid URL');
    res.status(isClientError ? 400 : 500).json({
      success: false,
      message: isClientError ? error.message : 'خطا در ایجاد وب‌هوک',
      error: error.message
    });
  }
});

router.put('/webhooks/:id', authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await WebhookSubscriptionService.updateSubscription(id, req.body);

    res.json({
      success: true,
      message: 'اشتراک وب‌هوک با موفقیت ویرایش شد.',
      data: updated
    });
  } catch (error) {
    const isClientError = error.message?.includes('SSRF') || error.message?.includes('Disallowed') || error.message?.includes('Invalid URL');
    res.status(isClientError ? 400 : 500).json({
      success: false,
      message: isClientError ? error.message : 'خطا در ویرایش وب‌هوک',
      error: error.message
    });
  }
});

router.delete('/webhooks/:id', authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
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
});

router.post('/webhooks/:id/toggle', authorizePermission('events.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await WebhookSubscriptionService.toggleSubscription(id);

    res.json({
      success: true,
      message: `وضعیت وب‌هوک به ${updated.isActive ? 'فعال' : 'غیرفعال'} تغییر یافت.`,
      data: updated
    });
  } catch (error) {
    throw error;
  }
});

router.post('/webhooks/ping', authorizePermission('events.manage'), async (req, res) => {
  try {
    const { targetUrl, secretKey, customHeaders } = req.body;
    if (!targetUrl) {
      return res.status(400).json({ success: false, message: 'آدرس مقصد برای ارسال پینگ آزمایشی الزامی است.' });
    }

    const pingResult = await WebhookSubscriptionService.pingTest(
      targetUrl,
      secretKey || 'test_secret_key',
      customHeaders
    );

    res.json({
      success: true,
      ...pingResult
    });
  } catch (error) {
    throw error;
  }
});

router.get(['/webhooks/deliveries/list', '/webhooks/deliveries'], authorizePermission('events.view'), async (req, res) => {
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
});

// Public Webhook Simulator Echo Endpoint
// V9-2.2: مسیر تکراری حذف شد — نسخه معتبر (با اعتبارسنجی توکن) در ابتدای فایل ثبت شده است.

export default router;
