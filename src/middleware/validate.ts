import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { asyncHandler } from './asyncHandler.js';
import { toStorageDate } from '../utils/calendarDate.js';
import {
  DECIMAL_INPUT_MAX_SCALE, DECIMAL_INPUT_MAX_WHOLE_DIGITS, DECIMAL_PATTERN, GROUP_SEPARATOR, computedDecimalText, decimalTextScaleIssue,
  normalizeGroupedDecimalString, toLatinDigits, type DecimalBoundIssue,
} from '../lib/numericInput.js';
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
    const read = readDecimalNumber(v);
    if (typeof read !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: decimalBoundMessage(label, read.issue) });
      return z.NEVER;
    }
    return read;
  }
  const clean = normalizeGroupedDecimalString(v);
  if (clean === '') return undefined;
  // v11 phase 3.1 (M4): a separator left by normalizeGroupedDecimalString is misplaced («12,5»), the same error as the browser's
  if (GROUP_SEPARATOR.test(clean)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: جداکنندهٔ هزارگان فقط میان دسته‌های سه‌رقمی می‌آید (مقدار دریافتی: ${v})؛ برای ممیز «٫» بزنید.` });
    return z.NEVER;
  }
  if (!DECIMAL_PATTERN.test(clean)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید عدد معتبر باشد (مقدار دریافتی: ${v})` });
    return z.NEVER;
  }
  const issue = decimalTextScaleIssue(clean);
  if (issue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: decimalBoundMessage(label, issue) });
    return z.NEVER;
  }
  return clean;
});

/**
 * v11 phase 6.1a (M16, S10, S12, U7): a value read by `decimalInput` or `decimalNumberBounds` fits the `numeric(18,4)`
 * money, price and quantity columns (`DECIMAL_INPUT_MAX_WHOLE_DIGITS`, `DECIMAL_INPUT_MAX_SCALE`); before, a larger value
 * came back as a 500 `DATABASE_ERROR` and a fifth decimal was rounded by the column after the service had priced it.
 * A JSON number as the decimal text the bounds are checked on, or the bound it breaks. The noise of a computed number
 * («0.30000000000000004») is read as its value («0.3»); a fifth decimal the sender really wrote («100.00005») is refused
 * like the same text (`computedDecimalText`). Before (reviews of #403), a tolerance of a fixed share of the size let a
 * fifth decimal through above about 50, and then cutting to 15 significant digits let it through above 1e10 and refused
 * a zero left over from a sum («0.1 + 0.2 - 0.3»).
 */
function readDecimalNumber(value: number): string | { issue: DecimalBoundIssue } {
  if (Math.abs(value) >= 10 ** DECIMAL_INPUT_MAX_WHOLE_DIGITS) return { issue: 'size' };
  const text = computedDecimalText(value, DECIMAL_INPUT_MAX_SCALE);
  if (text === null) return { issue: 'scale' };
  const issue = decimalTextScaleIssue(text);
  return issue ? { issue } : text;
}

function decimalBoundMessage(label: string, issue: DecimalBoundIssue): string {
  return issue === 'size'
    ? `${label} بیش از اندازهٔ مجاز است (حداکثر ۱۴ رقم پیش از ممیز).`
    : `${label} حداکثر ۴ رقم پس از ممیز می‌پذیرد.`;
}

/**
 * v11 phase 6.1a (M16, review of #403): the same 14-digit / 4-decimal bound for a field that stays a JSON number
 * (`z.number()`, `z.coerce.number()`), as a `superRefine` step:
 * `z.number().positive().superRefine(decimalNumberBounds('مقدار', { positive: true }))`
 */
export const decimalNumberBounds = (label: string, { positive = false }: { positive?: boolean } = {}) =>
  (value: number, ctx: z.RefinementCtx): void => {
    if (!Number.isFinite(value)) return;
    const read = readDecimalNumber(value);
    if (typeof read !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: decimalBoundMessage(label, read.issue) });
      return;
    }
    // reviews 3-4 of #403: the number itself goes on, so on a field that must be above zero one that reads as 0
    // («1e-17») is refused rather than passing `.positive()` and being stored as a zero line; a field that may be zero
    // takes the noise of a computed zero («0.1 + 0.2 - 0.3») as 0, like `decimalInput`
    // (0 itself, or a negative number, is left to `.positive()`, so its message is not repeated)
    if (positive && read === '0' && value > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید بزرگ‌تر از صفر باشد.` });
  };

/** v8.0.108 (TD-385): شماره‌ها و شناسه‌های متنی (شماره چک، شناسه صیادی) با ارقام لاتین ذخیره می‌شوند */
export const latinDigitsString = z.string().transform(v => toLatinDigits(v).trim());

/** v10.2.3 (TD-1290): ids are PostgreSQL integers; a larger one is 400, never a database error */
export const PG_INT_MAX = 2_147_483_647;
export const withinPgInt = (v: string) => v.length <= 10 && Number(v) <= PG_INT_MAX;

/** 10.3: every id read with this is a PostgreSQL integer too, so an id above its range is refused with a 400 */
export const numericIdString = z.string().min(1, 'شناسه الزامی است')
  .regex(/^[1-9]\d*$/, 'شناسه باید عدد صحیح مثبت باشد')
  .refine(v => !/^\d+$/.test(v) || withinPgInt(v), 'شناسه بزرگ‌تر از حد مجاز است');

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
        .refine(v => !/^\d+$/.test(v) || withinPgInt(v), `${label} بزرگ‌تر از حد مجاز است`)
    }).passthrough()
  }).passthrough();
};

export const paramsItemIdSchema = createParamsIdSchema('id', 'شناسه کالا');
export const paramsPersonnelIdSchema = createParamsIdSchema('id', 'شناسه پرسنل');

/**
 * v10.0.35 (TD-979): نشان میدل‌ور اعتبارسنجی؛ جدول مسیرها (`buildRouteGuardTable`) با آن می‌فهمد کدام route نویسنده
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
          // Express 5: req.query is a getter, so the parsed query is set as the request's own property
          Object.defineProperty(req, 'query', { value: (parsed as any).query, writable: true, configurable: true, enumerable: true });
        }
        if ('params' in parsed && (parsed as any).params !== undefined) {
          req.params = (parsed as any).params;
        }
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // برچسب فیلد فقط وقتی پیش از پیام می‌آید که خود پیام نامش را نیاورده باشد. v11 phase 6.3a (U21): فیلد بی‌برچسب فارسی
        // پیشوندی نمی‌گیرد؛ پیش‌تر نام خام فیلد پیش از پیام می‌آمد («خطای اعتبارسنجی: (partyName) نام طرف حساب الزامی است»)
        const detailMessages = error.issues.map(e => {
          const key = issueFieldKey(e.path);
          const translatedField = key === null ? '' : (FIELD_LABELS[key] || '');
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
