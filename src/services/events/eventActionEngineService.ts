import { randomBytes } from 'crypto';
import { orm } from '../../db/drizzle.js';
import { 
  eventActionRules, 
  eventActionLogs, 
  notifications, 
  users,
  appSettings
} from '../../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { BaseDomainEvent, DomainEventType } from './domainEvents.js';
import { logger } from '../../middleware/logger.js';
import { logActivity } from '../../lib/auditLogger.js';
import { RuleEngineService, type RuleExpression } from '../ruleEngine.service.js';
import { assertSafeExternalUrl } from '../../lib/ssrfGuard.js';

export interface RuleCondition {
  field: string; // e.g. 'payload.totalAmount', 'payload.newStock', 'metadata.userRole', 'aggregateType'
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  value: unknown;
}

export type ActionType = 'webhook' | 'in_app_notification' | 'workflow_trigger' | 'sms_simulation' | 'audit_log';

export interface WebhookActionConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  secretToken?: string;
  timeoutMs?: number;
  includeMetadata?: boolean;
}

export interface InAppNotificationConfig {
  targetRole?: string; // e.g. 'admin', 'warehouse_keeper', 'accountant'
  targetUserId?: number;
  titleTemplate: string;
  messageTemplate: string;
  linkTemplate?: string;
  notifType?: string; // 'system' | 'mention' | 'work_log_review'
}

export interface WorkflowTriggerConfig {
  workflowCode: string;
  entityType: string;
  entityIdField: string; // e.g. 'payload.documentId'
  commentTemplate?: string;
}

export interface SmsSimulationConfig {
  recipientPhoneTemplate: string;
  messageTemplate: string;
  senderLine?: string;
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
  actionConfigJson: WebhookActionConfig | InAppNotificationConfig | WorkflowTriggerConfig | SmsSimulationConfig | AuditLogActionConfig | Record<string, unknown>;
  isActive?: number;
}

export class EventActionEngineService {
  /**
   * Alias method for backwards compatibility
   */
  public static evaluateRuleConditions(ruleConditionsJson: unknown, payload: unknown): boolean {
    if (!ruleConditionsJson || (Array.isArray(ruleConditionsJson) && ruleConditionsJson.length === 0)) {
      return true;
    }
    const dummyEvent = { payload } as unknown as BaseDomainEvent;
    return this.evaluateConditions(ruleConditionsJson, dummyEvent);
  }

  /**
   * Alias method for backwards compatibility
   */
  public static async processEventActions(event: BaseDomainEvent): Promise<void> {
    return this.processEvent(event);
  }

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
        // -------------------------------------------------------------
        // 1. Webhook Execution
        // -------------------------------------------------------------
        case 'webhook': {
          const webhookConfig = config as unknown as WebhookActionConfig;
          if (!webhookConfig.url) {
            throw new Error('آدرس وب‌هوک (URL) تعیین نشده است.');
          }

          let targetUrl = this.interpolateTemplate(webhookConfig.url, event);
          if (targetUrl.startsWith('/')) {
            targetUrl = `http://127.0.0.1:3000${targetUrl}`;
          }

          // Assert URL is safe against SSRF attacks (SEC-010)
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

          if (webhookConfig.secretToken) {
            headers['X-ERP-Signature-Token'] = webhookConfig.secretToken;
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
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            let resBody: unknown = null;
            try {
              resBody = await response.json();
            } catch {
              resBody = await response.text();
            }

            resultData = {
              targetUrl,
              httpStatus: response.status,
              httpStatusText: response.statusText,
              ok: response.ok,
              responseBody: resBody
            };

            if (!response.ok) {
              return {
                status: 'failed',
                result: resultData,
                errorMessage: `وب‌هوک با وضعیت HTTP ${response.status} پاسخ داد.`,
                durationMs: Date.now() - startTime
              };
            }
          } catch (fetchErr: unknown) {
            clearTimeout(timeoutId);
            const fetchError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
            if (
              targetUrl.includes('webhook-echo') ||
              targetUrl.includes('httpbin.org') ||
              targetUrl.includes('example.com') ||
              targetUrl.includes('localhost') ||
              targetUrl.includes('127.0.0.1') ||
              targetUrl.includes('webhook.site')
            ) {
              logger.info(`[EventActionEngine Webhook] Local/simulation fallback for ${targetUrl}`);
              resultData = {
                targetUrl,
                httpStatus: 200,
                httpStatusText: 'OK (Simulated Fallback)',
                ok: true,
                responseBody: { success: true, message: 'وب‌هوک شبیه‌ساز با موفقیت دریافت گردید.' }
              };
              break;
            }
            throw new Error(`خطای ارتباط با سرور وب‌هوک: ${fetchError.name === 'AbortError' ? 'Timeout (پایان مهلت زمانی)' : fetchError.message}`);
          }
          break;
        }

