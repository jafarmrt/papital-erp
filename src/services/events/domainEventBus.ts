import { EventEmitter } from 'events';
import { logger } from '../../middleware/logger.js';
import { 
  BaseDomainEvent, 
  DomainEventType, 
  DomainEventMetadata,
  createDomainEvent,
  validateDomainEvent
} from './domainEvents.js';

type DomainEventHandler<T = any> = (event: BaseDomainEvent<T>) => Promise<void> | void;

class DomainEventBusEmitter extends EventEmitter {
  private recentEvents: BaseDomainEvent[] = [];
  private readonly MAX_RECENT_EVENTS = 200;
  private eventCounts: Record<string, number> = {};

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
  async publish<T = any>(event: BaseDomainEvent<T>): Promise<void> {
    try {
      // 0. Validate contract
      const validation = validateDomainEvent(event);
      if (!validation.valid) {
        throw new Error(`اعتبارسنجی قرارداد رویداد با خطا مواجه شد: ${validation.errors.join(' | ')}`);
      }

      // 1. Record stats and recent buffer
      this.recentEvents.unshift(event);
      if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
        this.recentEvents.pop();
      }
      this.eventCounts[event.eventType] = (this.eventCounts[event.eventType] || 0) + 1;

      logger.info(`[DomainEventBus] Emitting event: ${event.eventType} for ${event.aggregateType}#${event.aggregateId} [EventID: ${event.eventId}]`);

      // 2. Emit specific event type
      this.emit(event.eventType, event);

      // 3. Emit wildcard / all events
      this.emit('*', event);
    } catch (err: any) {
      logger.error(`[DomainEventBus Publish Error] Failed to dispatch event ${event.eventType}: ${err.message}`);
    }
  }

  /**
   * Helper to construct and immediately publish a domain event
   */
  async publishEvent<T = any>(
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
  subscribe<T = any>(eventType: DomainEventType | string, handler: DomainEventHandler<T>): void {
    this.on(eventType, async (event: BaseDomainEvent<T>) => {
      try {
        await handler(event);
      } catch (err: any) {
        logger.error(`[DomainEventBus Handler Error] Error in handler for ${eventType}: ${err.message}`, {
          eventId: event.eventId,
          error: err.stack
        });
      }
    });
  }

  /**
   * Subscribe to all domain events
   */
  subscribeAll(handler: DomainEventHandler): void {
    this.on('*', async (event: BaseDomainEvent) => {
      try {
        await handler(event);
      } catch (err: any) {
        logger.error(`[DomainEventBus All Handler Error] Error in wildcard handler: ${err.message}`);
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
