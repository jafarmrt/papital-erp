/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): زبانه‌های صفحه «گزارش‌های مدیریتی». هر زبانه با کلید رابط خودش نشان داده
 * می‌شود: ردیف `/management-reports/<id>` در `PAGE_ACCESS` (`src/lib/permissions/pageAccess.ts`). سن مطالبات و مالیات
 * بر ارزش افزوده در بخش‌های بعدی همین طرح می‌آیند.
 */

export const MANAGEMENT_REPORTS_PATH = '/management-reports';

export const MANAGEMENT_REPORT_TABS = [
  { id: 'sales', title: 'فروش' },
] as const;

export type ManagementReportTabId = typeof MANAGEMENT_REPORT_TABS[number]['id'];

export function managementReportPath(id: string): string {
  return `${MANAGEMENT_REPORTS_PATH}/${id}`;
}
