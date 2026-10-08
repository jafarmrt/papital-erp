/**
 * v9.0.356 (TD-592، تصمیم ت۷ الف): نشانی دریافت خروجی داده‌ها و قاعده بازه سجل ممیزی، مشترک کارت تنظیمات و آزمون.
 * سجل ممیزی فقط با گزینه جدا و یک بازه تاریخ (ISO، هر دو شامل) می‌آید؛ همان قاعده `dataExportQuerySchema` سرور.
 */
export const DATA_EXPORT_URL = '/api/export-backup';

export interface DataExportChoice {
  activityLogs: boolean;
  from: string;
  to: string;
}

/** Persian reason the audit-log range cannot be sent, or null */
export function dataExportRangeError(choice: DataExportChoice): string | null {
  if (!choice.activityLogs) return null;
  if (!choice.from || !choice.to) return 'برای خروجی سجل ممیزی تاریخ آغاز و پایان بازه را وارد کنید.';
  if (choice.from > choice.to) return 'تاریخ پایان بازه سجل ممیزی پیش از تاریخ آغاز آن است.';
  return null;
}

/** Download URL of the export for the choice (audit log only with a valid range) */
export function dataExportUrl(choice: DataExportChoice): string {
  if (!choice.activityLogs || dataExportRangeError(choice)) return DATA_EXPORT_URL;
  const query = new URLSearchParams({ activityLogs: '1', from: choice.from, to: choice.to });
  return `${DATA_EXPORT_URL}?${query.toString()}`;
}
