/**
 * Package 13: who sees a daily work log. Shared by the server (list, single read, notifications) and the browser (form).
 *
 * v9.0.236 (TD-900, product-owner decision ت۷): there is no public visibility any more. `public`, `all` and an empty
 * value were readable by every holder of `daily_logs.view`; migration 0075 moved such logs to `mentioned_only` and
 * recorded the old value in `daily_log_visibility_repairs`, and the input accepts only the values below.
 */
export const DAILY_LOG_VISIBILITIES = ['mentioned_only', 'private', 'managers', 'custom'] as const;
export type DailyLogVisibility = typeof DAILY_LOG_VISIBILITIES[number];

/** The form offers only these two («اشاره‌شده‌ها و خودم» and «شخصی»); `managers` and `custom` are API-only values */
export const DAILY_LOG_FORM_VISIBILITIES = ['mentioned_only', 'private'] as const;
export type DailyLogFormVisibility = typeof DAILY_LOG_FORM_VISIBILITIES[number];

export const DEFAULT_DAILY_LOG_VISIBILITY: DailyLogVisibility = 'mentioned_only';

export interface DailyLogVisibilityRow {
  userId: number;
  visibility: string | null;
  mentions: unknown;
  allowedUsers: unknown;
}

/** User ids held in a JSONB id list (mentions, allowed users) */
export function idList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
}

/**
 * Whether a user sees a log (list, single read, statistics; TD-301 / TD-406). The author and holders of
 * `daily_logs.manage_all` see every log. A value outside the known list is read as `mentioned_only`, never as public.
 */
export function canSeeDailyLog(row: DailyLogVisibilityRow, userId: number | undefined, canManageAll: boolean): boolean {
  if (canManageAll) return true;
  if (userId === undefined) return false;
  if (row.userId === userId) return true;
  const visibility = row.visibility ?? DEFAULT_DAILY_LOG_VISIBILITY;
  if (visibility === 'private' || visibility === 'managers') return false;
  if (visibility === 'custom') return idList(row.allowedUsers).includes(userId) || idList(row.mentions).includes(userId);
  return idList(row.mentions).includes(userId);
}

/**
 * v9.0.233 (TD-633, decision ت۲ الف): a mention notifies only a user who may read the log. A mention in a private or
 * managers-only log notifies nobody (the form says so), so its title never reaches a reader the log is hidden from.
 */
export function mentionNotifies(row: DailyLogVisibilityRow, mentionedUserId: number): boolean {
  return mentionedUserId !== row.userId && canSeeDailyLog(row, mentionedUserId, false);
}

/** Whether mentions in a log of this visibility notify anyone (the form warns when they do not) */
export function visibilityNotifiesMentions(visibility: string): boolean {
  return visibility === 'mentioned_only' || visibility === 'custom';
}
