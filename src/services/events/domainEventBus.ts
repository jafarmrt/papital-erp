import { EventEmitter } from 'events';
import { logger } from '../../middleware/logger.js';
import { 
  BaseDomainEvent, 
  DomainEventType, 
  DomainEventMetadata,
  createDomainEvent,
  validateDomainEvent
} from './domainEvents.js';

type DomainEventHandler<T = unknown> = (event: BaseDomainEvent<T>) => Promise<void> | void;

/**
 * v7.0.25 (TD-183 / audit P1-1): نتیجه دیسپچ قابل‌ردیابی برای Outbox و بازپخش DLQ.
 * `completedHandlers` نام همه هندلرهایی است که برای این رویداد (در این یا تلاش‌های قبلی) موفق بوده‌اند.
 */
export interface TrackedDispatchResult {
  completedHandlers: string[];
  failures: Array<{ handler: string; error: string }>;
}

interface RegisteredHandler {
  name: string;
  handler: DomainEventHandler;
}

class DomainEventBusEmitter extends EventEmitter {
  private recentEvents: BaseDomainEvent[] = [];
  private readonly MAX_RECENT_EVENTS = 200;
  private eventCounts: Record<string, number> = {};
  /** v7.0.25 (TD-183): ثبت خام هندلرها (بدون بلعیدن خطا) برای دیسپچ قابل‌ردیابی Outbox */
  private handlerRegistry = new Map<string, RegisteredHandler[]>();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Helper to create standard event envelope
   */
  createEvent<T>(
    eventType: DomainEventType | string,
    aggregateType: BaseDomainEvent['aggregateType'],
    aggregateId: string | number,
    payload: T,
    metadata?: Partial<DomainEventMetadata>
  ): BaseDomainEvent<T> {
    return createDomainEvent<T>({
      eventType,
      aggregateType,
      aggregateId,
      payload,
      metadata
    });
  }

  /**
   * Publish a domain event to all registered in-memory subscribers
   */
  async publish<T = unknown>(event: BaseDomainEvent<T>): Promise<void> {
    try {
      // 0. Validate contract
      const validation = validateDomainEvent(event);
      if (!validation.valid) {
        throw new Error(`اعتبارسنجی قرارداد رویداد با خطا مواجه شد: ${validation.errors.join(' | ')}`);
      }

      // 1. Record stats and recent buffer
      this.recordStats(event as BaseDomainEvent);

      logger.info(`[DomainEventBus] Emitting event: ${event.eventType} for ${event.aggregateType}#${event.aggregateId} [EventID: ${event.eventId}]`);

      // 2. Emit specific event type
      this.emit(event.eventType, event);

      // 3. Emit wildcard / all events
      this.emit('*', event);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[DomainEventBus Publish Error] Failed to dispatch event ${event.eventType}: ${errMsg}`);
    }
  }

  private recordStats(event: BaseDomainEvent): void {
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
      this.recentEvents.pop();
    }
    this.eventCounts[event.eventType] = (this.eventCounts[event.eventType] || 0) + 1;
  }

  private registerHandler(eventType: string, handler: DomainEventHandler, name?: string): string {
    const list = this.handlerRegistry.get(eventType) ?? [];
    // نام پیش‌فرض بر اساس ترتیب ثبت قطعی است (ثبت هندلرها در راه‌اندازی همیشه با یک ترتیب انجام می‌شود)
    const handlerName = name || `${eventType}#${list.length + 1}`;
    list.push({ name: handlerName, handler });
    this.handlerRegistry.set(eventType, list);
    return handlerName;
  }

  /**
   * v7.0.25 (TD-183 / audit P1-1): دیسپچ قابل‌ردیابی برای Outbox و بازپخش DLQ.
   * برخلاف `publish` (که طبق AGENTS.md §15 غیرمسدودکننده است و خطاها را فقط لاگ می‌کند)، این متد منتظر همه
   * هندلرها می‌ماند و شکست هر هندلر را گزارش می‌کند تا Outbox بتواند با backoff تلاش مجدد کند و در نهایت
   * رویداد را به DLQ منتقل نماید. هندلرهایی که قبلاً برای همین رویداد موفق شده‌اند دوباره اجرا نمی‌شوند.
   */
  async dispatchTracked<T = unknown>(
    event: BaseDomainEvent<T>,
    alreadyCompleted: readonly string[] = []
  ): Promise<TrackedDispatchResult> {
    const validation = validateDomainEvent(event);
    if (!validation.valid) {
      throw new Error(`اعتبارسنجی قرارداد رویداد با خطا مواجه شد: ${validation.errors.join(' | ')}`);
    }
    this.recordStats(event as BaseDomainEvent);

    const done = new Set(alreadyCompleted);
    const targets = [
      ...(this.handlerRegistry.get(event.eventType) ?? []),
      ...(this.handlerRegistry.get('*') ?? []),
    ].filter(h => !done.has(h.name));

    logger.info(`[DomainEventBus] Tracked dispatch: ${event.eventType} [EventID: ${event.eventId}] → ${targets.length} handler(s) (${done.size} already completed)`);

    const results = await Promise.allSettled(targets.map(h => Promise.resolve().then(() => h.handler(event as BaseDomainEvent))));
    const failures: TrackedDispatchResult['failures'] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        done.add(targets[i].name);
      } else {
        const reason = result.reason;
        failures.push({ handler: targets[i].name, error: reason instanceof Error ? reason.message : String(reason) });
      }
    });

    return { completedHandlers: [...done], failures };
  }

  /**
   * Helper to construct and immediately publish a domain event
   */
  async publishEvent<T = unknown>(
    eventType: DomainEventType | string,
    aggregateType: BaseDomainEvent['aggregateType'],
    aggregateId: string,
    payload: T,
    metadata?: Partial<DomainEventMetadata>
  ): Promise<BaseDomainEvent<T>> {
    const event = this.createEvent<T>(eventType, aggregateType, aggregateId, payload, metadata);
    await this.publish(event);
    return event;
  }

  /**
   * Strongly typed subscription
   */
  subscribe<T = unknown>(eventType: DomainEventType | string, handler: DomainEventHandler<T>, name?: string): void {
    this.registerHandler(String(eventType), handler as DomainEventHandler, name);
    this.on(eventType, async (event: BaseDomainEvent<T>) => {
      try {
        await handler(event);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        logger.error(`[DomainEventBus Handler Error] Error in handler for ${eventType}: ${errMsg}`, {
          eventId: event.eventId,
          error: errStack
        });
      }
    });
  }

  /**
   * Subscribe to all domain events
   */
  subscribeAll(handler: DomainEventHandler, name?: string): void {
    this.registerHandler('*', handler, name);
    this.on('*', async (event: BaseDomainEvent) => {
      try {
        await handler(event);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[DomainEventBus All Handler Error] Error in wildcard handler: ${errMsg}`);
      }
    });
  }

  /**
   * Get recent domain events for inspection / telemetry
   */
  getRecentEvents(limit: number = 50, filterType?: string): BaseDomainEvent[] {
    let list = this.recentEvents;
    if (filterType && filterType !== 'ALL') {
      list = list.filter(e => e.eventType === filterType || e.aggregateType === filterType);
    }
    return list.slice(0, limit);
  }

  /**
   * Get statistics of emitted events
   */
  getEventStats() {
    return {
      totalEmitted: Object.values(this.eventCounts).reduce((a, b) => a + b, 0),
      eventCounts: { ...this.eventCounts },
      recentCount: this.recentEvents.length
    };
  }
}

export const domainEventBus = new DomainEventBusEmitter();
