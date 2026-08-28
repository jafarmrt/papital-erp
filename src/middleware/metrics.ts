import promClient from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { orm } from '../db/drizzle.js';
import { outboxEvents } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

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

export const outboxProcessingDuration = new promClient.Histogram({
  name: 'outbox_processing_duration_seconds',
  help: 'Duration of outbox event processing',
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

// Middleware for tracking HTTP metrics
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    
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
export const updateDbPoolMetrics = () => {
  const pool = (orm as any).pool || (orm as any).client?.pool;
  if (pool) {
    dbPoolTotal.set(pool.totalCount || 0);
    dbPoolIdle.set(pool.idleCount || 0);
    dbPoolWaiting.set(pool.waitingCount || 0);
  }
};

export const updateOutboxMetrics = async () => {
  try {
    const [result] = await orm.select({ count: sql<number>`count(*)` })
      .from(outboxEvents)
      .where(eq(outboxEvents.status, 'pending'));
    outboxQueueDepth.set(result ? Number(result.count || 0) : 0);
  } catch {}
};

// Function to record duration
export const observeOutboxProcessing = (duration: number) => {
  outboxProcessingDuration.observe(duration);
};
