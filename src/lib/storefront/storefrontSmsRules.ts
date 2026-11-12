/**
 * v11 phase 8.4a (docs/roadmap/V11_STOREFRONT_8_4_SMS_START_PLAN.md): the rules of the site's text messages, shared by
 * the server and the ERP's «پیامک» section. Nothing here reads the database.
 *
 * Iranian SMS services send service messages to buyers only through a template the provider approved beforehand
 * («پیامک خدماتی با الگو»), so every message here is a template id plus fixed parameters, never free text. No message
 * carries an amount or a name (the same rule as the staff messengers, AGENTS.md §3.11): an order number, a tracking code
 * or a login code only.
 */
export const SMS_PROVIDERS = ['smsir', 'kavenegar'] as const;
export type SmsProvider = typeof SMS_PROVIDERS[number];
export const SMS_PROVIDER_TITLES: Readonly<Record<SmsProvider, string>> = {
  smsir: 'اس‌ام‌اس دات آی‌آر (sms.ir)',
  kavenegar: 'کاوه‌نگار',
};
export const isSmsProvider = (value: unknown): value is SmsProvider => SMS_PROVIDERS.includes(value as SmsProvider);

export const SMS_KINDS = [
  'otp', 'order_placed', 'receipt_rejected', 'order_paid', 'order_shipped', 'order_delivered', 'order_cancelled',
] as const;
export type SmsKind = typeof SMS_KINDS[number];
export const isSmsKind = (value: unknown): value is SmsKind => SMS_KINDS.includes(value as SmsKind);
/** The kinds that follow an order; `otp` is the login and phone check code */
export type OrderSmsKind = Exclude<SmsKind, 'otp'>;

/** The parameters of each kind's template, in order: Kavenegar's token, token2…; sms.ir's parameter names */
export const SMS_PARAM_NAMES = ['CODE', 'ORDER', 'TRACKING'] as const;
export type SmsParamName = typeof SMS_PARAM_NAMES[number];
export const SMS_KIND_PARAMS: Readonly<Record<SmsKind, readonly SmsParamName[]>> = {
  otp: ['CODE'],
  order_placed: ['ORDER'],
  receipt_rejected: ['ORDER'],
  order_paid: ['ORDER'],
  order_shipped: ['ORDER', 'TRACKING'],
  order_delivered: ['ORDER'],
  order_cancelled: ['ORDER'],
};
export type SmsParams = Partial<Record<SmsParamName, string>>;

export const SMS_KIND_TITLES: Readonly<Record<SmsKind, string>> = {
  otp: 'کد ورود و تأیید شماره',
  order_placed: 'ثبت سفارش',
  receipt_rejected: 'رد رسید پرداخت',
  order_paid: 'تأیید پرداخت',
  order_shipped: 'ارسال سفارش',
  order_delivered: 'تحویل سفارش',
  order_cancelled: 'لغو سفارش',
};

/**
 * A suggested template text for each kind, to be registered in the provider's panel. sms.ir names a parameter `#NAME#`;
 * Kavenegar numbers them `%token%`, `%token2%`; the ERP shows the text in the panel's own form.
 */
export const SMS_KIND_SUGGESTED_TEXT: Readonly<Record<SmsKind, string>> = {
  otp: 'کد ورود شما به پاپیتال: {CODE}\nاین کد را به کسی ندهید.',
  order_placed: 'سفارش {ORDER} در پاپیتال ثبت شد. لطفاً تا پایان مهلت، مبلغ را کارت‌به‌کارت کنید و رسید را در صفحهٔ سفارش بفرستید.',
  receipt_rejected: 'رسید پرداخت سفارش {ORDER} پذیرفته نشد. دلیل آن را در صفحهٔ سفارش ببینید.',
  order_paid: 'پرداخت سفارش {ORDER} تأیید شد. سپاس از خرید شما از پاپیتال.',
  order_shipped: 'سفارش {ORDER} پاپیتال ارسال شد. کد رهگیری: {TRACKING}',
  order_delivered: 'سفارش {ORDER} تحویل شد. امیدواریم از آن لذت ببرید.',
  order_cancelled: 'سفارش {ORDER} پاپیتال لغو شد. اگر پرداخت کرده‌اید با ما تماس بگیرید.',
};

/** The text as the provider's panel writes its placeholders */
export function suggestedTemplateText(kind: SmsKind, provider: SmsProvider): string {
  const params = SMS_KIND_PARAMS[kind];
  return SMS_KIND_SUGGESTED_TEXT[kind].replace(/\{([A-Z]+)\}/g, (_m, name: string) => {
    if (provider === 'smsir') return `#${name}#`;
    const index = params.indexOf(name as SmsParamName);
    return index <= 0 ? '%token%' : `%token${index + 1}%`;
  });
}

/** sms.ir: a numeric template id; Kavenegar: the template's latin name. '' = this kind is not sent */
export const SMS_TEMPLATE_MAX = 60;
export function templateIdError(provider: SmsProvider, template: string): string | null {
  const value = template.trim();
  if (!value) return null;
  if (value.length > SMS_TEMPLATE_MAX) return `شناسهٔ الگو حداکثر ${SMS_TEMPLATE_MAX.toLocaleString('fa-IR')} نویسه است.`;
  if (provider === 'smsir' && !/^[1-9]\d{0,9}$/.test(value)) return 'شناسهٔ الگوی sms.ir یک عدد است (از بخش «الگوها» در پنل).';
  if (provider === 'kavenegar' && !/^[A-Za-z0-9_-]+$/.test(value)) return 'نام الگوی کاوه‌نگار فقط حرف لاتین، رقم، خط تیره و زیرخط دارد.';
  return null;
}

