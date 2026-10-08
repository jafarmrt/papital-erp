import { randomBytes } from 'crypto';
import { orm } from '../../db/drizzle.js';
import { 
  eventActionRules, 
  eventActionLogs, 
  notifications, 
  appSettings
} from '../../db/schema.js';
import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { BaseDomainEvent, DomainEventType } from './domainEvents.js';
import { logger } from '../../middleware/logger.js';
import { logActivity } from '../../lib/auditLogger.js';
import { RuleEngineService, type RuleExpression } from '../ruleEngine.service.js';
import { LOCAL_ECHO_PATH, assertSafeExternalUrl, isEchoSimulatorEnvironment, isLocalEchoTarget } from '../../lib/ssrfGuard.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { assertNotificationPermission, permissionHolderUserIds, roleMemberUserIds } from '../notifications/notificationRecipients.js';
import { resolveRuleConfigSecrets } from './integrationSecrets.js';
import { type RuleActionType } from '../../lib/events/ruleActionTypes.js';
import { assertRuleActionTypeAllowed, assertRuleEventTypeAllowed } from './ruleActionTypeGuard.js';
import type { ActionEngineStats, ActionLogPage } from '../../lib/events/actionLogContract.js';
import { deleteEventActionRule, type IntegrationDeleteActor } from './integrationParentDelete.js';
import { ruleSampleEvent } from './ruleSampleEvent.js';
import { IntegrationDeliveryService, RULE_ACTION_MAX_ATTEMPTS, type DeliveryAttemptContext, type DeliveryAttemptOutcome } from './integrationDelivery.service.js';

export interface RuleCondition {
  field: string; // e.g. 'payload.totalAmount', 'payload.newStock', 'metadata.userRole', 'aggregateType'
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  value: unknown;
}

// v9.0.377 (TD-712): «workflow_trigger» and «sms_simulation» were removed (src/lib/events/ruleActionTypes.ts)
export type ActionType = RuleActionType;

export interface WebhookActionConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  secretToken?: string;
  timeoutMs?: number;
  includeMetadata?: boolean;
}

export interface InAppNotificationConfig {
  /** v9.0.127 (TD-883): کلید کاتالوگ؛ گیرندگان دارندگان آن و مدیر سیستم‌اند */
  targetPermission?: string;
  /** نقشی که مدیر در تنظیم قاعده برگزیده است (داده، نه کد)؛ بی هدف: مدیر سیستم */
  targetRole?: string;
  targetUserId?: number;
  titleTemplate: string;
  messageTemplate: string;
  linkTemplate?: string;
  notifType?: string; // 'system' | 'mention' | 'work_log_review'
}

export interface AuditLogActionConfig {
  category?: string;
  tag?: string;
  descriptionTemplate: string;
}

export interface CreateRuleInput {
  name: string;
  description?: string;
  eventType: string;
  conditionsJson: unknown;
  actionType: ActionType;
  actionConfigJson: WebhookActionConfig | InAppNotificationConfig | AuditLogActionConfig | Record<string, unknown>;
  isActive?: number;
}

export class EventActionEngineService {
  /**
   * Helper to resolve nested dot-notated property paths using RuleEngineService
   */
  public static resolveField(path: string, obj: unknown): unknown {
    return RuleEngineService.resolvePath(path, obj);
  }

  /**
   * Evaluates conditions (single, flat array, or nested group) against an incoming domain event
   */
  public static evaluateConditions(conditions: unknown, event: BaseDomainEvent): boolean {
    if (!conditions || (Array.isArray(conditions) && conditions.length === 0)) {
      return true; // No conditions means always match
    }
    return RuleEngineService.evaluate(conditions as RuleExpression, event);
  }

