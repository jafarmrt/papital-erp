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

/** The categories the profile offers a choice for: every category, since v10.1.42 each one has its producer */
export const MESSENGER_PREFERENCE_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES;

/**
 * Allowlist (security review of part 2): only a category whose title and text the code builds from fixed words, step and
 * workflow titles and document numbers, never an amount, a person's name or text a user typed, sends its own text. Every
 * other category, a future one included, sends its fixed sentence below (an automatic rule's template may carry any event
 * field, amounts included; a follow-up, mention or lead title is typed by a user).
 */
const FULL_TEXT_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(['workflow_sla', 'workflow_task']);

const GENERIC_SENTENCES: Readonly<Partial<Record<NotificationCategory, string>>> = {
  mention: 'در یک گزارش کار یا اقدام ارتباط با مشتری به شما اشاره شد.',
  daily_log_review: 'مدیر برای گزارش کار شما بازخورد ثبت کرد.',
  crm_followup: 'یک پیگیری ارتباط با مشتری برای شما ثبت شد یا سررسید آن رسید.',
  crm_won: 'یک پرونده فروش با موفقیت نهایی شد.',
  payslip: 'فیش حقوق شما تأیید شد.',
  workshop: 'یک کار یا گزارش در کارتابل کارگاه منتظر شماست.',
};
const GENERIC_DEFAULT_SENTENCE = 'اعلان تازه‌ای در برنامه پاپیتال برای شما آمده است.';

/**
 * The page a messenger link opens: a full-text category keeps the notification's own path; every other one opens a fixed
 * page of its section (never a rule template's link, which may carry amounts or ids), else the app's first page.
 */
const GENERIC_LINK_SECTIONS: readonly string[] = ['/daily-logs', '/crm', '/approval-inbox', '/workshop', '/my-payslips'];

export function messengerLinkPath(category: NotificationCategory, path: string | null | undefined): string {
  const target = String(path ?? '').trim();
  if (FULL_TEXT_CATEGORIES.has(category)) return target;
  if (category === 'event_rule') return '/';
  const section = target.split(/[?#]/)[0];
  return GENERIC_LINK_SECTIONS.includes(section) ? section : '/';
}

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
  if (!FULL_TEXT_CATEGORIES.has(input.category)) {
    return persianDigits(`${greeting}\n${GENERIC_SENTENCES[input.category] ?? GENERIC_DEFAULT_SENTENCE}`);
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
