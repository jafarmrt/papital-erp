/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): the categories of in-app notifications, shared by the server and
 * the profile. Every notification is written with one of them; the user chooses per category whether it also goes to
 * their linked Bale or Telegram account (on by default). The messenger text is personal (decision ت۲): the recipient's
 * name, what it is about and a direct link, in Persian digits and without any amount.
 */
export const NOTIFICATION_CATEGORIES = [
  'workflow_task',
  'workflow_sla',
  'payslip',
  'mention',
  'daily_log_review',
  'crm_followup',
  'crm_won',
  'event_rule',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Readonly<Record<NotificationCategory, string>> = {
  workflow_task: 'کار تازه در کارتابل',
  workflow_sla: 'گذشتن مهلت کار کارتابل',
  payslip: 'فیش حقوق تأییدشده',
  mention: 'اشاره به شما در گزارش کار یا ارتباط با مشتری',
  daily_log_review: 'بازخورد مدیر بر گزارش کار شما',
  crm_followup: 'پیگیری‌های ارتباط با مشتری',
  crm_won: 'پرونده فروش موفق',
  event_rule: 'اعلان‌های قانون‌های خودکار',
};

/** One row of «در پیام‌رسان هم بفرست» in the profile (`GET /messenger/preferences/mine`) */
export interface MessengerPreference {
  category: NotificationCategory;
  label: string;
  sendToMessenger: boolean;
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Categories whose in-app text is written by the administrator (an automatic rule's template may carry any field of an
 * event, amounts included): their messenger text says only that a notification came, never the template's text.
 */
const GENERIC_TEXT_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(['event_rule']);

/** The longest notification body put in a message; the rest is in the app */
export const MESSENGER_BODY_MAX_CHARS = 500;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function persianDigits(text: string): string {
  return text.replace(/[0-9]/g, d => PERSIAN_DIGITS[Number(d)]);
}

function clipped(text: string): string {
  const flat = text.trim();
  return flat.length > MESSENGER_BODY_MAX_CHARS ? `${flat.slice(0, MESSENGER_BODY_MAX_CHARS - 1)}…` : flat;
}

export interface MessengerTextInput {
  recipientName: string;
  category: NotificationCategory;
  title: string;
  message: string;
}

/** The message a linked user receives for one notification, without its link (added when it is sent) */
export function messengerNotificationText(input: MessengerTextInput): string {
  const name = input.recipientName.trim();
  const greeting = name ? `${name}،` : 'سلام،';
  if (GENERIC_TEXT_CATEGORIES.has(input.category)) {
    return persianDigits(`${greeting}\nاعلان تازه‌ای در برنامه پاپیتال برای شما آمده است.`);
  }
  const lines = [greeting, clipped(input.title)];
  const body = clipped(input.message);
  if (body && body !== lines[1]) lines.push(body);
  return persianDigits(lines.join('\n'));
}

/** The direct link of a notification: the app's address (APP_URL) and the notification's own path; none without either */
export function notificationAbsoluteLink(appUrl: string | undefined, path: string | null | undefined): string {
  const base = String(appUrl ?? '').trim().replace(/\/+$/, '');
  const target = String(path ?? '').trim();
  if (!base || !/^https?:\/\//i.test(base) || !target.startsWith('/')) return '';
  return `${base}${target}`;
}

/** The message as sent: the text, then «دیدن در برنامه:» and the link when there is one */
export function messengerMessageWithLink(text: string, link: string): string {
  return link ? `${text}\n\nدیدن در برنامه:\n${link}` : text;
}
