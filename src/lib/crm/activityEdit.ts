import { isoToJalaliDate } from '../../utils/calendarDate';

/**
 * v10.1.17 (N-02 بخش ۲، ت۱): فرم ویرایش اقدام از اقدام ذخیره‌شده و بدنه `PUT /crm/activities/:id`. بدنه فقط کلیدهای طرح
 * سخت‌گیر مسیر را دارد (پرونده و طرف حساب اقدام عوض نمی‌شوند) و نسخه‌ای را که فرم از آن ساخته شد می‌فرستد.
 */
export interface ActivityEditForm {
  type: string;
  title: string;
  description: string;
  result: string;
  /** شمسی، برای انتخابگر تاریخ */
  activityDate: string;
  nextFollowUpDate: string;
  nextFollowUpTask: string;
  assignedTo: string;
  assignedPersonnelId: number | null;
  mentions: number[];
}

interface StoredActivity {
  type?: string;
  title?: string;
  description?: string;
  result?: string;
  activityDate?: string;
  nextFollowUpDate?: string;
  nextFollowUpTask?: string;
  assignedTo?: string;
  assignedPersonnelId?: number | null;
  mentions?: unknown;
}

export function activityEditForm(act: StoredActivity): ActivityEditForm {
  return {
    type: act.type || 'call',
    title: act.title || '',
    description: act.description || '',
    result: act.result || '',
    activityDate: isoToJalaliDate(act.activityDate || '') || '',
    nextFollowUpDate: isoToJalaliDate(act.nextFollowUpDate || '') || '',
    nextFollowUpTask: act.nextFollowUpTask || '',
    assignedTo: act.assignedTo || '',
    assignedPersonnelId: act.assignedPersonnelId ?? null,
    mentions: Array.isArray(act.mentions) ? act.mentions.map(Number).filter(n => Number.isInteger(n) && n > 0) : [],
  };
}

export function activityEditPayload(form: Partial<ActivityEditForm>, version: number) {
  return {
    version,
    type: form.type,
    title: (form.title ?? '').trim(),
    description: form.description ?? '',
    result: form.result ?? '',
    activityDate: form.activityDate ?? '',
    nextFollowUpDate: form.nextFollowUpDate ?? '',
    nextFollowUpTask: form.nextFollowUpTask ?? '',
    assignedTo: form.assignedTo ?? '',
    assignedPersonnelId: form.assignedPersonnelId ?? null,
    mentions: Array.isArray(form.mentions) ? form.mentions : [],
  };
}