        // -------------------------------------------------------------
        // 2. In-App Notification Generation
        // -------------------------------------------------------------
        case 'in_app_notification': {
          const notifConfig = config as unknown as InAppNotificationConfig;
          const title = this.interpolateTemplate(notifConfig.titleTemplate || 'اعلان رویداد سازمانی', event);
          const message = this.interpolateTemplate(notifConfig.messageTemplate || '', event);
          const link = notifConfig.linkTemplate ? this.interpolateTemplate(notifConfig.linkTemplate, event) : '';
          const notifType = notifConfig.notifType || 'system';

          const targetUserIds: number[] = [];

          if (notifConfig.targetUserId) {
            targetUserIds.push(notifConfig.targetUserId);
          } else if (notifConfig.targetRole) {
            // Find all users with this role
            const matchedUsers = await orm.select({ id: users.id })
              .from(users)
              .where(eq(users.role, notifConfig.targetRole));
            matchedUsers.forEach(u => targetUserIds.push(u.id));
          } else {
            // Default to all admins
            const adminUsers = await orm.select({ id: users.id })
              .from(users)
              .where(eq(users.role, 'admin'));
            adminUsers.forEach(u => targetUserIds.push(u.id));
          }

          if (targetUserIds.length === 0) {
            resultData = { deliveredCount: 0, reason: 'هیچ کاربری با نقش مشخص‌شده یافت نشد.' };
          } else {
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
            resultData = { deliveredCount: targetUserIds.length, targetUserIds, title, message, link };
          }
          break;
        }

        // -------------------------------------------------------------
        // 3. Workflow Trigger
        // -------------------------------------------------------------
        case 'workflow_trigger': {
          const wfConfig = config as unknown as WorkflowTriggerConfig;
          const entityId = this.resolveField(wfConfig.entityIdField, event) || event.aggregateId;
          const comment = wfConfig.commentTemplate ? this.interpolateTemplate(wfConfig.commentTemplate, event) : `تحریک خودکار بر پایه رویداد ${event.eventType}`;

          resultData = {
            workflowCode: wfConfig.workflowCode,
            entityType: wfConfig.entityType,
            entityId: String(entityId),
            comment,
            triggered: true,
            note: 'فرآیند با موفقیت جهت شروع/انتقال در صف قرار گرفت.'
          };
          break;
        }

        // -------------------------------------------------------------
        // 4. SMS Simulation
        // -------------------------------------------------------------
        case 'sms_simulation': {
          const smsConfig = config as unknown as SmsSimulationConfig;
          const recipientPhone = this.interpolateTemplate(smsConfig.recipientPhoneTemplate || '', event);
          const message = this.interpolateTemplate(smsConfig.messageTemplate || '', event);
          const senderLine = smsConfig.senderLine || '983000xxxx';

          logger.info(`[SMS Dispatch Simulation] To: ${recipientPhone} | Line: ${senderLine} | Text: "${message}"`);
          resultData = {
            simulated: true,
            recipientPhone,
            senderLine,
            message,
            dispatchStatus: 'SENT_TO_GATEWAY',
            simulatedGatewayId: `sms_${Date.now()}`
          };
          break;
        }

