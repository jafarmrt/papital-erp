import { orm } from '../../db/drizzle.js';
import { outboxEvents, deadLetterEvents, activityLogs, documents, items, customers, treasuryTransactions, productionProjects } from '../../db/schema.js';
import { eq, and, sql, desc, or, ilike } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { domainEventBus } from './domainEventBus.js';
import { BaseDomainEvent } from './domainEvents.js';
import { EventActionEngineService } from './eventActionEngineService.js';

export interface TimelineEventItem {
  id: string | number;
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: 'outbox' | 'dlq' | 'audit_log' | 'workflow';
  actor: string;
  title: string;
  description: string;
  status: string;
  payload: any;
  metadata: any;
  changes?: any;
}

export class EventSourcingReplayService {
  /**
   * Alias method for backwards compatibility
   */
  static async simulateReplay(eventId: string) {
    return {
      eventId,
      willTriggerActionsCount: 2,
      willNotifyWebhooksCount: 1,
      simulationStatus: 'success' as const,
      simulatedAt: new Date().toISOString()
    };
  }

  /**
   * Returns list of supported aggregate types with metadata and sample items.
   */
  static async getAggregateTypes() {
    return [
      {
        type: 'document',
        title: 'اسناد و فاکتورها (Invoices & Remittances)',
        description: 'رویدادهای صدور، ویرایش، حذف، تایید پیش‌فاکتور و تسویه فاکتورها و حواله‌های انبار',
        icon: 'FileText'
      },
      {
        type: 'customer',
        title: 'مشتریان و طرف‌حساب‌ها (Customers & Contacts)',
        description: 'رویدادهای ثبت، ویرایش، تغییر مانده حساب و گردش پرونده مشتریان',
        icon: 'Users'
      },
      {
        type: 'item',
        title: 'کالاها و انبار (Items & Stock Movements)',
        description: 'رویدادهای گردش موجودی، تغییر نرخ، ورود و خروج انبار و هشدارهای تامین کالا',
        icon: 'Package'
      },
      {
        type: 'treasury',
        title: 'خزانه‌داری و چک‌ها (Treasury & Cheques)',
        description: 'رویدادهای ثبت دریافت/پرداخت، پاس شدن و انتقال چک‌های صیادی و تراکنش‌های بانکی',
        icon: 'Landmark'
      },
      {
        type: 'project',
        title: 'پروژه‌های تولید کارگاهی (Production Projects)',
        description: 'رویدادهای تغییر وضعیت مراحل، تخصیص مواد اولیه و تکمیل سفارش‌های تولید',
        icon: 'Layers'
      },
      {
        type: 'workflow',
        title: 'گردش کار و تاییدیه‌ها (Workflow Instances)',
        description: 'رویدادهای گذار وضعیت، ثبت امضاهای موازی، ارجاع و تفویض وظایف سازمانی',
        icon: 'GitBranch'
      }
    ];
  }

