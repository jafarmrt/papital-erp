/**
 * v12 phase 8e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision 7): the rules of the site's email, shared by
 * the server and the settings screen. The site sends email through the shop's own mail server (SMTP); the owner fills
 * the settings later, and until they are whole, email is off.
 */
export const EMAIL_SECURITY_MODES = ['tls', 'starttls', 'none'] as const;
export type EmailSecurity = typeof EMAIL_SECURITY_MODES[number];

export const EMAIL_SECURITY_TITLES: Readonly<Record<EmailSecurity, string>> = {
  tls: 'رمزگذاری کامل (معمولاً درگاه ۴۶۵)',
  starttls: 'رمزگذاری پس از آغاز اتصال (معمولاً درگاه ۵۸۷)',
  none: 'بی رمزگذاری (ناامن؛ فقط سرور بی نام کاربری)',
};

/** The port a mode usually takes, put in the form when the mode is picked */
export const EMAIL_SECURITY_PORTS: Readonly<Record<EmailSecurity, number>> = { tls: 465, starttls: 587, none: 25 };

export const isEmailSecurity = (value: unknown): value is EmailSecurity => (EMAIL_SECURITY_MODES as readonly unknown[]).includes(value);

export const EMAIL_ADDRESS_MAX = 254;
export const EMAIL_HOST_MAX = 253;
export const EMAIL_USERNAME_MAX = 254;
export const EMAIL_PASSWORD_MAX = 200;
export const EMAIL_FROM_NAME_MAX = 80;
export const EMAIL_PORT_DEFAULT = 587;

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** An email address as typed, trimmed and with its domain in lower case, or '' when it is not one */
export function normalizeEmail(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value || value.length > EMAIL_ADDRESS_MAX || !ADDRESS.test(value)) return '';
  const at = value.lastIndexOf('@');
  return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}

/** The key an address is matched by (one account per address, whatever its case) */
export const emailMatchKey = (email: string): string => normalizeEmail(email).toLowerCase();

/** A mail server's name: a host name or an IPv4 address, no scheme, port or path */
export const isEmailHost = (value: string): boolean => HOST.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);

/** A mail server's user name in an audit row: masked like an address when it is one, else its first letter only */
export function maskedUsername(username: string): string {
  if (!username) return '';
  return username.includes('@') ? maskedEmail(username) : `${username[0]}…`;
}

/** An address shown in the log, an audit row or a report: its first letter and its domain (AGENTS.md §5.5) */
export function maskedEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '…';
  return `${email[0]}…@${email.slice(at + 1)}`;
}

/**
 * v12 phase 8e: the one-time email codes of the site (sign-in, a new account's email, a forgotten password, and from
 * 8e3 a guest's proof), with the same shape and limits as the SMS codes. A code lives longer than an SMS one, since a
 * mail may take a minute to arrive.
 */
export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_SECONDS = 600;
export const EMAIL_CODE_RESEND_SECONDS = 60;
export const EMAIL_CODE_VERIFY_ATTEMPTS_MAX = 5;
export const EMAIL_CODES_PER_EMAIL_HOUR_MAX = 5;
export const EMAIL_CODES_PER_EMAIL_DAY_MAX = 10;
export const EMAIL_CODES_PER_ADDRESS_HOUR_MAX = 10;
export const EMAIL_WRONG_PER_EMAIL_DAY_MAX = 10;
/** The site's email codes in an hour, all addresses together (guards the mail server's own sending limit) */
export const EMAIL_CODES_HOURLY_CAP = 200;
/** After a right code: the email proof the step that follows presents once */
export const EMAIL_PROOF_TTL_SECONDS = 600;
export const EMAIL_PROOF_PREFIX = 'ep_';
export const EMAIL_PROOF_MAX = 80;
