/**
 * v10.1.41 (messenger notifications plan part 2, §2.3): the categories of in-app notifications, shared by the server and
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
  'workshop',
  'social',
  'settings_change',
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
  workshop: 'کارها و گزارش‌های کارتابل کارگاه',
  social: 'تولد همکاران و تبریک‌ها',
  // 10.3 package 5 (ت۴۷ item 5): for the system admins, e.g. «آستانه تراکنش کلان خزانه» changed by another user
  settings_change: 'تغییر تنظیمات حساس سامانه',
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
 * v10.2 package 9 (group dashboard, owner's decision of 24 Mehr 1405): categories that stay in the bell and never go to
 * Bale or Telegram, whatever the user's choices; `createNotifications` queues no messenger job for them.
 */
export const BELL_ONLY_CATEGORIES: readonly NotificationCategory[] = ['social'];
export const isBellOnlyCategory = (category: NotificationCategory): boolean => BELL_ONLY_CATEGORIES.includes(category);

/** The categories the profile offers a choice for: every category that may go to the messenger */
export const MESSENGER_PREFERENCE_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES.filter(c => !isBellOnlyCategory(c));

/**
 * Every category sends a fixed sentence, never its own title and text (security review of part 2): an automatic rule's
 * template may carry any event field, amounts included, and a follow-up, mention or lead title is typed by a user. v11
 * phase 6.4 (C11): the workflow categories too, whose text carries the step and workflow titles an admin types in the
 * designer («تایید فاکتور احمدی ۵۰ میلیون» would have reached Telegram or Bale with a name and an amount). They keep
 * their own link, which opens the record in the approval inbox and carries only its number.
 */
const OWN_LINK_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(['workflow_sla', 'workflow_task']);

const GENERIC_SENTENCES: Readonly<Partial<Record<NotificationCategory, string>>> = {
  workflow_task: 'یک کار تازه در کارتابل تأیید منتظر شماست.',
  workflow_sla: 'مهلت یکی از کارهای کارتابل تأیید شما گذشته است.',
  mention: 'در یک گزارش کار یا اقدام ارتباط با مشتری به شما اشاره شد.',
  daily_log_review: 'مدیر برای گزارش کار شما بازخورد ثبت کرد.',
  crm_followup: 'یک پیگیری ارتباط با مشتری برای شما ثبت شد یا سررسید آن رسید.',
  crm_won: 'یک پرونده فروش با موفقیت نهایی شد.',
  payslip: 'فیش حقوق شما تأیید شد.',
  workshop: 'یک کار یا گزارش در کارتابل کارگاه منتظر شماست.',
  settings_change: 'یکی از تنظیمات حساس سامانه تغییر کرد.',
};
const GENERIC_DEFAULT_SENTENCE = 'اعلان تازه‌ای در برنامه پاپیتال برای شما آمده است.';

/**
 * The page a messenger link opens: a workflow category keeps the notification's own path (the inbox record); every other
 * one opens a fixed page of its section (never a rule template's link, which may carry amounts or ids), else the app's
 * first page.
 */
const GENERIC_LINK_SECTIONS: readonly string[] = ['/daily-logs', '/crm', '/approval-inbox', '/workshop', '/my-payslips', '/settings'];

export function messengerLinkPath(category: NotificationCategory, path: string | null | undefined): string {
  const target = String(path ?? '').trim();
  if (OWN_LINK_CATEGORIES.has(category)) return target;
  if (category === 'event_rule') return '/';
  const section = target.split(/[?#]/)[0];
  return GENERIC_LINK_SECTIONS.includes(section) ? section : '/';
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function persianDigits(text: string): string {
  return text.replace(/[0-9]/g, d => PERSIAN_DIGITS[Number(d)]);
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
  return persianDigits(`${greeting}\n${GENERIC_SENTENCES[input.category] ?? GENERIC_DEFAULT_SENTENCE}`);
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
