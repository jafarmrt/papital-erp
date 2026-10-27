/**
 * v10.2 package 7 (OBS-R2-32): the Persian name of every activity type, one list for the activity book, the dossier and
 * the forms; an email or a task is never shown as «یادداشت» any more.
 */
export const CRM_ACTIVITY_TYPE_LABELS: Readonly<Record<string, string>> = {
  call: 'تماس تلفنی',
  meeting: 'جلسه',
  whatsapp: 'پیام / واتس‌اپ',
  email: 'ایمیل',
  quote: 'پیش‌فاکتور',
  note: 'یادداشت',
  task: 'کار',
};

export function activityTypeLabel(type: string | null | undefined): string {
  return CRM_ACTIVITY_TYPE_LABELS[String(type ?? '')] ?? 'اقدام';
}
