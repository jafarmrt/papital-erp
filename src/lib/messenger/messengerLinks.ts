import { toLatinDigits } from '../numericInput.js';

/**
 * v10.1.37 (messenger notifications plan, part 1): the shared contract of the staff messenger bots, used by the server
 * (`src/services/messenger/*`, `src/routes/messenger.routes.ts`) and the browser (profile «پیام‌رسان» tab, settings tab
 * «ربات‌های پیام‌رسان»). Two messengers, Bale and Telegram, each with its own staff bot (product-owner decision ت۱ الف).
 */
export const MESSENGERS = ['bale', 'telegram'] as const;
export type Messenger = (typeof MESSENGERS)[number];

export const MESSENGER_LABELS: Readonly<Record<Messenger, string>> = { bale: 'بله', telegram: 'تلگرام' };

export function isMessenger(value: unknown): value is Messenger {
  return typeof value === 'string' && (MESSENGERS as readonly string[]).includes(value);
}

/** A link code is six digits and lives ten minutes */
export const LINK_CODE_LENGTH = 6;
export const LINK_CODE_TTL_MINUTES = 10;

export const UNLINK_REASONS = ['user', 'stop', 'blocked', 'relinked', 'bot_changed'] as const;
export type UnlinkReason = (typeof UNLINK_REASONS)[number];

export const UNLINK_REASON_LABELS: Readonly<Record<UnlinkReason, string>> = {
  user: 'خودتان اتصال را قطع کردید',
  stop: 'در پیام‌رسان دستور توقف را فرستادید',
  blocked: 'ربات را مسدود کردید و پیام‌ها نرسید',
  relinked: 'این حساب پیام‌رسان به کاربر دیگری وصل شد',
  bot_changed: 'مدیر سامانه ربات را عوض کرد',
};

/**
 * The code in a message sent to the bot: «/start 123456», «123456» or the same with Persian or Arabic digits and spaces;
 * null when the text holds no six-digit code.
 */
export function parseLinkCode(text: string): string | null {
  const latin = toLatinDigits(String(text ?? '')).replace(/[\s‌-]/g, '');
  const match = /(?:^|\D)(\d{6})(?:\D|$)/.exec(latin);
  return match ? match[1] : null;
}

/** «/stop» (with or without the bot's name) ends the chat's link */
export function isStopCommand(text: string): boolean {
  return /^\/stop(@\w+)?$/i.test(String(text ?? '').trim());
}

/** The bot's address with the code, so tapping «شروع» in the messenger sends the code itself */
export function botStartLink(messenger: Messenger, botUsername: string, code?: string): string {
  const name = botUsername.replace(/^@/, '');
  if (!name) return '';
  const base = messenger === 'telegram' ? `https://t.me/${name}` : `https://ble.ir/${name}`;
  return code ? `${base}?start=${code}` : base;
}

/** The current user's state with one messenger (`GET /messenger/links/mine`) */
export interface MyMessengerLink {
  messenger: Messenger;
  botConfigured: boolean;
  botUsername: string;
  linked: boolean;
  /** UTC with `Z` */
  linkedAt: string | null;
  chatName: string;
  lastUnlink: { at: string | null; reason: UnlinkReason } | null;
}

export interface LinkCodeIssued {
  messenger: Messenger;
  code: string;
  /** UTC with `Z` */
  expiresAt: string;
  botUsername: string;
  startLink: string;
}

/** One staff bot as the system admin sees it; the token itself never leaves the server */
export interface MessengerBotView {
  messenger: Messenger;
  configured: boolean;
  /** false: a token is stored but the server's encryption key cannot open it */
  tokenReadable: boolean;
  botUsername: string;
  updatedAt: string | null;
  activeLinks: number;
}

/** One active link in the system admin's list (no chat id) */
export interface MessengerLinkAdminRow {
  userId: number;
  userFullName: string;
  username: string;
  messenger: Messenger;
  linkedAt: string | null;
}
