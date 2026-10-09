/**
 * v10.0.31 / v10.0.32 (TD-945 / TD-947، تصمیم ت۱۰ فاز ۵): سندهایی که کالا را به پروژه می‌دهند، حواله و ضایعات. فقط همین‌ها
 * رزرو پروژه را مصرف می‌کنند و در مقدار صادرشده به پروژه شمرده می‌شوند؛ فاکتور فروش با `projectId` فروش است، نه مصرف پروژه.
 */
export const PROJECT_ISSUE_DOCUMENT_TYPES = ['remittance', 'waste'] as const;

export function consumesProjectReservation(docType: string): boolean {
  return (PROJECT_ISSUE_DOCUMENT_TYPES as readonly string[]).includes(docType);
}