/** A provider's key: printable latin text without spaces (both services give a long letter-and-digit key) */
export const SMS_API_KEY_MAX = 200;
export function apiKeyError(key: string): string | null {
  const value = key.trim();
  if (!value) return null;
  if (value.length > SMS_API_KEY_MAX) return `کلید سرویس پیامک حداکثر ${SMS_API_KEY_MAX.toLocaleString('fa-IR')} نویسه است.`;
  if (!/^[A-Za-z0-9._=+/-]{8,}$/.test(value)) return 'کلید سرویس پیامک را همان‌طور که پنل نشان می‌دهد، بی فاصله بچسبانید.';
  return null;
}

export const SMS_MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;
export type SmsMessageStatus = typeof SMS_MESSAGE_STATUSES[number];
export const SMS_MESSAGE_STATUS_TITLES: Readonly<Record<SmsMessageStatus, string>> = {
  queued: 'در صف',
  sending: 'در حال ارسال',
  sent: 'فرستاده شد',
  failed: 'ناموفق',
  skipped: 'فرستاده نشد',
};

/** The login code: digits only, short enough to type from the notification, valid for a few minutes */
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 180;
export const OTP_RESEND_SECONDS = 60;
export const OTP_VERIFY_ATTEMPTS_MAX = 5;
/** Codes one phone may ask for (start plan §4, against SMS pumping and guessing) */
export const OTP_PER_PHONE_HOUR_MAX = 5;
export const OTP_PER_PHONE_DAY_MAX = 10;
/** Codes one buyer address (an IPv6 address by its /56 subnet) may ask for in an hour, whatever the phone */
export const OTP_PER_ADDRESS_HOUR_MAX = 10;
/** Wrong codes one phone may type in a day over all its codes, so a fresh code does not give fresh guesses */
export const OTP_WRONG_PER_PHONE_DAY_MAX = 10;
/**
 * The site's budgets of texts in an hour and in a day (the day is 12 hours' worth), so neither a spread attack on login
 * codes nor orders placed for strangers' numbers can drain the SMS credit. v12 phase 8b (site review 2.11): login codes
 * and order texts each have a budget of their own, so filling one (codes asked for strangers' numbers) never stops the
 * other (a real buyer's order texts), and the colleagues who keep the texts hear of a budget at `SMS_BUDGET_WARN_PERCENT`.
 */
export const SMS_HOURLY_CAP_DEFAULT = 200;
export const SMS_BUDGET_WARN_PERCENT = 80;
export type SmsBudgetPool = 'codes' | 'orders';
export const SMS_BUDGET_POOL_TITLES: Readonly<Record<SmsBudgetPool, string>> = { codes: 'کد ورود', orders: 'پیامک سفارش' };
/** The texts in an hour at which a budget's bell rings: `SMS_BUDGET_WARN_PERCENT` of it, at least one */
export const smsBudgetWarnAt = (hourlyCap: number): number => Math.max(1, Math.ceil(hourlyCap * SMS_BUDGET_WARN_PERCENT / 100));
export const SMS_HOURLY_CAP_MAX = 5000;
export const SMS_DAILY_CAP_HOURS = 12;
/** Order texts one phone may get in a day (an order and its cancel are two) */
export const ORDER_SMS_PER_PHONE_DAY_MAX = 8;
/** A queued order text older than this is not sent any more (texts were off for a while): it is `skipped` */
export const SMS_QUEUED_MAX_HOURS = 24;
/** After a right code: the phone proof the sign-up or sign-in that follows presents once */
export const PHONE_PROOF_TTL_SECONDS = 600;
export const PHONE_PROOF_PREFIX = 'pp_';
/**
 * v12 phase 8e (start plan §5, «حالت بی پیامک»): when this many of the latest login texts, all within the window, failed,
 * the site stops asking for SMS codes and turns to email until the window has passed with no failures left in it.
 */
export const SMS_FAILURE_PAUSE_COUNT = 5;
export const SMS_FAILURE_PAUSE_MINUTES = 30;
/** 8e3 review: the failed texts come from at least this many visitors (so one script cannot pause the site's SMS) */
export const SMS_FAILURE_PAUSE_VISITORS = 3;
export const PHONE_PROOF_MAX = 80;

/** The code as the buyer typed it (Persian, Arabic or latin digits, spaces ignored), or null when it is not a code */
export function normalizeOtpCode(raw: string): string | null {
  const digits = String(raw ?? '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, '');
  return new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** A tracking code as one template parameter: Kavenegar's tokens take no spaces, so spaces are dropped */
export function smsParamValue(value: string): string {
  return String(value ?? '').replace(/\s+/g, '').slice(0, 40);
}

/** A phone shown in the ERP's log, hiding the middle digits (0912***4567) */
export function maskedMobile(phone: string): string {
  return /^09\d{9}$/.test(phone) ? `${phone.slice(0, 4)}***${phone.slice(-4)}` : phone;
}
