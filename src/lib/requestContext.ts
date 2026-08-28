import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface RequestContextStore {
  requestId: string;
  correlationId: string;
  userId?: number;
  username?: string;
  entityId?: string;
  workflowId?: string;
  transactionId?: string;
  action?: string;
  startTime: number;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore | undefined {
  return requestContextStorage.getStore();
}

export function updateRequestContext(updates: Partial<RequestContextStore>): void {
  const store = requestContextStorage.getStore();
  if (store) {
    Object.assign(store, updates);
  }
}

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const headerReqId = req.headers['x-request-id'] as string;
  const headerCorrId = req.headers['x-correlation-id'] as string;

  const requestId = headerReqId || `req_${uuidv4().substring(0, 12)}`;
  const correlationId = headerCorrId || headerReqId || `corr_${uuidv4().substring(0, 12)}`;

  // Attach to Express req object as well
  (req as any).requestId = requestId;
  (req as any).correlationId = correlationId;

  // Set response headers for client tracing
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Correlation-ID', correlationId);

  const store: RequestContextStore = {
    requestId,
    correlationId,
    userId: (req as any).user?.id,
    username: (req as any).user?.username,
    startTime: Date.now()
  };

  requestContextStorage.run(store, () => {
    next();
  });
};
