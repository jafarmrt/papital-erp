import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';
import { DAILY_LOG_VISIBILITIES } from '../lib/dailyLogs/dailyLogVisibility.js';

/**
 * Request bodies of the daily work log routes (package 13).
 *
 * v9.0.234 (TD-629): a user or project id is a positive integer (a Latin digit string is accepted, as the form sends
 * numbers); anything else is 400 before the log is written. Whether the users and the project exist is checked by the
 * service in the save transaction (422).
 * v9.0.236 (TD-900, decision ت۷): `public` and `all` are no longer accepted.
 */
const positiveId = (label: string) => z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : (/^[1-9]\d*$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isSafeInteger(n) || n <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} باید شناسه عددی مثبت باشد (مقدار دریافتی: ${String(v)})` });
    return z.NEVER;
  }
  return n;
});

const userIdList = (label: string) => z.array(positiveId(label)).max(100, `${label} حداکثر ۱۰۰ کاربر است`);

const dailyLogFields = {
  date: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  work_mode: z.enum(['onsite', 'remote', 'hybrid', 'mission', 'leave']).optional(),
  project_id: z.union([positiveId('شناسه پروژه'), z.null(), z.literal('')]).optional(),
  project_name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mentions: userIdList('اشاره‌شده').optional(),
  visibility: z.enum(DAILY_LOG_VISIBILITIES, { message: 'سطح دید گزارش کار باید «اشاره‌شده‌ها و خودم» یا «شخصی» باشد' }).optional(),
  allowed_users: userIdList('کاربر مجاز').optional(),
};

export const createDailyLogSchema = z.object({
  body: z.object({
    ...dailyLogFields,
    title: z.string().min(1, 'عنوان گزارش کار الزامی است'),
    content: z.string().min(1, 'شرح گزارش کار الزامی است'),
  })
});

export const updateDailyLogSchema = z.object({
  body: z.object({
    ...dailyLogFields,
    title: z.string().min(1, 'عنوان گزارش کار الزامی است').optional(),
    content: z.string().min(1, 'شرح گزارش کار الزامی است').optional(),
  }),
  params: z.object({ id: numericIdString })
});

export const reviewDailyLogSchema = z.object({
  body: z.object({ manager_notes: z.string().optional() }),
  params: z.object({ id: numericIdString })
});

export type DailyLogBody = z.infer<typeof createDailyLogSchema>['body'];
export type DailyLogUpdateBody = z.infer<typeof updateDailyLogSchema>['body'];