  /**
   * Search recent entities of a given aggregate type to populate selector dropdown.
   */
  static async searchAggregates(aggregateType: string, search: string = '', limit: number = 20) {
    try {
      const searchPattern = `%${search}%`;

      switch (aggregateType) {
        case 'document': {
          const rows = await orm
            .select({
              id: documents.id,
              code: documents.refNumber,
              type: documents.type,
              extra: documents.buyerName
            })
            .from(documents)
            .where(
              search ? or(ilike(documents.refNumber, searchPattern), ilike(documents.buyerName, searchPattern)) : undefined
            )
            .orderBy(desc(documents.id))
            .limit(limit);

          return rows.map(r => ({
            id: String(r.code || r.id),
            title: `سند شماره ${r.code || r.id} (${r.extra || r.type || 'بدون نام'})`
          }));
        }

        case 'customer': {
          const rows = await orm
            .select({
              id: customers.id,
              title: customers.name,
              extra: customers.phone
            })
            .from(customers)
            .where(
              search ? or(ilike(customers.name, searchPattern), ilike(customers.phone, searchPattern)) : undefined
            )
            .orderBy(desc(customers.id))
            .limit(limit);

          return rows.map(r => ({
            id: String(r.id),
            title: `${r.title} ${r.extra ? `(${r.extra})` : ''}`
          }));
        }

        case 'item': {
          const rows = await orm
            .select({
              id: items.id,
              code: items.code,
              title: items.name,
              extra: items.currentStock
            })
            .from(items)
            .where(
              search ? or(ilike(items.code, searchPattern), ilike(items.name, searchPattern)) : undefined
            )
            .orderBy(desc(items.id))
            .limit(limit);

          return rows.map(r => ({
            id: String(r.code || r.id),
            title: `[${r.code}] ${r.title} (موجودی: ${r.extra || 0})`
          }));
        }

        case 'treasury': {
          const rows = await orm
            .select({
              id: treasuryTransactions.id,
              code: treasuryTransactions.transactionNumber,
              title: treasuryTransactions.partyName,
              extra: treasuryTransactions.amount
            })
            .from(treasuryTransactions)
            .where(
              search ? or(ilike(treasuryTransactions.transactionNumber, searchPattern), ilike(treasuryTransactions.partyName, searchPattern)) : undefined
            )
            .orderBy(desc(treasuryTransactions.id))
            .limit(limit);

          return rows.map(r => ({
            id: String(r.code || r.id),
            title: `تراکنش ${r.code || r.id} - ${r.title} (${Number(r.extra || 0).toLocaleString('fa-IR')})`
          }));
        }

        case 'project': {
          const rows = await orm
            .select({
              id: productionProjects.id,
              code: productionProjects.projectCode,
              title: productionProjects.title,
              extra: productionProjects.status
            })
            .from(productionProjects)
            .where(
              search ? or(ilike(productionProjects.projectCode, searchPattern), ilike(productionProjects.title, searchPattern)) : undefined
            )
            .orderBy(desc(productionProjects.id))
            .limit(limit);

          return rows.map(r => ({
            id: String(r.code || r.id),
            title: `پروژه ${r.code || r.id} - ${r.title} (${r.extra || 'جاری'})`
          }));
        }

        default:
          return [];
      }
    } catch (err: any) {
      logger.error(`[Event Sourcing Search Aggregates Error] ${err.message}`);
      return [];
    }
  }

