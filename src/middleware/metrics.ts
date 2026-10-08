import promClient from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { orm, pool } from '../db/drizzle.js';
import { integrationDeliveryJobs, outboxEvents } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { SystemHealthService } from '../services/system/systemHealth.service.js';
import { logger } from './logger.js';
import { errorMessageOf } from '../utils.js';

// Collect default metrics (GC, event loop, memory, etc.)
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ register: promClient.register });

// Custom metrics
export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 3, 5, 10],
});

export const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const dbPoolTotal = new promClient.Gauge({
  name: 'db_pool_total_connections',
  help: 'Total DB pool connections',
});

export const dbPoolIdle = new promClient.Gauge({
  name: 'db_pool_idle_connections',
  help: 'Idle DB pool connections',
});

export const dbPoolWaiting = new promClient.Gauge({
  name: 'db_pool_waiting_count',
  help: 'Waiting DB pool count',
});

export const outboxQueueDepth = new promClient.Gauge({
  name: 'outbox_queue_depth',
  help: 'Number of pending events in outbox',
});

// v10.0.3 (OBS-R2-11): the queues an operator must act on, read on every scrape; scripts/monitor.sh alerts on them
export const queueMetricsUp = new promClient.Gauge({
  name: 'erp_queue_metrics_up',
  help: '1 when the queue gauges below were read on this scrape, 0 when the read failed (their values are then stale)',
});

export const deadLetterUnresolved = new promClient.Gauge({
  name: 'erp_dead_letter_unresolved',
  help: 'Unresolved dead-letter events (neither replayed nor dismissed), failed integration deliveries included',
});

export const outboxFailed = new promClient.Gauge({
  name: 'erp_outbox_failed',
  help: 'Outbox events in status failed',
});

export const outboxStuck = new promClient.Gauge({
  name: 'erp_outbox_stuck',
  help: 'Outbox events stuck in processing for more than five minutes',
});

export const integrationDeliveriesRetrying = new promClient.Gauge({
  name: 'erp_integration_deliveries_retrying',
  help: 'Integration deliveries (webhook, rule action) waiting for another attempt after a failed one',
});

export const integrationDeliveriesFailed = new promClient.Gauge({
  name: 'erp_integration_deliveries_failed',
  help: 'Integration deliveries that failed for good (each is also an unresolved dead-letter row until handled)',
});

export const outboxProcessingDuration = new promClient.Histogram({
  name: 'outbox_processing_duration_seconds',
  help: 'Duration of outbox event processing',
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

/**
 * v9.0.143 (TD-582): the route label is bounded by the route table: the mount prefix plus the matched
 * route pattern; a request that matched no route (404, 401 before a router, static files) never
 * carries its raw path, or every unknown path would add series that are never freed.
 */
export function metricsRouteLabel(req: Request): string {
  const pattern: unknown = req.route?.path;
  if (typeof pattern === 'string') return `${req.baseUrl || ''}${pattern}` || '/';
  if (pattern instanceof RegExp) return `${req.baseUrl || ''}${pattern.source}`;
  if (Array.isArray(pattern)) return `${req.baseUrl || ''}${pattern.map(String).join('|')}`;
  const p = req.originalUrl?.split('?')[0] || req.path || '';
  return p === '/api' || p.startsWith('/api/') ? 'unmatched_api' : 'unmatched';
}

// Middleware for tracking HTTP metrics
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = metricsRouteLabel(req);
    
    httpRequestDuration
      .labels(req.method, route, String(res.statusCode))
      .observe(duration);
    
    httpRequestTotal
      .labels(req.method, route, String(res.statusCode))
      .inc();
  });
  
  next();
};

// Function to update gauges
/**
 * v9.0.165 (TD-596): connection counts of the application pool exported by drizzle.ts. drizzle-orm 0.45 exposes
 * the pool only as `orm.$client`; the old `orm.pool || orm.client?.pool` was always undefined, so readiness and
 * these gauges reported 0 and the «pool saturated» branch never ran.
 */
export function dbPoolStats(): { total: number; idle: number; waiting: number } {
  return { total: pool.totalCount || 0, idle: pool.idleCount || 0, waiting: pool.waitingCount || 0 };
}

export const updateDbPoolMetrics = () => {
  const { total, idle, waiting } = dbPoolStats();
  dbPoolTotal.set(total);
  dbPoolIdle.set(idle);
  dbPoolWaiting.set(waiting);
};

/**
 * v10.0.3 (OBS-R2-11): the outbox depth and the queue gauges. A failed read sets `erp_queue_metrics_up` to 0 and is
 * logged, never swallowed (the previous `catch {}` left the gauges at their old values with nothing to tell).
 */
export const updateOutboxMetrics = async () => {
  try {
    const [pending] = await orm.select({ count: sql<number>`count(*)::int` }).from(outboxEvents)
      .where(eq(outboxEvents.status, 'pending'));
    const [failed] = await orm.select({ count: sql<number>`count(*)::int` }).from(outboxEvents)
      .where(eq(outboxEvents.status, 'failed'));
    const [deliveries] = await orm.select({
      retrying: sql<number>`count(*) FILTER (WHERE ${integrationDeliveryJobs.status} = 'pending' AND ${integrationDeliveryJobs.attempts} > 0)::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${integrationDeliveryJobs.status} = 'failed')::int`,
    }).from(integrationDeliveryJobs);
    const dlq = await SystemHealthService.countDeadLetterEvents();
    const stuck = await SystemHealthService.countStuckOutboxEvents();
    outboxQueueDepth.set(Number(pending?.count ?? 0));
    outboxFailed.set(Number(failed?.count ?? 0));
    integrationDeliveriesRetrying.set(Number(deliveries?.retrying ?? 0));
    integrationDeliveriesFailed.set(Number(deliveries?.failed ?? 0));
    deadLetterUnresolved.set(dlq);
    outboxStuck.set(stuck);
    queueMetricsUp.set(1);
  } catch (err) {
    queueMetricsUp.set(0);
    logger.error(`[Metrics] queue gauges could not be read: ${errorMessageOf(err)}`);
  }
};

// Function to record duration
export const observeOutboxProcessing = (duration: number) => {
  outboxProcessingDuration.observe(duration);
};
