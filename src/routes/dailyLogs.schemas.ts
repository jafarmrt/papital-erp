import { z } from 'zod';
import { numericIdString, storageDateParam } from '../middleware/validate.js';
import { toEnglishDigits, toPersianDigits } from '../utils.js';
import { DAILY_LOG_VISIBILITIES } from '../lib/dailyLogs/dailyLogVisibility.js';
import { TIME_OF_DAY_PATTERN, normalizeTimeOfDay } from '../lib/dailyLogs/workHours.js';
import { DAILY_LOG_WORK_MODES } from '../lib/dailyLogs/workMode.js';
import {
  DAILY_LOG_CONTENT_MAX, DAILY_LOG_MANAGER_NOTES_MAX, DAILY_LOG_PROJECT_NAME_MAX, DAILY_LOG_TAG_MAX, DAILY_LOG_TAGS_MAX,
  DAILY_LOG_TITLE_MAX,
} from '../lib/dailyLogs/dailyLogLimits.js';

const toPersianDigitsText = (n: number) => toPersianDigits(String(n));
const atMost = (label: string, max: number) => `${label} حداکثر ${toPersianDigitsText(max)} نویسه است`;

/**
 * Request bodies of the daily work log routes (package 13).
 *
 * v9.0.234 (TD-629): a user or project id is a positive integer (a Latin digit string is accepted, as the form sends
 * numbers); anything else is 400 before the log is written. Whether the users and the project exist is checked by the
 * service in the save transaction (422).
 * v9.0.236 (TD-900, decision ت۷): `public` and `all` are no longer accepted.
 * v9.0.246 (TD-644): title, content, tags, project name and manager notes have length caps (`dailyLogLimits.ts`).
 * v9.0.247 (TD-634): a start or end time is «HH:MM» from 00:00 to 23:59; the end after the start is checked by the
 * service with the shared rule (`workHours.ts`). v9.0.248 (TD-635, decision ت۳ ب): the work mode is onsite or remote.
 */
const timeOfDay = (label: string) => z.string()
  .transform(normalizeTimeOfDay)
  .refine(v => TIME_OF_DAY_PATTERN.test(v), { message: `${label} باید به شکل ساعت:دقیقه، از ۰۰:۰۰ تا ۲۳:۵۹ باشد` });

const positiveId = (label: string) => z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : (/^[1-9]\d*$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isSafeInteger(n) || n <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید شناسه عددی مثبت باشد (مقدار دریافتی: ${String(v)})` });
    return z.NEVER;
  }
  return n;
});

const titleField = z.string().min(1, 'عنوان گزارش کار الزامی است').max(DAILY_LOG_TITLE_MAX, atMost('عنوان گزارش کار', DAILY_LOG_TITLE_MAX));
const contentField = z.string().min(1, 'شرح گزارش کار الزامی است').max(DAILY_LOG_CONTENT_MAX, atMost('شرح گزارش کار', DAILY_LOG_CONTENT_MAX));

const userIdList = (label: string) => z.array(positiveId(label)).max(100, `${label} حداکثر ۱۰۰ کاربر است`);

const dailyLogFields = {
  date: z.string().optional(),
  start_time: timeOfDay('ساعت شروع').optional(),
  end_time: timeOfDay('ساعت پایان').optional(),
  work_mode: z.enum(DAILY_LOG_WORK_MODES, { message: 'نوع کار گزارش باید «حضوری» یا «دورکاری» باشد' }).optional(),
  project_id: z.union([positiveId('شناسه پروژه'), z.null(), z.literal('')]).optional(),
  project_name: z.string().max(DAILY_LOG_PROJECT_NAME_MAX, atMost('نام پروژه', DAILY_LOG_PROJECT_NAME_MAX)).optional(),
  tags: z.array(z.string().max(DAILY_LOG_TAG_MAX, atMost('هر برچسب', DAILY_LOG_TAG_MAX)))
    .max(DAILY_LOG_TAGS_MAX, `گزارش کار حداکثر ${toPersianDigitsText(DAILY_LOG_TAGS_MAX)} برچسب دارد`).optional(),
  mentions: userIdList('اشاره‌شده').optional(),
  visibility: z.enum(DAILY_LOG_VISIBILITIES, { message: 'سطح دید گزارش کار باید «اشاره‌شده‌ها و خودم» یا «شخصی» باشد' }).optional(),
  allowed_users: userIdList('کاربر مجاز').optional(),
};

export const createDailyLogSchema = z.object({
  body: z.object({
    ...dailyLogFields,
    title: titleField,
    content: contentField,
  })
});

export const updateDailyLogSchema = z.object({
  body: z.object({
    ...dailyLogFields,
    title: titleField.optional(),
    content: contentField.optional(),
  }),
  params: z.object({ id: numericIdString })
});

export const reviewDailyLogSchema = z.object({
  body: z.object({ manager_notes: z.string().max(DAILY_LOG_MANAGER_NOTES_MAX, atMost('یادداشت بازبینی', DAILY_LOG_MANAGER_NOTES_MAX)).optional() }),
  params: z.object({ id: numericIdString })
});

export type DailyLogBody = z.infer<typeof createDailyLogSchema>['body'];
export type DailyLogUpdateBody = z.infer<typeof updateDailyLogSchema>['body'];

const optionalPositiveInt = (label: string) => z.string().optional().transform((v, ctx) => {
  if (v === undefined || v.trim() === '' || v.trim() === '0') return undefined;
  const n = Number(toEnglishDigits(v.trim()));
  if (!Number.isSafeInteger(n) || n <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید شناسه عددی مثبت باشد` });
    return z.NEVER;
  }
  return n;
});

const boundedInt = (label: string, min: number, max: number, fallback: number) => z.string().optional().transform((v, ctx) => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(toEnglishDigits(v.trim()));
  if (!Number.isInteger(n) || n < min || n > max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید عددی از ${toPersianDigitsText(min)} تا ${toPersianDigitsText(max)} باشد` });
    return z.NEVER;
  }
  return n;
});

/** v9.0.237 (TD-630): the list query; the server pages it (at most 100 rows a page) */
export const dailyLogListQuerySchema = z.object({
  query: z.object({
    filter_type: z.enum(['all', 'mine', 'mentioned', 'summary']).optional(),
    date: storageDateParam,
    user_id: optionalPositiveInt('شناسه کاربر'),
    work_mode: z.enum(['onsite', 'remote', 'hybrid', 'mission', 'leave']).optional(),
    search: z.string().max(200, 'عبارت جست‌وجو حداکثر ۲۰۰ نویسه است').optional().transform(v => v?.trim() || undefined),
    page: boundedInt('شماره صفحه', 1, 100000, 1),
    limit: boundedInt('تعداد ردیف هر صفحه', 1, 100, 30),
  }).passthrough(),
});
export type DailyLogListQueryParsed = z.infer<typeof dailyLogListQuerySchema>['query'];

/** v9.0.237 (TD-630): the management summary covers one day (default today) or one month (default this month) */
export const dailyLogSummaryQuerySchema = z.object({
  query: z.object({
    report_type: z.enum(['daily', 'monthly']).optional().default('daily'),
    date: storageDateParam,
    year_month: z.string().max(20).optional().transform(v => (v ? toEnglishDigits(v).trim() : undefined) || undefined),
    user_id: optionalPositiveInt('شناسه کاربر'),
  }).passthrough(),
});
export type DailyLogSummaryQueryParsed = z.infer<typeof dailyLogSummaryQuerySchema>['query'];