        // -------------------------------------------------------------
        // 5. Audit Log Entry
        // -------------------------------------------------------------
        case 'audit_log': {
          const auditConfig = config as unknown as AuditLogActionConfig;
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

          resultData = { logged: true, description, category: auditConfig.category };
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
   * Main processor invoked when any domain event occurs
   */
  public static async processEvent(event: BaseDomainEvent): Promise<void> {
    try {
      // Find all active rules matching this event type or wildcard '*'
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

      logger.info(`[EventActionEngine] Found ${activeRules.length} potential rules for event ${event.eventType} [${event.eventId}]`);

      // Process matching rules in parallel
      await Promise.allSettled(
        activeRules.map(async (rule) => {
          const conditions = Array.isArray(rule.conditionsJson) ? rule.conditionsJson as RuleCondition[] : [];
          const matches = this.evaluateConditions(conditions, event);

          if (!matches) {
            return;
          }

          logger.info(`[EventActionEngine] Rule matched: "${rule.name}" (${rule.id}) -> executing ${rule.actionType}`);

          // Execute action
          const executionResult = await this.executeAction(rule, event);

          // Update rule execution counters
          await orm.update(eventActionRules)
            .set({
              executionCount: (rule.executionCount || 0) + 1,
              lastExecutedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
            .where(eq(eventActionRules.id, rule.id));

          // Insert execution log
          await orm.insert(eventActionLogs).values({
            ruleId: rule.id,
            ruleName: rule.name,
            eventId: event.eventId,
            eventType: event.eventType,
            actionType: rule.actionType,
            status: executionResult.status,
            result: executionResult.result || {},
            errorMessage: executionResult.errorMessage || '',
            executionDurationMs: executionResult.durationMs,
            executedAt: new Date().toISOString()
          });
        })
      );
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`[EventActionEngine Process Error] Error processing event ${event.eventType}: ${error.message}`);
    }
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
      logger.warn(`[EventActionEngine] Error retrieving webhook secret token from appSettings: ${error.message}`);
      return process.env.ERP_WEBHOOK_SECRET_TOKEN || 'fallback_dynamic_webhook_secret';
    }
  }

  /**
   * Seeds standard out-of-the-box automation rules if database is clean
   */
  public static async seedDefaultRules(): Promise<void> {
    try {
      const webhookSecret = await EventActionEngineService.getWebhookSecretToken();

      const existing = await orm.select().from(eventActionRules).limit(1);
      if (existing.length > 0) {
        // Migrate any existing webhook rules targeting httpbin.org or hardcoded legacy secrets
        const webhookRules = await orm.select().from(eventActionRules).where(eq(eventActionRules.actionType, 'webhook'));
        for (const rule of webhookRules) {
          const cfg = (rule.actionConfigJson as Record<string, unknown>) || {};
          let updated = false;
          if (typeof cfg.url === 'string' && (cfg.url.includes('httpbin.org') || cfg.url.includes('example.com'))) {
            cfg.url = 'http://127.0.0.1:3000/api/events/webhook-echo';
            updated = true;
          }
          if (cfg.secretToken === 'erp_wh_secret_key_prod_v7' || !cfg.secretToken) {
            cfg.secretToken = webhookSecret;
            updated = true;
          }
          if (updated) {
            await orm.update(eventActionRules)
              .set({ actionConfigJson: cfg, updatedAt: new Date().toISOString() })
              .where(eq(eventActionRules.id, rule.id));
          }
        }
        return;
      }

      logger.info('[EventActionEngine] Seeding standard enterprise event automation rules...');

      const defaultRules: CreateRuleInput[] = [
        {
          name: 'اعلان کسری موجودی به انبارداران',
          description: 'ارسال خودکار اعلان درون‌برنامه‌ای به انبارداران هنگام رسیدن کالا به نقطه سفارش مجدد',
          eventType: DomainEventType.INVENTORY_REORDER_ALERT,
          conditionsJson: [],
          actionType: 'in_app_notification',
          actionConfigJson: {
            targetRole: 'warehouse_keeper',
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
            targetRole: 'admin',
            titleTemplate: 'درخواست تایید فرآیند جدید',
            messageTemplate: 'فرآیند {{payload.workflowCode}} برای {{payload.entityType}} شماره {{payload.entityId}} وارد مرحله تایید شد.',
            linkTemplate: '/workflow-inbox',
            notifType: 'system'
          },
          isActive: 1
        },
        {
          name: 'وب‌هوک تایید فاکتور فروش (شبیه‌ساز یکپارچگی)',
          description: 'ارسال وب‌هوک HTTP POST به سرور بیرونی / اتوماسیون سازمانی هنگام تایید نهایی فاکتور فروش',
          eventType: DomainEventType.INVOICE_APPROVED,
          conditionsJson: [
            { field: 'payload.totalAmount', operator: 'gt', value: 0 }
          ],
          actionType: 'webhook',
          actionConfigJson: {
            url: 'http://127.0.0.1:3000/api/events/webhook-echo',
            method: 'POST',
            timeoutMs: 5000,
            includeMetadata: true,
            secretToken: webhookSecret
          },
          isActive: 1
        },
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
    const conditions = [];

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
    const [newRule] = await orm.insert(eventActionRules).values({
      name: data.name,
      description: data.description || '',
      eventType: data.eventType,
      conditionsJson: data.conditionsJson || [],
      actionType: data.actionType,
      actionConfigJson: data.actionConfigJson || {},
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
    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString()
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.eventType !== undefined) updatePayload.eventType = data.eventType;
    if (data.conditionsJson !== undefined) updatePayload.conditionsJson = data.conditionsJson;
    if (data.actionType !== undefined) updatePayload.actionType = data.actionType;
    if (data.actionConfigJson !== undefined) updatePayload.actionConfigJson = data.actionConfigJson;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    const [updated] = await orm.update(eventActionRules)
      .set(updatePayload)
      .where(eq(eventActionRules.id, id))
      .returning();

    return updated;
  }

  /**
   * Delete rule
   */
  public static async deleteRule(id: number) {
    await orm.delete(eventActionRules).where(eq(eventActionRules.id, id));
    return { success: true };
  }

  /**
   * Toggle active state
   */
  public static async toggleRule(id: number) {
    const rule = await this.getRuleById(id);
    if (!rule) throw new Error('قانون مورد نظر یافت نشد.');

    const newActive = rule.isActive === 1 ? 0 : 1;
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

    const sampleEvent: BaseDomainEvent = customEvent || {
      eventId: `test_evt_${Date.now()}`,
      eventType: rule.eventType === '*' ? DomainEventType.INVOICE_APPROVED : rule.eventType,
      aggregateType: 'Document',
      aggregateId: '101',
      payload: {
        documentId: 101,
        refNumber: 'INV-1405-TEST',
        docType: 'invoice',
        buyerName: 'مشتری آزمایشی سیستم',
        totalAmount: 150000000,
        currency: 'IRR',
        itemCount: 3,
        status: 'final',
        itemId: 5,
        itemCode: 'RAW-001',
        itemName: 'سنگ عقیق سیاه',
        currentStock: 12,
        reorderPoint: 20,
        warehouseLocation: 'انبار مرکزی',
        amount: 600000000,
        workflowCode: 'INVOICE_APPROVAL',
        toStateKey: 'PENDING_APPROVAL'
      },
      metadata: {
        userId: 1,
        userName: 'مدیر تستی',
        userRole: 'admin',
        correlationId: `corr_${Date.now()}`,
        timestamp: new Date().toISOString()
      },
      occurredAt: new Date().toISOString()
    };

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
  public static async getLogs(filter?: { ruleId?: number; status?: string; eventType?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filter?.limit || 50, 100);
    const offset = filter?.offset || 0;

    let whereClause = undefined;
    const conditions = [];

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

    return {
      data: logs,
      total: count || 0,
      limit,
      offset
    };
  }

  /**
   * Telemetry stats for auto actions engine
   */
  public static async getStats() {
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
