import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { asyncHandler } from './asyncHandler.js';
import { toStorageDate } from '../utils/calendarDate.js';
import { DECIMAL_PATTERN, normalizeDecimalString, toLatinDigits } from '../lib/numericInput.js';
import { FIELD_LABELS, issueFieldKey, persianIssueMessage } from '../lib/validationMessages.js';


import { z } from 'zod';

/**
 * v7.0.136 (TD-232): پارامتر تاریخ فیلتر در query (از/تا تاریخ گزارش‌ها و فهرست‌ها). DatePicker شمسی می‌فرستد؛
 * این‌جا به ISO میلادی (`YYYY-MM-DD`) تبدیل می‌شود تا با تاریخ‌های ذخیره‌شده مقایسه شود. خالی ← undefined؛
 * تاریخ نامعتبر خطای اعتبارسنجی. پیش‌تر «1405/07/01» خام با ستون timestamp یا متن ISO مقایسه می‌شد.
 */
export const storageDateParam = z.string().max(40).optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  const iso = toStorageDate(v);
  if (iso === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `تاریخ «${v}» معتبر نیست؛ مانند ۱۴۰۵/۰۷/۱۰ وارد کنید` });
    return z.NEVER;
  }
  return iso || undefined;
});

/**
 * v8.0.108 (TD-385): مبلغ، نرخ یا مقدار اعشاری در بدنه درخواست — عدد، یا رشته با ارقام لاتین، فارسی یا عربی و جداکننده
 * هزارگان. خروجی رشته اعشاری لاتین (بی‌عبور از double)؛ رشته خالی ← undefined؛ متن نامعتبر خطای اعتبارسنجی، نه صفر.
 * پیش‌تر `z.union([z.number(), z.string()])` هر رشته‌ای را می‌پذیرفت و سرویس آن را بی‌خطا صفر می‌کرد.
 */
export const decimalInput = (label: string) => z.union([z.number(), z.string()]).transform((v, ctx): string | undefined => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید عدد معتبر باشد` });
      return z.NEVER;
    }
    return String(v);
  }
  const clean = normalizeDecimalString(v);
  if (clean === '') return undefined;
  if (!DECIMAL_PATTERN.test(clean)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید عدد معتبر باشد (مقدار دریافتی: ${v})` });
    return z.NEVER;
  }
  return clean;
});

/** v8.0.108 (TD-385): شماره‌ها و شناسه‌های متنی (شماره چک، شناسه صیادی) با ارقام لاتین ذخیره می‌شوند */
export const latinDigitsString = z.string().transform(v => toLatinDigits(v).trim());

export const numericIdString = z.string().min(1, 'شناسه الزامی است')
  .regex(/^[1-9]\d*$/, 'شناسه باید عدد صحیح مثبت باشد');

export const paramsIdSchema = z.object({
  params: z.object({
    id: numericIdString
  }).passthrough()
}).passthrough();

export const createParamsIdSchema = (paramName: string = 'id', label: string = 'شناسه') => {
  return z.object({
    params: z.object({
      [paramName]: z.string().min(1, `${label} الزامی است`)
        .regex(/^[1-9]\d*$/, `${label} باید عدد صحیح مثبت باشد`)
    }).passthrough()
  }).passthrough();
};

export const paramsItemIdSchema = createParamsIdSchema('id', 'شناسه کالا');
export const paramsPersonnelIdSchema = createParamsIdSchema('id', 'شناسه پرسنل');

/**
 * v10.0.21 (TD-979): نشان میدل‌ور اعتبارسنجی؛ جدول مسیرها (`buildRouteGuardTable`) با آن می‌فهمد کدام route نویسنده
 * ورودی‌اش را با Zod می‌خواند.
 */
export const VALIDATES = '__erpRouteValidates';

/** آیا اسکیمای درخواست کلید `body` دارد (ZodObject، شاید پیچیده در effects یا passthrough) */
function schemaReadsBody(schema: ZodSchema): boolean {
  let current: unknown = schema;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const def = (current as { _def?: { schema?: unknown; innerType?: unknown; in?: unknown } })._def;
    const shape = (current as { shape?: Record<string, unknown> }).shape;
    if (shape && typeof shape === 'object') return 'body' in shape;
    current = def?.schema ?? def?.innerType ?? def?.in;
  }
  return false;
}

export const validate = (schema: ZodSchema) => {
  return Object.assign(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      // v9.0.78 (TD-529): پیام هر issue بی پیام اسکیما از نقشه فارسی ساخته می‌شود
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      }, { error: persianIssueMessage });

      // S-6: الصاق مستقیم داده‌های تمیز، تایپ‌شده و فیلترشده Zod به شیء req
      if (parsed && typeof parsed === 'object') {
        if ('body' in parsed && (parsed as any).body !== undefined) {
          req.body = (parsed as any).body;
        }
        if ('query' in parsed && (parsed as any).query !== undefined) {
          req.query = (parsed as any).query;
        }
        if ('params' in parsed && (parsed as any).params !== undefined) {
          req.params = (parsed as any).params;
        }
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // برچسب فیلد فقط وقتی پیش از پیام می‌آید که خود پیام نامش را نیاورده باشد
        const detailMessages = error.issues.map(e => {
          const key = issueFieldKey(e.path);
          const translatedField = key === null ? '' : (FIELD_LABELS[key] || key);
          return !translatedField || e.message.includes(translatedField) ? e.message : `(${translatedField}) ${e.message}`;
        }).join(' | ');
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: `خطای اعتبارسنجی: ${detailMessages}`,
          details: {
            issues: error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
          },
          success: false,
          error: `خطای اعتبارسنجی: ${detailMessages}`
        });
      }
      next(error);
    }
  }), { [VALIDATES]: { body: schemaReadsBody(schema) } });
};
