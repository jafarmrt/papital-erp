/**
 * v9.0.383 (TD-721، B15-19): قرارداد یگانه گزارش اجرای قانون‌های خودکار و شاخص‌های موتور، مشترک سرور
 * (`EventActionEngineService.getLogs` / `getStats`) و رابط («اقدام‌های خودکار»). پیش‌تر رابط `res.logs`، `durationMs`،
 * `requestPayloadJson`، `totalLogs` و `avgDurationMs` می‌خواند در حالی که سرور `data`، `executionDurationMs`، `result`،
 * `logsTotal` و `avgLatencyMs` می‌فرستاد، پس فهرست همیشه خالی و کارت‌ها همیشه ۰ بودند.
 */
export type ActionLogStatus = 'success' | 'failed' | 'skipped';

export interface ActionLogRow {
  id: number;
  ruleId: number | null;
  ruleName: string;
  eventId: string;
  eventType: string;
  actionType: string;
  status: ActionLogStatus | string;
  /** خروجی اقدام (پاسخ وب‌هوک، اعلان‌های ساخته‌شده، ردیف ممیزی) */
  result: unknown;
  errorMessage: string;
  executionDurationMs: number;
  executedAt: string | null;
}

export interface ActionLogPage {
  data: ActionLogRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActionEngineStats {
  totalRules: number;
  activeRules: number;
  totalExecutions: number;
  logsTotal: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgLatencyMs: number;
}

const ACTION_LOG_STATUS_LABELS: Record<ActionLogStatus, string> = {
  success: 'موفق',
  failed: 'ناموفق',
  skipped: 'اجرا نشد',
};

export function actionLogStatusLabel(status: string): string {
  return (ACTION_LOG_STATUS_LABELS as Record<string, string>)[status] ?? status;
}
