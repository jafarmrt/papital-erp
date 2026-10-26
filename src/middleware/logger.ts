import winston from 'winston';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getRequestContext, acceptedTraceId } from '../lib/requestContext.js';
import { FinancialDecimal } from '../lib/financialDecimal.js';
import { PERSIAN_TEXT, terminalLine } from '../lib/terminalText.js';
import { isSecretAuditKey } from '../lib/audit/auditSanitizer.js';

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

/** A word naming a secret inside a longer key or parameter name (`newPassword`, `consumer_secret`, `api-key`) */
const SECRET_WORD = String.raw`[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|pwd)[A-Za-z0-9_-]*`;
const JSON_SECRET = new RegExp(String.raw`"(${SECRET_WORD})"\s*:\s*"[^"]*"`, 'gi');
const TEXT_SECRET = new RegExp(String.raw`\b(${SECRET_WORD})(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;"']+)`, 'gi');

/**
 * v10.0.268 (OBS-R1-03): a secret is scrubbed in a JSON body (`"newPassword": "…"`) and in plain text (`password=…`,
 * `?token=…`, `api_key: …`), not only the JSON form of a few fixed names.
 */
function sanitizeString(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [PROTECTED_JWT]')
    .replace(JSON_SECRET, '"$1": "[REDACTED]"')
    .replace(TEXT_SECRET, '$1$2[REDACTED]');
}

/**
 * v10.0.268 (OBS-R1-03): a key is secret by the audit scrubber's rule (`isSecretAuditKey`: password, secret, token,
 * apiKey, cookie, jwt, authorization … in any spelling) or names a card number or CVV; «author» and «authority» are kept.
 */
function isSecretLogKey(key: string): boolean {
  return isSecretAuditKey(key) || /^auth$|credit.?card|cvv/i.test(key);
}

/** Deeper levels are cut; a log entry never needs more and a deep object cannot exhaust the stack */
const SANITIZE_MAX_DEPTH = 12;

/**
 * v9.0.167 (TD-600): an object already on the path (a cycle, e.g. an error whose `cause` points back) becomes
 * `[Circular]` and nesting beyond `SANITIZE_MAX_DEPTH` becomes `[Truncated]`; the plain recursion threw
 * `RangeError: Maximum call stack size exceeded` from inside the caller's catch block.
 */
export function sanitizeObject(obj: any, ancestors: WeakSet<object> = new WeakSet(), depth = 0): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (looksLikeJWT(obj)) {
      return '[JWT_REDACTED]';
    }
    return sanitizeString(obj);
  }
  if (typeof obj !== 'object') return obj;
  if (obj instanceof FinancialDecimal) return obj.toNumber(); // v7.0.67 (P2-6)
  if (ancestors.has(obj)) return '[Circular]';
  if (depth >= SANITIZE_MAX_DEPTH) return '[Truncated]';
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item, ancestors, depth + 1));

    const sanitized: any = {};
    for (const key of Reflect.ownKeys(obj)) {
      const value = (obj as any)[key];
      if (typeof key === 'string' && isSecretLogKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && looksLikeJWT(value)) {
        sanitized[key] = '[JWT_REDACTED]';
      } else {
        sanitized[key] = sanitizeObject(value, ancestors, depth + 1);
      }
    }
    return sanitized;
  } finally {
    ancestors.delete(obj);
  }
}

// Sanitize any log message or metadata before writing
const sanitizeFormat = winston.format((info) => {
  return sanitizeObject(info);
});

export { PERSIAN_TERMINAL_MARKER, terminalLine } from '../lib/terminalText.js';

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
  return terminalLine(`${timestamp} ${level}${ctxPrefix}: ${stack || cleanMessage}`);
});

const isProduction = process.env.NODE_ENV === 'production';
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// v11 (O16): the log folder and files are private to the server's user and group (they hold user ids, addresses and
// error stacks); a folder made by an older version (0755) is tightened at start. The files get 0640 from the server's
// umask 027 (src/lib/processFileMode.ts): a mode option of the rotate transports would change the name of their audit
// file, and the logs written before it would never be deleted.
export const LOG_DIR_MODE = 0o750;

// Ensure log directory exists
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: LOG_DIR_MODE });
  }
} catch (err) {
  console.error('Failed to create log directory:', err);
}
try {
  // only the bits of other users go: a shared folder (LOG_DIR=/var/log/...) keeps its group's rights
  fs.chmodSync(logDir, fs.statSync(logDir).mode & 0o7770);
} catch {
  // a folder of another user stays as it is
}

