import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';

/**
 * v10.0.21 (TD-979، OBS-R2-06): بدنه ورودهای گروهی اکسل (طرف حساب، پرسنل، عنوان کار کارمزدی) با Zod و با سقف شمار ردیف.
 * هر ردیف شیئی از خانه‌های ساده است (متن، عدد، درست/نادرست یا خالی)؛ قاعده هر خانه را سرویس ورود می‌سنجد و ردیف نادرست
 * را در `errors` با شماره‌اش برمی‌گرداند. پیش‌تر هر بدنه‌ای پذیرفته می‌شد و فهرست طرف حساب سقفی نداشت.
 */
export const IMPORT_MAX_ROWS = 5000;

const importCell = z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]);
const importRow = z.record(z.string().max(200), importCell);
/** ردیف طرف حساب: خانه‌ها، به‌علاوه شیء کهنه `bankInfo` که سرویس هنوز می‌خواند */
const customerImportRow = z.record(z.string().max(200), z.union([importCell, z.record(z.string().max(200), importCell)]));

const importRows = <T extends z.ZodTypeAny>(row: T, label: string) => z.array(row)
  .min(1, `فهرست ${label} برای ثبت خالی است`)
  .max(IMPORT_MAX_ROWS, `هر بار حداکثر ${IMPORT_MAX_ROWS.toLocaleString('fa-IR')} ردیف ${label} ثبت می‌شود؛ فایل را چند بخش کنید`);

export const customerBulkImportSchema = z.object({
  body: z.object({
    rows: importRows(customerImportRow, 'طرف حساب'),
    updateIfExists: z.boolean().optional(),
  }),
});

export const personnelBulkImportSchema = z.object({
  body: z.object({
    rows: importRows(importRow, 'پرسنل'),
    updateIfExists: z.boolean().optional(),
  }),
});

export const pieceworkTaskImportSchema = z.object({
  body: z.object({
    rows: importRows(importRow, 'عنوان کار'),
    mode: z.enum(['upsert', 'replace', 'append']).optional(),
  }),
});

/** دسته کاری با شناسه، یا (دسته‌ای که فقط در عنوان‌های کار آمده) با نامش */
export const pieceworkCategoryParamSchema = z.object({
  params: z.object({
    id: z.union([numericIdString, z.string().trim().min(1, 'شناسه دسته‌بندی الزامی است').max(100)]),
  }),
});