  /**
   * Interpolate mustache-like {{payload.xxx}} variables inside template strings
   */
  public static interpolateTemplate(template: string, event: BaseDomainEvent): string {
    if (!template) return '';
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
      const val = this.resolveField(path, event);
      if (val === undefined || val === null) return '';
      if (typeof val === 'number') return val.toLocaleString('fa-IR');
      return String(val);
    });
  }

  /**
   * Execute an action based on its type and config
   */
  private static async executeWebhookAction(
    rule: typeof eventActionRules.$inferSelect,
    event: BaseDomainEvent,
    webhookConfig: WebhookActionConfig,
    startTime: number
  ): Promise<{ resultData: unknown; earlyReturn?: { status: 'failed'; result: unknown; errorMessage: string; durationMs: number } }> {
    if (!webhookConfig.url) {
      throw new Error('آدرس وب‌هوک (URL) تعیین نشده است.');
    }

    let targetUrl = this.interpolateTemplate(webhookConfig.url, event);
    if (targetUrl.startsWith('/')) {
      // v9.0.356 (TD-704): this server's own port, the only port the echo exception of the SSRF guard accepts
      targetUrl = `http://127.0.0.1:${process.env.PORT || 3000}${targetUrl}`;
    }

    await assertSafeExternalUrl(targetUrl, { allowLocalEcho: true });

    const method = webhookConfig.method || 'POST';
    const timeoutMs = webhookConfig.timeoutMs || 8000;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Workshop-ERP-Event-Engine/7.0',
      'X-ERP-Event-Type': event.eventType,
      'X-ERP-Event-ID': event.eventId,
      ...(webhookConfig.headers || {})
    };

    // v9.0.357 (TD-715): the system's own echo token authenticates only this server's echo simulator; a rule that holds it
    // (boot used to copy it into every webhook rule without a token) never sends it to another address
    let systemTokenWithheld = false;
    if (webhookConfig.secretToken) {
      const systemToken = await this.readWebhookSecretToken();
      if (systemToken && webhookConfig.secretToken === systemToken && !isLocalEchoTarget(new URL(targetUrl))) {
        systemTokenWithheld = true;
      } else {
        headers['X-ERP-Signature-Token'] = webhookConfig.secretToken;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const bodyPayload = {
        ruleId: rule.id,
        ruleName: rule.name,
        event: {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          metadata: webhookConfig.includeMetadata ? event.metadata : undefined,
          occurredAt: event.occurredAt
        },
        timestamp: new Date().toISOString()
      };

      const response = await fetch(targetUrl, {
        method,
        headers,
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
        // V3.0.7 (TD-057): جلوگیری از دورزدن SSRF Guard با redirect
        redirect: 'manual'
      });

      clearTimeout(timeoutId);

      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Redirect responses are not followed (SSRF protection) — HTTP ${response.status}`);
      }

      let resBody: unknown = null;
      try {
        resBody = await response.json();
      } catch {
        resBody = await response.text();
      }

      const resultData = {
        targetUrl,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        ok: response.ok,
        responseBody: resBody,
        ...(systemTokenWithheld ? { systemTokenWithheld: true } : {})
      };

      if (!response.ok) {
        return {
          resultData,
          earlyReturn: {
            status: 'failed',
            result: resultData,
            errorMessage: `وب‌هوک با وضعیت HTTP ${response.status} پاسخ داد.`,
            durationMs: Date.now() - startTime
          }
        };
      }

      return { resultData };
    } catch (fetchErr: unknown) {
      clearTimeout(timeoutId);
      const fetchError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      // v9.0.375 (TD-706، B15-04، تصمیم ت۴ الف): شکست ارسال همیشه شکست است؛ پیش‌تر نشانی‌ای که هرجای خود `webhook-echo`،
      // `example.com`، `localhost`، `127.0.0.1`، `httpbin.org` یا `webhook.site` داشت پاسخ ساختگی «OK (Simulated Fallback)» می‌گرفت
      throw new Error(`خطای ارتباط با سرور وب‌هوک: ${fetchError.name === 'AbortError' ? 'Timeout (پایان مهلت زمانی)' : fetchError.message}`);
    }
  }

  private static async executeInAppNotificationAction(
    rule: typeof eventActionRules.$inferSelect,
    event: BaseDomainEvent,
    notifConfig: InAppNotificationConfig
  ): Promise<unknown> {
    const title = this.interpolateTemplate(notifConfig.titleTemplate || 'اعلان رویداد سازمانی', event);
    const message = this.interpolateTemplate(notifConfig.messageTemplate || '', event);
    const link = notifConfig.linkTemplate ? this.interpolateTemplate(notifConfig.linkTemplate, event) : '';
    const notifType = notifConfig.notifType || 'system';

    // v9.0.127 (TD-883، مدل مجوز §۴.۲): کاربر معین، دارندگان یک مجوز، یا نقشی که مدیر برگزیده؛ بی هدف، مدیر سیستم
    const targetUserIds: number[] = notifConfig.targetUserId
      ? [notifConfig.targetUserId]
      : notifConfig.targetPermission
        ? await permissionHolderUserIds(notifConfig.targetPermission)
        : await roleMemberUserIds(notifConfig.targetRole || SYSTEM_ADMIN_ROLE);

    if (targetUserIds.length === 0) {
      return { deliveredCount: 0, reason: 'هیچ گیرنده‌ای برای این اعلان یافت نشد.' };
    }

    for (const uId of targetUserIds) {
      await orm.insert(notifications).values({
        userId: uId,
        senderId: event.metadata?.userId || null,
        senderName: event.metadata?.userName || 'موتور رویدادها',
        type: notifType,
        title,
        message,
        link,
        isRead: 0
      });
    }

    return { deliveredCount: targetUserIds.length, targetUserIds, title, message, link };
  }

  private static async executeAuditLogAction(
    rule: typeof eventActionRules.$inferSelect,
    event: BaseDomainEvent,
    auditConfig: AuditLogActionConfig
  ): Promise<unknown> {
    const description = this.interpolateTemplate(auditConfig.descriptionTemplate || '', event);

    await logActivity({
      userId: event.metadata?.userId || 0,
      username: event.metadata?.userName || 'AutoActionEngine',
      action: 'CREATE',
      entity: auditConfig.category || `قانون:${rule.name}`,
      entityId: String(event.aggregateId),
      description,
      details: {
        ruleId: rule.id,
        ruleName: rule.name,
        tag: auditConfig.tag,
        event
      }
    });

    return { logged: true, description, category: auditConfig.category };
  }

  public static async executeAction(
    rule: typeof eventActionRules.$inferSelect,
    event: BaseDomainEvent
  ): Promise<{ status: 'success' | 'failed' | 'skipped'; result: unknown; errorMessage?: string; durationMs: number }> {
    const startTime = Date.now();
    const actionType = rule.actionType as ActionType;
    const config = (rule.actionConfigJson as Record<string, unknown>) || {};

    try {
      let resultData: unknown = {};

      switch (actionType) {
        case 'webhook': {
          const webhookConfig = config as unknown as WebhookActionConfig;
          const webhookOutcome = await this.executeWebhookAction(rule, event, webhookConfig, startTime);
          if (webhookOutcome.earlyReturn) {
            return webhookOutcome.earlyReturn;
          }
          resultData = webhookOutcome.resultData;
          break;
        }

        case 'in_app_notification': {
          resultData = await this.executeInAppNotificationAction(rule, event, config as unknown as InAppNotificationConfig);
          break;
        }

        case 'audit_log': {
          resultData = await this.executeAuditLogAction(rule, event, config as unknown as AuditLogActionConfig);
          break;
        }

        default:
          throw new Error(`نوع اقدام نامعتبر است: ${actionType}`);
      }

      return {
        status: 'success',
        result: resultData,
        durationMs: Date.now() - startTime
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`[EventActionEngine Action Error] Failed to execute rule "${rule.name}" (${rule.id}): ${error.message}`);
      return {
        status: 'failed',
        result: {},
        errorMessage: error.message || 'خطای ناشناخته در اجرای اقدام',
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Main processor invoked when any domain event occurs.
   * v9.0.378 (TD-705, decision t2 a): each matching active rule gets one durable delivery row (`rule_action` x event) and
   * its first attempt runs here and is awaited; a failed action is retried by the delivery worker with a growing delay and
   * after 5 attempts moved to the dead letter queue. An error reading the rules or writing the rows goes back to the outbox;
   * a rule already recorded for the event is never run twice. Before, a failed action was only logged and never run again.
   */
  public static async processEvent(event: BaseDomainEvent): Promise<void> {
    const activeRules = await orm.select()
      .from(eventActionRules)
      .where(
        and(
          eq(eventActionRules.isActive, 1),
          sql`(${eventActionRules.eventType} = ${event.eventType} OR ${eventActionRules.eventType} = '*')`
        )
      );

    if (activeRules.length === 0) {
      return;
    }

    const jobIds: number[] = [];
    for (const rule of activeRules) {
      const conditions = Array.isArray(rule.conditionsJson) ? rule.conditionsJson as RuleCondition[] : [];
      if (!this.evaluateConditions(conditions, event)) continue;
      logger.info(`[EventActionEngine] Rule matched: "${rule.name}" (${rule.id}) -> recording ${rule.actionType} delivery for event ${event.eventType} [${event.eventId}]`);
      const job = await IntegrationDeliveryService.enqueue('rule_action', rule.id, event, RULE_ACTION_MAX_ATTEMPTS);
      jobIds.push(job.id);
    }

    // first attempts in parallel; a failure stays in its delivery row for the worker
    const attempts = await Promise.allSettled(jobIds.map(id => IntegrationDeliveryService.runJob(id)));
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        logger.error(`[EventActionEngine] A first rule action attempt failed to run: ${attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason)}`);
      }
    }
  }

  /**
   * v9.0.378 (TD-705): one attempt of a rule's action for an event, with the rule as it is now; each attempt writes its
   * own `event_action_logs` row. A deleted or inactive rule closes the delivery row.
   */
  public static async runRuleActionAttempt(ruleId: number, event: BaseDomainEvent, _context: DeliveryAttemptContext): Promise<DeliveryAttemptOutcome> {
    const [rule] = await orm.select().from(eventActionRules).where(eq(eventActionRules.id, ruleId));
    if (!rule) return { ok: false, cancelled: true, error: `قانون خودکار #${ruleId} حذف شده است.` };
    if (rule.isActive !== 1) return { ok: false, cancelled: true, error: `قانون خودکار #${ruleId} غیرفعال است.` };

    const executionResult = await this.executeAction(rule, event);

    // v9.0.379 (TD-718): the counter is read under the rule's row lock (taken before the log row's foreign-key lock)
    // and written in the transaction of the log row, so concurrent executions are all counted
    await orm.transaction(async (tx) => {
      const nowIso = new Date().toISOString();
      const [locked] = await tx.select({ executionCount: eventActionRules.executionCount })
        .from(eventActionRules)
        .where(eq(eventActionRules.id, rule.id))
        .for('update');
      if (locked) {
        await tx.update(eventActionRules)
          .set({ executionCount: (locked.executionCount || 0) + 1, lastExecutedAt: nowIso, updatedAt: nowIso })
          .where(eq(eventActionRules.id, rule.id));
      }
      await tx.insert(eventActionLogs).values({
        ruleId: locked ? rule.id : null,
        ruleName: rule.name,
        eventId: event.eventId,
        eventType: event.eventType,
        actionType: rule.actionType,
        status: executionResult.status,
        result: executionResult.result || {},
        errorMessage: executionResult.errorMessage || '',
        executionDurationMs: executionResult.durationMs,
        executedAt: nowIso
      });
    });

    return executionResult.status === 'failed'
      ? { ok: false, error: executionResult.errorMessage || 'خطای ناشناخته در اجرای اقدام' }
      : { ok: true };
  }

  /** The system's webhook echo token without generating one (env, else the stored setting, else empty) */
  private static async readWebhookSecretToken(): Promise<string> {
    if (process.env.ERP_WEBHOOK_SECRET_TOKEN) return process.env.ERP_WEBHOOK_SECRET_TOKEN;
    const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'erp_webhook_secret_token'));
    return row?.value ?? '';
  }

  /**
   * Retrieves or generates a secure dynamic webhook secret token stored in appSettings (SEC-004)
   */
  public static async getWebhookSecretToken(): Promise<string> {
    const envToken = process.env.ERP_WEBHOOK_SECRET_TOKEN;
    if (envToken) {
      return envToken;
    }
    try {
      const [row] = await orm.select().from(appSettings).where(eq(appSettings.key, 'erp_webhook_secret_token'));
      if (row?.value) {
        return row.value;
      }
      const generated = randomBytes(32).toString('hex');
      await orm.insert(appSettings).values({
        key: 'erp_webhook_secret_token',
        value: generated
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: generated }
      });
      return generated;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      // V3.0.7 (TD-057): دیگر secret هاردکد fallback نمی‌شود — یک secret ثابت و
      // قابل حدس عملاً تأیید جعلی وب‌هوک‌ها را ممکن می‌کرد. بدون secret واقعی
      // صدور توکن باید شکست بخورد (fail-closed).
      logger.error(`[EventActionEngine] Cannot resolve webhook secret token (DB error: ${error.message}). Set ERP_WEBHOOK_SECRET_TOKEN or fix appSettings access.`);
      throw new Error('Webhook secret token unavailable — webhook authentication is fail-closed. Configure ERP_WEBHOOK_SECRET_TOKEN or repair appSettings.');
    }
  }

  /**
   * Seeds standard out-of-the-box automation rules if database is clean
   */
  public static async seedDefaultRules(): Promise<void> {
    try {
      const webhookSecret = await EventActionEngineService.getWebhookSecretToken();

      // v9.0.357 (TD-715، تصمیم ت۴ الف): قانون‌های موجود هرگز در راه‌اندازی بازنویسی نمی‌شوند. پیش‌تر نشانی هر قانونی که
      // `example.com` یا `httpbin.org` را جایی در خود داشت به شبیه‌ساز محلی تغییر می‌کرد و توکن سامانه در هر قانون وب‌هوک
      // بی توکن گذاشته می‌شد و به نشانی بیرونی آن فرستاده می‌شد
      const existing = await orm.select({ id: eventActionRules.id }).from(eventActionRules).limit(1);
      if (existing.length > 0) return;

      logger.info('[EventActionEngine] Seeding standard enterprise event automation rules...');

      const defaultRules: CreateRuleInput[] = [
        {
          name: 'اعلان کسری موجودی به انبارداران',
          description: 'ارسال خودکار اعلان درون‌برنامه‌ای به دارندگان مجوز «مشاهده انبارها» هنگام رسیدن کالا به نقطه سفارش مجدد',
          eventType: DomainEventType.INVENTORY_REORDER_ALERT,
          conditionsJson: [],
          actionType: 'in_app_notification',
          actionConfigJson: {
            targetPermission: 'warehouse.view',
            titleTemplate: 'هشدار کسری موجودی کالا',
            messageTemplate: 'موجودی کالای {{payload.itemName}} (کد {{payload.itemCode}}) در انبار {{payload.warehouseLocation}} به {{payload.currentStock}} واحد کاهش یافته است.',
            linkTemplate: '/items',
            notifType: 'system'
          },
          isActive: 1
        },
        {
          name: 'اعلان تغییر وضعیت گردش کار به مدیران',
          description: 'ارسال اعلان فوری به مدیران در صورت ورود سند به مرحله تایید',
          eventType: DomainEventType.WORKFLOW_TRANSITIONED,
          conditionsJson: [
            { field: 'payload.toStateKey', operator: 'contains', value: 'PENDING' }
          ],
          actionType: 'in_app_notification',
          actionConfigJson: {
            targetRole: SYSTEM_ADMIN_ROLE,
            titleTemplate: 'درخواست تایید فرآیند جدید',
            messageTemplate: 'فرآیند {{payload.workflowCode}} برای {{payload.entityType}} شماره {{payload.entityId}} وارد مرحله تایید شد.',
            linkTemplate: '/workflow-inbox',
            notifType: 'system'
          },
          isActive: 1
        },
        // v9.0.357 (TD-715): the echo simulator answers only in test / development (TD-704), so only there is its rule seeded
        ...(isEchoSimulatorEnvironment() ? [{
          name: 'وب‌هوک تایید فاکتور فروش (شبیه‌ساز یکپارچگی)',
          description: 'ارسال وب‌هوک HTTP POST به سرور بیرونی / اتوماسیون سازمانی هنگام تایید نهایی فاکتور فروش',
          eventType: DomainEventType.INVOICE_APPROVED,
          conditionsJson: [
            { field: 'payload.totalAmount', operator: 'gt', value: 0 }
          ],
          actionType: 'webhook',
          actionConfigJson: {
            url: `http://127.0.0.1:${process.env.PORT || 3000}${LOCAL_ECHO_PATH}`,
            method: 'POST',
            timeoutMs: 5000,
            includeMetadata: true,
            secretToken: webhookSecret
          },
          isActive: 1
        } satisfies CreateRuleInput] : []),
        {
          name: 'ثبت ممیزی تراکنش‌های کلان خزانه‌داری',
          description: 'ثبت لاگ ممیزی امنیتی اختصاصی برای کلیه تراکنش‌های واریز یا برداشت بالای ۵۰۰ میلیون ریال',
          eventType: DomainEventType.TREASURY_TRANSACTION_APPROVED,
          conditionsJson: [
            { field: 'payload.amount', operator: 'gte', value: 500000000 }
          ],
          actionType: 'audit_log',
          actionConfigJson: {
            category: 'خزانه‌داری:تراکنش_کلان',
            tag: 'HIGH_VALUE_TRANSACTION',
            descriptionTemplate: 'تراکنش خزانه‌داری با ارزش کلان {{payload.amount}} {{payload.currency}} به ثبت رسید.'
          },
          isActive: 1
        }
      ];

      for (const rule of defaultRules) {
        await orm.insert(eventActionRules).values({
          name: rule.name,
          description: rule.description || '',
          eventType: rule.eventType,
          conditionsJson: rule.conditionsJson,
          actionType: rule.actionType,
          actionConfigJson: rule.actionConfigJson,
          isActive: rule.isActive ?? 1,
          executionCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      logger.info(`[EventActionEngine] Seeded ${defaultRules.length} default event action rules.`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`[EventActionEngine Seed Error] ${error.message}`);
    }
  }

  /**
   * Get list of rules with filtering
   */
  public static async getRules(filter?: { isActive?: boolean; eventType?: string }) {
    const query = orm.select().from(eventActionRules);
    const conditions: SQL[] = [];

    if (filter?.isActive !== undefined) {
      conditions.push(eq(eventActionRules.isActive, filter.isActive ? 1 : 0));
    }
    if (filter?.eventType) {
      conditions.push(eq(eventActionRules.eventType, filter.eventType));
    }

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(eventActionRules.id));
    }

    return await query.orderBy(desc(eventActionRules.id));
  }

  /**
   * Get single rule by ID
   */
  public static async getRuleById(id: number) {
    const [rule] = await orm.select().from(eventActionRules).where(eq(eventActionRules.id, id));
    return rule || null;
  }

  /**
   * Create new rule
   */
  public static async createRule(data: CreateRuleInput, userId?: number) {
    assertRuleActionTypeAllowed(data.actionType, { active: (data.isActive ?? 1) === 1, changingType: true });
    assertRuleEventTypeAllowed(data.eventType, { active: (data.isActive ?? 1) === 1, changingType: true });
    if (data.actionType === 'in_app_notification') assertNotificationPermission((data.actionConfigJson as InAppNotificationConfig | undefined)?.targetPermission);
    const [newRule] = await orm.insert(eventActionRules).values({
      name: data.name,
      description: data.description || '',
      eventType: data.eventType,
      conditionsJson: data.conditionsJson || [],
      actionType: data.actionType,
      // v9.0.360 (TD-710): a masked token or header value of a new rule has no stored value to stand for
      actionConfigJson: resolveRuleConfigSecrets(data.actionConfigJson || {}, {}) as CreateRuleInput['actionConfigJson'],
      isActive: data.isActive ?? 1,
      executionCount: 0,
      createdBy: userId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).returning();

    return newRule;
  }

  /**
   * Update rule
   */
  public static async updateRule(id: number, data: Partial<CreateRuleInput>) {
    if (data.actionConfigJson !== undefined) assertNotificationPermission((data.actionConfigJson as InAppNotificationConfig | undefined)?.targetPermission);
    const current = await this.getRuleById(id);
    if (current) {
      // v9.0.377 (TD-712): a rule of a removed action type stays inactive until its action type is changed
      const nextActive = data.isActive !== undefined ? Number(data.isActive) === 1 : current.isActive === 1;
      assertRuleActionTypeAllowed(data.actionType ?? current.actionType, { active: nextActive, changingType: data.actionType !== undefined && data.actionType !== current.actionType });
      // v9.0.406 (TD-726): a rule is saved active only with an event type the server publishes
      assertRuleEventTypeAllowed(data.eventType ?? current.eventType, { active: nextActive, changingType: data.eventType !== undefined && data.eventType !== current.eventType });
    }
    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString()
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.eventType !== undefined) updatePayload.eventType = data.eventType;
    if (data.conditionsJson !== undefined) updatePayload.conditionsJson = data.conditionsJson;
    if (data.actionType !== undefined) updatePayload.actionType = data.actionType;
    if (data.actionConfigJson !== undefined) {
      // v9.0.360 (TD-710): responses mask the token and header values; «********» keeps the stored value for the same address
      updatePayload.actionConfigJson = resolveRuleConfigSecrets(data.actionConfigJson, current?.actionConfigJson);
    }
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    const [updated] = await orm.update(eventActionRules)
      .set(updatePayload)
      .where(eq(eventActionRules.id, id))
      .returning();

    return updated;
  }

  /**
   * Delete rule: v9.0.431 (TD-611) one transaction; its logs stay with rule_id set to null (SET NULL), audit row with tx.
   */
  public static async deleteRule(id: number, actor: IntegrationDeleteActor = {}) {
    const result = await deleteEventActionRule(id, actor);
    return { success: true, ...result };
  }

  /**
   * Toggle active state
   */
  public static async toggleRule(id: number) {
    const rule = await this.getRuleById(id);
    if (!rule) throw new Error('قانون مورد نظر یافت نشد.');

    const newActive = rule.isActive === 1 ? 0 : 1;
    assertRuleActionTypeAllowed(rule.actionType, { active: newActive === 1, changingType: false });
    assertRuleEventTypeAllowed(rule.eventType, { active: newActive === 1, changingType: false });
    const [updated] = await orm.update(eventActionRules)
      .set({
        isActive: newActive,
        updatedAt: new Date().toISOString()
      })
      .where(eq(eventActionRules.id, id))
      .returning();

    return updated;
  }

  /**
   * Test execute rule with simulated event
   */
  public static async testRule(ruleId: number, customEvent?: BaseDomainEvent) {
    const rule = await this.getRuleById(ruleId);
    if (!rule) throw new Error('قانون مورد نظر یافت نشد.');

    const sampleEvent: BaseDomainEvent = customEvent || ruleSampleEvent(rule.eventType);

    const conditions = Array.isArray(rule.conditionsJson) ? rule.conditionsJson as RuleCondition[] : [];
    const conditionMatches = this.evaluateConditions(conditions, sampleEvent);

    const execution = await this.executeAction(rule, sampleEvent);

    return {
      rule,
      sampleEvent,
      conditionMatches,
      execution
    };
  }

  /**
   * Get action execution logs with pagination
   */
  public static async getLogs(filter?: { ruleId?: number; status?: string; eventType?: string; limit?: number; offset?: number }): Promise<ActionLogPage> {
    const limit = Math.min(filter?.limit || 50, 100);
    const offset = filter?.offset || 0;

    let whereClause: SQL | undefined = undefined;
    const conditions: SQL[] = [];

    if (filter?.ruleId) {
      conditions.push(eq(eventActionLogs.ruleId, filter.ruleId));
    }
    if (filter?.status) {
      conditions.push(eq(eventActionLogs.status, filter.status));
    }
    if (filter?.eventType) {
      conditions.push(eq(eventActionLogs.eventType, filter.eventType));
    }

    if (conditions.length > 0) {
      whereClause = and(...conditions);
    }

    const logs = await orm.select()
      .from(eventActionLogs)
      .where(whereClause)
      .orderBy(desc(eventActionLogs.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await orm.select({ count: sql<number>`count(*)::int` })
      .from(eventActionLogs)
      .where(whereClause);

    // v9.0.408 (TD-721): the shared contract the «اقدام‌های خودکار» tab reads
    return {
      data: logs.map(log => ({
        id: log.id,
        ruleId: log.ruleId,
        ruleName: log.ruleName ?? '',
        eventId: log.eventId,
        eventType: log.eventType,
        actionType: log.actionType,
        status: log.status,
        result: log.result ?? {},
        errorMessage: log.errorMessage ?? '',
        executionDurationMs: log.executionDurationMs ?? 0,
        executedAt: log.executedAt,
      })),
      total: count || 0,
      limit,
      offset
    };
  }

  /**
   * Telemetry stats for auto actions engine
   */
  public static async getStats(): Promise<ActionEngineStats> {
    const [rulesCount] = await orm.select({ count: sql<number>`count(*)::int` }).from(eventActionRules);
    const [activeRulesCount] = await orm.select({ count: sql<number>`count(*)::int` }).from(eventActionRules).where(eq(eventActionRules.isActive, 1));
    const [totalExecs] = await orm.select({ sum: sql<number>`COALESCE(sum(${eventActionRules.executionCount}), 0)::int` }).from(eventActionRules);
    
    const [logStats] = await orm.select({
      totalLogs: sql<number>`count(*)::int`,
      successCount: sql<number>`count(*) filter (where ${eventActionLogs.status} = 'success')::int`,
      failedCount: sql<number>`count(*) filter (where ${eventActionLogs.status} = 'failed')::int`,
      avgLatencyMs: sql<number>`COALESCE(avg(${eventActionLogs.executionDurationMs}), 0)::int`
    }).from(eventActionLogs);

    return {
      totalRules: rulesCount?.count || 0,
      activeRules: activeRulesCount?.count || 0,
      totalExecutions: totalExecs?.sum || 0,
      logsTotal: logStats?.totalLogs || 0,
      successCount: logStats?.successCount || 0,
      failedCount: logStats?.failedCount || 0,
      successRate: logStats?.totalLogs ? Math.round((logStats.successCount / logStats.totalLogs) * 100) : 100,
      avgLatencyMs: logStats?.avgLatencyMs || 0
    };
  }
}