// Initialize transports with Console by default; v11 (O16): colour codes only on a terminal, not in the journal
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: process.stdout.isTTY
      ? combine(contextFormat(), sanitizeFormat(), colorize(), logFormat)
      : combine(contextFormat(), sanitizeFormat(), logFormat)
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

/**
 * v9.0.166 (TD-598): access lines are written at `info`, the production level (and `LOG_LEVEL=info` of
 * install.sh); at `http` they were below it and production kept no access log at all.
 */
export const ACCESS_LOG_LEVEL = 'info';

const stream = {
  write: (message: string) => logger.log(ACCESS_LOG_LEVEL, message.trim())
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

import { normalizeError, type DatabaseErrorLogDetails } from '../errors/customErrors.js';

/**
 * v9.0.450 (TD-625, B01-45, owner rule t9): the terminal line of an error is English. It names the status, the error
 * code and the route, plus the message only when it has no Persian; the message for the user goes into `userMessage`,
 * which the console format never prints and the JSON log files keep (searchable by `traceId`). A 5xx keeps its stack on
 * the terminal with the message line replaced the same way; the full stack stays in `errorStack` for the log files.
 */
export function errorLogEntry(
  normalized: { message: string; statusCode: number; code?: string; stack?: string; logDetails?: DatabaseErrorLogDetails; privateMessage?: boolean },
  req: { method?: string; url?: string; originalUrl?: string; user?: { id?: number } },
  traceId?: string,
): Record<string, unknown> {
  const code = normalized.code || 'UNKNOWN_ERROR';
  const route = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  // TD-1386: a message naming a person or an amount (`privateMessage`) stays out of every field, the stack's first line too
  const privateText = normalized.privateMessage === true;
  const englishMessage = !privateText && normalized.message && !PERSIAN_TEXT.test(normalized.message) ? `: ${normalized.message}` : '';
  const name = /^([A-Za-z_$][\w$]*)/.exec(normalized.stack ?? '')?.[1] ?? 'Error';
  const frames = (normalized.stack ?? '').split('\n').filter(l => /^\s+at /.test(l));
  // TD-1320: a database error's own reason (SQLSTATE, constraint, table, the database's message) goes to the log only
  const db = normalized.logDetails;
  const dbParts = db ? [db.sqlState && `SQLSTATE ${db.sqlState}`, db.table && `table ${db.table}`, db.constraint && `constraint ${db.constraint}`].filter(Boolean) : [];
  const dbReason = db ? `${dbParts.length > 0 ? ` (${dbParts.join(', ')})` : ''}${db.dbMessage ? `: ${db.dbMessage}` : ''}` : '';
  return {
    message: [`HTTP ${normalized.statusCode} ${code}`, req.method, route].filter(Boolean).join(' ') + englishMessage + dbReason,
    traceId,
    userId: req.user?.id,
    method: req.method,
    // v10.0.x (OBS-R1-02): the log files get the path only, like the access log; a query string may carry a token or search text
    url: route,
    statusCode: normalized.statusCode,
    code: normalized.code,
    userMessage: privateText ? undefined : normalized.message,
    ...(db ? { database: db } : {}),
    ...(normalized.statusCode >= 500 && frames.length > 0 ? { stack: [`${name} (${code})${englishMessage}${dbReason}`, ...frames].join('\n') } : {}),
    errorStack: privateText ? [`${name} (${code})`, ...frames].join('\n') : normalized.stack,
  };
}

// Global Error Handler Middleware
export const errorHandler = (err: any, req: any, res: any, next: any) => {
  // 1. If headers already sent, delegate to default express error handler
  if (res.headersSent) {
    return next(err);
  }

  // 2. Normalize error object
  const normalized = normalizeError(err);

  // 3. Extract traceId
  // v9.0.147 (TD-602): never the raw client header; requestContextMiddleware accepted or replaced it
  const traceId = req.requestId || getRequestContext()?.requestId || acceptedTraceId(req.headers?.['x-request-id']);

  // 4. Log error with trace context
  logger.error(errorLogEntry(normalized, req, traceId));

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
    if (normalized.stack && !normalized.internal) responsePayload.stack = normalized.stack;
    if (normalized.details) responsePayload.details = normalized.details;
  } else if (normalized.details && normalized.statusCode < 500) {
    // v9.0.312 (TD-594، B01-14): جزئیات خطای ۴xx (مثل فهرست کالاهای «تحویل بیش از برنامه») در تولید هم فرستاده می‌شود؛
    // فقط جزئیات خطای ۵xx پنهان می‌ماند
    responsePayload.details = normalized.details;
  }

  res.status(normalized.statusCode).json(responsePayload);
};

