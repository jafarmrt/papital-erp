import { BODY_TOO_LARGE_MESSAGE } from '../lib/attachments/attachmentBodyLimit.js';
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errorCode: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.errorCode = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code || this.errorCode,
      statusCode: this.statusCode,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

/**
 * TD-470: کد ماشینی خطا (مانند WF_TASK_STALE) در `code` پاسخ می‌آید، نه درون پیام فارسی که به کاربر نشان داده می‌شود.
 */
export class NotFoundError extends AppError {
  constructor(message = 'مورد درخواستی یافت نشد', details?: unknown, code = 'NOT_FOUND') {
    super(message, 404, code, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'درخواست نامعتبر است', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'اطلاعات ورودی معتبر نیست', details?: unknown, code = 'VALIDATION_ERROR') {
    super(message, 422, code, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'شناسه یا مقدار ارسالی با داده‌های موجود تداخل دارد', details?: unknown, code = 'CONFLICT') {
    super(message, 409, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'احراز هویت لازم است', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'دسترسی غیرمجاز', details?: unknown, code = 'FORBIDDEN') {
    super(message, 403, code, details);
  }
}

export class BusinessLogicError extends AppError {
  constructor(message = 'قوانین و الزامات کسب‌وکار نقض شده است', details?: unknown) {
    super(message, 422, 'BUSINESS_LOGIC', details);
  }
}

export class InsufficientStockError extends AppError {
  constructor(message = 'موجودی کالا برای اجرای این عملیات کافی نیست', details?: unknown) {
    super(message, 400, 'INSUFFICIENT_STOCK', details);
  }
}

export class UnbalancedVoucherError extends AppError {
  constructor(message = 'سند حسابداری موازنه نیست و مجموع بدهکار با بستانکار برابر نمی‌باشد', details?: unknown) {
    super(message, 422, 'ACCOUNTING_UNBALANCED', details);
  }
}

export interface NormalizedError {
  message: string;
  statusCode: number;
  code: string;
  details?: unknown;
  stack?: string;
}

/**
 * Normalizes PostgreSQL / Drizzle / Zod / JWT / system errors into safe, operational error objects.
 * Prevents internal database queries, constraints, or schemas from leaking to frontend users.
 */
export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return {
      message: err.message,
      statusCode: err.statusCode,
      code: err.code || err.errorCode,
      details: err.details,
      stack: err.stack,
    };
  }

  const errObj = (err && typeof err === 'object') ? (err as Record<string, unknown>) : null;

  // v9.0.243 (TD-641): body-parser's 413 reaches the user in Persian, not as "request entity too large"
  if (errObj && errObj.type === 'entity.too.large') {
    return {
      message: BODY_TOO_LARGE_MESSAGE,
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      details: { limit: errObj.limit, length: errObj.length },
      stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
    };
  }

  // Handle OptimisticLockError
  if (errObj && (errObj.name === 'OptimisticLockError' || errObj.code === 'OCC_CONFLICT')) {
    return {
      message: 'تداخل همزمانی: این رکورد توسط کاربر دیگری تغییر یافته است. لطفاً صفحه را بازخوانی کنید.',
      statusCode: 409,
      code: 'OCC_CONFLICT',
      details: {
        expectedVersion: errObj.expectedVersion,
        currentVersion: errObj.currentVersion
      },
      stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
    };
  }

  // Handle Postgres error codes
  // v7.0.22 (TD-180): Drizzle 0.45 خطای pg را در DrizzleQueryError می‌پیچد و کد را در `cause` نگه می‌دارد؛
  // بدون باز کردن cause هیچ‌یک از نگاشت‌های زیر اجرا نمی‌شد و متن کوئری SQL به کاربر می‌رسید.
  const pgErr = (errObj && errObj.cause && typeof errObj.cause === 'object' && typeof (errObj.cause as Record<string, unknown>).code === 'string')
    ? (errObj.cause as Record<string, unknown>)
    : errObj;
  if (errObj && pgErr) {
    const code = pgErr.code || pgErr.routine;
    if (code === '23514' && pgErr.constraint === 'chk_iws_current_stock_non_negative') {
      return {
        message: 'موجودی کافی در انبار برای این عملیات وجود ندارد و منفی شدن موجودی مجاز نیست.',
        statusCode: 400,
        code: 'INSUFFICIENT_STOCK',
        stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
      };
    }
    // v7.0.75 (P3-15): قید قالب ستون‌های تاریخ متنی (chk_<table>_<column>_datefmt، مهاجرت 0028)
    if (code === '23514' && typeof pgErr.constraint === 'string' && pgErr.constraint.endsWith('_datefmt')) {
      return {
        message: 'قالب تاریخ نامعتبر است؛ تاریخ را به شکل ۱۴۰۵/۰۷/۱۰ یا 2026-10-02 وارد کنید.',
        statusCode: 422,
        code: 'INVALID_DATE_FORMAT',
        stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
      };
    }
    if (code === '23505') {
      return {
        message: 'مقدار وارد شده تکراری است',
        statusCode: 409,
        code: 'UNIQUE_VIOLATION',
        stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
      };
    }
    if (code === '23503') {
      return {
        message: 'ارجاع به رکورد ناموجود',
        statusCode: 409,
        code: 'FOREIGN_KEY_VIOLATION',
        stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
      };
    }
    if (code === '23514') {
      return {
        message: 'مقدار وارد شده نامعتبر است',
        statusCode: 422,
        code: 'CHECK_VIOLATION',
        stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
      };
    }
    if (code === '23502') {
      return {
        message: 'فیلدهای الزامی فرم تکمیل نشده است',
        statusCode: 422,
        code: 'NOT_NULL_VIOLATION',
        stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
      };
    }
  }

  // Zod errors
  if (errObj && (errObj.name === 'ZodError' || Array.isArray(errObj.errors))) {
    return {
      message: 'اعتبارسنجی ناموفق',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      details: errObj.errors,
      stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
    };
  }

  // JWT errors
  if (errObj && (errObj.name === 'JsonWebTokenError' || errObj.name === 'TokenExpiredError')) {
    return {
      message: 'توکن نامعتبر است',
      statusCode: 401,
      code: 'INVALID_TOKEN',
      stack: typeof errObj.stack === 'string' ? errObj.stack : undefined,
    };
  }

  // Default fallback
  const isDev = process.env.NODE_ENV !== 'production';
  const rawMsg = errObj && typeof errObj.message === 'string' ? errObj.message : (typeof err === 'string' ? err : 'خطای غیرمنتظره در سرور رخ داده است');
  const rawStatus = errObj && (typeof errObj.statusCode === 'number' ? errObj.statusCode : (typeof errObj.status === 'number' ? errObj.status : 500)) || 500;
  const rawCode = errObj && typeof errObj.code === 'string' ? errObj.code : (errObj && typeof errObj.errorCode === 'string' ? errObj.errorCode : 'INTERNAL_ERROR');

  return {
    message: rawMsg,
    statusCode: rawStatus,
    code: rawCode,
    stack: errObj && typeof errObj.stack === 'string' ? errObj.stack : undefined,
    details: isDev ? errObj?.details : undefined,
  };
}
