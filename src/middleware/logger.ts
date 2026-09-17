import winston from 'winston';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getRequestContext } from '../lib/requestContext.js';

const { combine, timestamp, printf, colorize } = winston.format;

// Format rule to inject trace context from AsyncLocalStorage
const contextFormat = winston.format((info) => {
  const ctx = getRequestContext();
  if (ctx) {
    if (ctx.requestId && !info.requestId) info.requestId = ctx.requestId;
    if (ctx.correlationId && !info.correlationId) info.correlationId = ctx.correlationId;
    if (ctx.userId && !info.userId) info.userId = ctx.userId;
    if (ctx.entityId && !info.entityId) info.entityId = ctx.entityId;
    if (ctx.workflowId && !info.workflowId) info.workflowId = ctx.workflowId;
    if (ctx.transactionId && !info.transactionId) info.transactionId = ctx.transactionId;
  }
  return info;
});

function looksLikeJWT(s: string): boolean {
  return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(s) && s.length > 50;
}

function sanitizeString(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [PROTECTED_JWT]')
    .replace(/"(password|new_password|current_password|pass|secret|token)":\s*"[^"]*"/gi, '"$1": "[REDACTED]"');
}

function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (looksLikeJWT(obj)) {
      return '[JWT_REDACTED]';
    }
    return sanitizeString(obj);
  }
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const sanitized: any = {};
  for (const key of Reflect.ownKeys(obj)) {
    const value = (obj as any)[key];
    if (typeof key === 'string' && /password|secret|token|auth|credit.?card|cvv/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && looksLikeJWT(value)) {
      sanitized[key] = '[JWT_REDACTED]';
    } else {
      sanitized[key] = sanitizeObject(value);
    }
  }
  return sanitized;
}

// Sanitize any log message or metadata before writing
const sanitizeFormat = winston.format((info) => {
  return sanitizeObject(info);
});

// Custom log format string builder
const logFormat = printf(({ level, message, timestamp, stack, requestId, correlationId, userId, entityId, workflowId, transactionId }) => {
  const cleanMessage = typeof message === 'object' ? JSON.stringify(message) : message;
  const ctxParts: string[] = [];
  if (requestId) ctxParts.push(`req:${requestId}`);
  if (correlationId && correlationId !== requestId) ctxParts.push(`corr:${correlationId}`);
  if (userId) ctxParts.push(`user:${userId}`);
  if (entityId) ctxParts.push(`entity:${entityId}`);
  if (workflowId) ctxParts.push(`wf:${workflowId}`);
  if (transactionId) ctxParts.push(`tx:${transactionId}`);

  const ctxPrefix = ctxParts.length > 0 ? ` [${ctxParts.join(' | ')}]` : '';
  return `${timestamp} ${level}${ctxPrefix}: ${stack || cleanMessage}`;
});

const isProduction = process.env.NODE_ENV === 'production';
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Ensure log directory exists
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (err) {
  console.error('Failed to create log directory:', err);
}

// Initialize transports with Console by default
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: combine(contextFormat(), sanitizeFormat(), colorize(), logFormat)
  })
];

// Add daily rotate file transports
try {
  const fileTransport = new DailyRotateFile({
    dirname: logDir,
    filename: 'application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '50m',
    maxFiles: '14d',
    zippedArchive: true,
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      contextFormat(),
      sanitizeFormat(),
      winston.format.json()
    )
  });

  const errorFileTransport = new DailyRotateFile({
    level: 'error',
    dirname: logDir,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '50m',
    maxFiles: '30d',
    zippedArchive: true,
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      contextFormat(),
      sanitizeFormat(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    )
  });

  transports.push(fileTransport, errorFileTransport);
} catch (err) {
  console.error('Failed to initialize daily rotate file logging, falling back to console only:', err);
}

// Create Winston Logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    contextFormat(),
    sanitizeFormat(),
    winston.format.errors({ stack: true }),
    logFormat
  ),
  transports,
  exitOnError: false
});

// Setup Morgan to use Winston with stripped URL token (removing sensitive query strings)
morgan.token('stripped-url', (req: any) => {
  try {
    const rawUrl = req.originalUrl || req.url || '';
    const url = new URL(rawUrl, 'http://localhost');
    return url.pathname;
  } catch {
    return req.url || '';
  }
});

const stream = {
  write: (message: string) => logger.http(message.trim())
};

export const morganMiddleware = morgan(
  ':method :stripped-url :status :res[content-length] - :response-time ms',
  { 
    stream,
    skip: (req: any) => {
      const url = req.originalUrl || req.url || '';
      if (['/health', '/metrics', '/api/health', '/api/metrics'].some(p => url.startsWith(p))) {
        return true;
      }
      return url.includes('/@') || url.includes('/src/') || url.includes('.tsx') || url.includes('.ts');
    }
  }
);

import { normalizeError } from '../errors/customErrors.js';

// Global Error Handler Middleware
export const errorHandler = (err: any, req: any, res: any, next: any) => {
  // 1. If headers already sent, delegate to default express error handler
  if (res.headersSent) {
    return next(err);
  }

  // 2. Normalize error object
  const normalized = normalizeError(err);

  // 3. Extract traceId
  const traceId = req.requestId || req.headers?.['x-request-id'] || req.headers?.['x-correlation-id'] || getRequestContext()?.requestId;

  // 4. Log error with trace context
  logger.error({
    message: normalized.message,
    traceId,
    userId: req.user?.id,
    method: req.method,
    url: req.url,
    stack: normalized.stack,
    statusCode: normalized.statusCode,
    code: normalized.code,
  });

  // 5. Response payload with traceId and sanitized error message
  const isProduction = process.env.NODE_ENV === 'production';
  const responsePayload: any = {
    error: isProduction && normalized.statusCode >= 500 
      ? 'خطای داخلی سرور' 
      : normalized.message,
    code: normalized.code,
    traceId,
    statusCode: normalized.statusCode,
    message: isProduction && normalized.statusCode >= 500 
      ? 'خطای داخلی سرور' 
      : normalized.message,
    errorCode: normalized.code,
    success: false,
  };

  if (!isProduction) {
    if (normalized.stack) responsePayload.stack = normalized.stack;
    if (normalized.details) responsePayload.details = normalized.details;
  }

  res.status(normalized.statusCode).json(responsePayload);
};

