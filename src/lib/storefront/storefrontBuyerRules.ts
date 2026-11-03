import { digitsOnly } from './storefrontRules.js';

/**
 * v11 phase 8.2b (package 18, start plan §6): the rules of buyer groups and buyer accounts that the server, the ERP pages
 * and the tests share. Pure: no database, no clock.
 */
export const BUYER_ACCOUNT_STATUSES = ['pending', 'active', 'suspended'] as const;
export type BuyerAccountStatus = typeof BUYER_ACCOUNT_STATUSES[number];
export const BUYER_ACCOUNT_STATUS_TITLES: Readonly<Record<BuyerAccountStatus, string>> = {
  pending: 'در انتظار بررسی',
  active: 'فعال',
  suspended: 'معلق',
};
export const isBuyerAccountStatus = (value: unknown): value is BuyerAccountStatus => BUYER_ACCOUNT_STATUSES.includes(value as BuyerAccountStatus);

export const APPLICATION_STATUSES = ['none', 'pending', 'approved', 'declined'] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
export const APPLICATION_STATUS_TITLES: Readonly<Record<ApplicationStatus, string>> = {
  none: 'خریدار تکی',
  pending: 'درخواست خرید عمده',
  approved: 'خریدار عمده',
  declined: 'درخواست ردشده',
};
export const isApplicationStatus = (value: unknown): value is ApplicationStatus => APPLICATION_STATUSES.includes(value as ApplicationStatus);

/** The filters of the «خریداران عمده» page */
export const BUYER_LIST_FILTERS = ['pending', 'approved', 'declined', 'retail', 'suspended', 'all'] as const;
export type BuyerListFilter = typeof BUYER_LIST_FILTERS[number];

export const BUYER_NAME_MAX = 80;
export const COMPANY_NAME_MAX = 120;
export const BUYER_CITY_MAX = 60;
export const APPLICATION_NOTE_MAX = 500;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** A session lasts 30 days, so a phone keeps the buyer signed in (start plan §9الف) */
export const SESSION_DAYS = 30;
/** A set-password link is good for 48 hours and one use */
export const PASSWORD_LINK_HOURS = 48;
/** After 5 wrong passwords in a row an account is locked for 15 minutes */
export const LOGIN_FAILURES_MAX = 5;
export const LOGIN_LOCK_MINUTES = 15;

export const GROUP_TITLE_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 300;
export const GROUP_COLLECTIONS_MAX = 30;
export const GROUP_MIN_LINE_QUANTITY_MAX = 999;
export const CATALOG_SCOPES = ['all', 'collections'] as const;
export type CatalogScope = typeof CATALOG_SCOPES[number];
export const CATALOG_SCOPE_TITLES: Readonly<Record<CatalogScope, string>> = {
  all: 'همهٔ کالاهای سایت',
  collections: 'فقط کالکشن‌های برگزیده',
};
export const isCatalogScope = (value: unknown): value is CatalogScope => CATALOG_SCOPES.includes(value as CatalogScope);

/** A group code: Latin lower-case letters, digits, `_` or `-`, 2 to 40 characters, starting with a letter */
export function groupCodeError(code: string): string | null {
  if (!code) return 'کد گروه لازم است.';
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(code)) return 'کد گروه ۲ تا ۴۰ حرف کوچک لاتین، رقم، «_» یا «-» است و با حرف آغاز می‌شود.';
  return null;
}

/** Why a new password is not taken, or null */
export function passwordError(password: string, phone: string): string | null {
  if (password.length < PASSWORD_MIN) return `رمز دست‌کم ${PASSWORD_MIN.toLocaleString('fa-IR')} نویسه است.`;
  if (password.length > PASSWORD_MAX) return `رمز حداکثر ${PASSWORD_MAX.toLocaleString('fa-IR')} نویسه است.`;
  if (/^(.)\1+$/u.test(password)) return 'رمز نباید از یک نویسهٔ تکراری باشد.';
  const digits = digitsOnly(password);
  if (phone && /^\d+$/.test(digits) && digits.includes(phone.slice(1))) return 'رمز نباید شمارهٔ همراه باشد.';
  return null;
}

/** An optional national id of a company (11 digits) or a person (10 digits), Persian digits read; '' when empty, null when wrong */
export function normalizeNationalId(raw: string): string | null {
  const digits = digitsOnly(String(raw ?? ''));
  if (!digits) return '';
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

/** An optional 12-digit economic code; '' when empty, null when wrong */
export function normalizeEconomicCode(raw: string): string | null {
  const digits = digitsOnly(String(raw ?? ''));
  if (!digits) return '';
  return /^\d{12}$/.test(digits) ? digits : null;
}

/**
 * The site page that takes a set-password link. The token goes after `#`, so it never reaches a server log; the page
 * reads it in the browser and posts it to `POST /auth/set-password`. The origin is the site's main domain until 8.6
 * gives the site address its own setting.
 */
export const STOREFRONT_SITE_ORIGIN = 'https://papitalgallery.com';
export const SET_PASSWORD_PATH = '/account/set-password';
export const setPasswordLinkOf = (token: string): string => `${STOREFRONT_SITE_ORIGIN}${SET_PASSWORD_PATH}#${token}`;

export const BUYER_LIST_FILTER_TITLES: Readonly<Record<BuyerListFilter, string>> = {
  pending: 'درخواست‌های تازه',
  approved: 'خریداران عمده',
  declined: 'ردشده',
  retail: 'خریداران تکی',
  suspended: 'معلق',
  all: 'همه',
};