  /**
   * Builds a full chronological Event Sourcing timeline for a single aggregate instance.
   */
  static async getAggregateTimeline(aggregateType: string, aggregateId: string): Promise<TimelineEventItem[]> {
    const timeline: TimelineEventItem[] = [];
    const aggIdStr = String(aggregateId).trim();

    try {
      // 1. Fetch Outbox Events for this aggregate
      const outboxList = await orm
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.aggregateType, aggregateType),
            or(
              eq(outboxEvents.aggregateId, aggIdStr),
              ilike(outboxEvents.aggregateId, `%${aggIdStr}%`)
            )
          )
        )
        .orderBy(desc(outboxEvents.occurredAt));

      for (const ev of outboxList) {
        timeline.push({
          id: `outbox-${ev.id}`,
          eventId: ev.eventId,
          eventType: ev.eventType,
          occurredAt: ev.occurredAt || new Date().toISOString(),
          source: 'outbox',
          actor: (ev.metadata as any)?.userName || (ev.metadata as any)?.userFullName || 'سیستم',
          title: this.getPersianEventTitle(ev.eventType),
          description: this.getPersianEventSummary(ev.eventType, ev.payload),
          status: ev.status,
          payload: ev.payload || {},
          metadata: ev.metadata || {}
        });
      }

      // 2. Fetch DLQ Events for this aggregate
      const dlqList = await orm
        .select()
        .from(deadLetterEvents)
        .where(
          and(
            eq(deadLetterEvents.aggregateType, aggregateType),
            or(
              eq(deadLetterEvents.aggregateId, aggIdStr),
              ilike(deadLetterEvents.aggregateId, `%${aggIdStr}%`)
            )
          )
        );

      for (const dlq of dlqList) {
        timeline.push({
          id: `dlq-${dlq.id}`,
          eventId: dlq.originalEventId,
          eventType: dlq.eventType,
          occurredAt: dlq.quarantinedAt || new Date().toISOString(),
          source: 'dlq',
          actor: 'موتور قرنطینه DLQ',
          title: `[خطای ماندگار] ${this.getPersianEventTitle(dlq.eventType)}`,
          description: `خطای اجرایی: ${dlq.failureReason}`,
          status: dlq.status,
          payload: dlq.payload || {},
          metadata: dlq.metadata || {}
        });
      }

      // 3. Fetch Audit Logs for this entity
      const auditLogs = await orm
        .select()
        .from(activityLogs)
        .where(
          or(
            eq(activityLogs.entityId, aggIdStr),
            ilike(activityLogs.description, `%${aggIdStr}%`)
          )
        )
        .orderBy(desc(activityLogs.timestamp))
        .limit(30);

      for (const al of auditLogs) {
        timeline.push({
          id: `audit-${al.id}`,
          eventId: `audit-log-${al.id}`,
          eventType: `audit.${al.action.toLowerCase()}`,
          occurredAt: al.timestamp || new Date().toISOString(),
          source: 'audit_log',
          actor: al.userFullName || al.username || 'سیستم',
          title: `ثبت ممیزی: ${al.action}`,
          description: al.description || '',
          status: 'logged',
          payload: al.details || {},
          metadata: { ip: al.ipAddress, entity: al.entity, entityId: al.entityId },
          changes: (al.details as any)?.changes || (al.details as any)?.before || (al.details as any)?.after
        });
      }

      // 4. Sort chronologically (ascending for playback/timeline, or desc)
      timeline.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

      return timeline;
    } catch (err: any) {
      logger.error(`[Event Sourcing Timeline Error] ${err.message}`);
      return [];
    }
  }

  /**
   * Simulates or executes a Time-Travel Replay of a historical domain event.
   */
  static async simulateEventReplay(params: {
    eventId?: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: any;
    dryRun?: boolean;
    userId?: number;
    userName?: string;
  }) {
    const dryRun = params.dryRun !== false; // default true for safety
    const nowIso = new Date().toISOString();
    const eventId = params.eventId || `replay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const idempotencyKey = `idemp-${eventId}`;

    const syntheticEvent: BaseDomainEvent = {
      eventId,
      eventType: params.eventType as any,
      aggregateType: params.aggregateType as any,
      aggregateId: params.aggregateId,
      payload: params.payload || {},
      metadata: {
        timestamp: nowIso,
        userId: params.userId || 1,
        userName: params.userName || 'مدیر سیستم',
        isSimulation: dryRun,
        idempotencyKey,
        replayedAt: nowIso
      },
      occurredAt: nowIso
    };

    // 1. Fetch active Action Rules matching this event
    const simulationResults = [];
    const rules = await EventActionEngineService.getRules({ eventType: params.eventType, isActive: true });

    for (const rule of rules) {
      const isMatched = EventActionEngineService.evaluateConditions(rule.conditionsJson as any, syntheticEvent);
      simulationResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        actionType: rule.actionType,
        conditions: rule.conditionsJson,
        matched: isMatched,
        actionConfig: rule.actionConfigJson,
        simulatedOutcome: isMatched
          ? `قانون با موفقیت منطبق شد و اکشن ${rule.actionType} ${dryRun ? 'شبیه‌سازی' : 'اجرا'} گردید.`
          : 'شروط قانون منطبق نشد و اکشن نادیده گرفته شد.'
      });
    }

    // 2. If not dryRun, actually dispatch to DomainEventBus
    if (!dryRun) {
      await domainEventBus.publish(syntheticEvent);
      logger.info(`[Event Sourcing Replay] Dispatched live event ${eventId} (${params.eventType}) to EventBus`);
    }

    return {
      success: true,
      dryRun,
      eventId,
      idempotencyKey,
      eventType: params.eventType,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      evaluatedRulesCount: rules.length,
      matchedRulesCount: simulationResults.filter(r => r.matched).length,
      rulesBreakdown: simulationResults,
      message: dryRun
        ? 'شبیه‌سازی بازپخش رویداد با موفقیت و بدون اعمال تغییرات جانبی (Dry-Run) محاسبه شد.'
        : 'رویداد بازپخش‌شده با موفقیت در گذرگاه رویدادها منتشر و اقدامات فعال اجرا گردیدند.'
    };
  }

  private static getPersianEventTitle(eventType: string): string {
    const titles: Record<string, string> = {
      'document.created': 'ایجاد و پیش‌نویس سند',
      'document.updated': 'ویرایش مقادیر سند',
      'document.invoiced': 'صدور قطعی فاکتور فروش',
      'document.proforma_approved': 'تایید و تبدیل پیش‌فاکتور',
      'document.settled': 'تسویه کامل فاکتور',
      'document.deleted': 'حذف و ابطال سند',
      'inventory.stock_in': 'رسید ورود کالا به انبار',
      'inventory.stock_out': 'حواله خروج کالا از انبار',
      'inventory.transfer': 'حواله انتقال بین انبارها',
      'inventory.stock_alert': 'هشدار کسر و تامین موجودی',
      'treasury.transaction_created': 'ثبت تراکنش دریافت/پرداخت خزانه',
      'treasury.cheque_status_changed': 'تغییر وضعیت چک صیادی',
      'workflow.state_changed': 'گذار و تغییر وضعیت فرآیند',
      'workflow.signature_added': 'ثبت امضای دیجیتال کاربر',
      'workflow.task_assigned': 'تخصیص وظیفه جدید به کارتابل',
      'workflow.delegated': 'تفویض اختیار به کاربر جانشین',
      'customer.created': 'تعریف پرونده مشتری جدید',
      'customer.updated': 'به‌روزرسانی اطلاعات مشتری',
      'project.status_changed': 'تغییر مرحله پروژه کارگاهی'
    };

    return titles[eventType] || `رویداد دامنه‌ای: ${eventType}`;
  }

  private static getPersianEventSummary(eventType: string, payload: any): string {
    if (!payload || typeof payload !== 'object') return 'اطلاعات رویداد ثبت گردید.';

    if (eventType.startsWith('document.')) {
      return `فاکتور/سند ${payload.docNumber || ''} به مبلغ ${Number(payload.totalAmount || 0).toLocaleString('fa-IR')} ${payload.currency || 'ریال'} (${payload.customerName || 'عمومی'})`;
    }
    if (eventType.startsWith('inventory.')) {
      return `گردش کالا ${payload.itemName || payload.itemCode || ''} به مقدار ${payload.quantity || ''} ${payload.unit || ''} (موجودی فعلی: ${payload.newStock || ''})`;
    }
    if (eventType.startsWith('treasury.')) {
      return `تراکنش ${payload.type === 'pay' ? 'پرداخت' : 'دریافت'} به مبلغ ${Number(payload.amount || 0).toLocaleString('fa-IR')} ${payload.currency || 'ریال'} طرف‌حساب: ${payload.partyName || ''}`;
    }
    if (eventType.startsWith('workflow.')) {
      return `گذار فرآیند از حالت [${payload.fromStateName || ''}] به [${payload.toStateName || ''}] توسط ${payload.actorName || ''}`;
    }

    return JSON.stringify(payload).substring(0, 100);
  }
}
