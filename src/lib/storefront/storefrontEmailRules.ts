/**
 * v12 phase 8e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision 7): the rules of the site's email, shared by
 * the server and the settings screen. The site sends email through the shop's own mail server (SMTP); the owner fills
 * the settings later, and until they are whole, email is off.
 */
export const EMAIL_SECURITY_MODES = ['tls', 'starttls', 'none'] as const;
export type EmailSecurity = typeof EMAIL_SECURITY_MODES[number];

export const EMAIL_SECURITY_TITLES: Readonly<Record<EmailSecurity, string>> = {
  tls: 'رمزگذاری از آغاز (درگاه ۴۶۵)',
  starttls: 'رمزگذاری پس از سلام (درگاه ۵۸۷)',
  none: 'بی رمزگذاری',
};

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

/** An address shown in the log, an audit row or a report: its first letter and its domain (AGENTS.md §5.5) */
export function maskedEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '…';
  return `${email[0]}…@${email.slice(at + 1)}`;
}
