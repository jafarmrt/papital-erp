import type { Request } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { decryptSecret, encryptSecret, isSecretsKeyConfigured } from '../../lib/secretBox.js';
import { isPrivateOrReservedIp } from '../../lib/ssrfGuard.js';
import net from 'node:net';
import {
  EMAIL_FROM_NAME_MAX, EMAIL_PASSWORD_MAX, EMAIL_PORT_DEFAULT, EMAIL_USERNAME_MAX, isEmailHost, isEmailSecurity, maskedEmail, maskedUsername, normalizeEmail,
  type EmailSecurity,
} from '../../lib/storefront/storefrontEmailRules.js';
import {
  STOREFRONT_EMAIL_SETTING_KEYS as KEYS, type StorefrontEmailSettingsInput, type StorefrontEmailSettingsView, type StorefrontEmailTestResult,
} from '../../lib/storefront/storefrontEmailContracts.js';
import { isTestMailServer, sendEmail, type EmailServer } from './storefrontEmailClient.js';

/**
 * v12 phase 8e (start plan §5, owner's decision 7): the settings of the site's email in `app_settings` (`sf_email_*`), a
 * group with its own version beside the texts' (so the forms never overwrite each other): on or off (default off), the
 * mail server's name, port and encryption, its user name, its password (encrypted with `ERP_SECRETS_KEY`, AGENTS.md
 * §5.5; no answer and no audit row carries it, only whether one is stored and readable) and the sender's address and
 * name. Until the group is whole and on, the site sends no email. One save writes the group under the lock of its
 * version row with one audit row in the same transaction.
 */
const GROUP_KEYS = Object.values(KEYS);

type Stored = Record<string, string>;

async function readStored(executor: DbExecutor): Promise<Stored> {
  const rows = await executor.select().from(appSettings).where(inArray(appSettings.key, [...GROUP_KEYS]));
  return Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]));
}

function portOf(stored: string | undefined): number {
  const value = Number(stored);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : EMAIL_PORT_DEFAULT;
}

/** What the sender reads: the plain password ('' = none stored, null = stored but not readable with this server's key) */
export interface EmailRuntimeSettings extends Omit<EmailServer, 'password'> {
  enabled: boolean;
  password: string | null;
}

function runtimeOf(stored: Stored): EmailRuntimeSettings {
  const sealed = stored[KEYS.password] ?? '';
  return {
    enabled: stored[KEYS.enabled] === '1',
    host: stored[KEYS.host] ?? '',
    port: portOf(stored[KEYS.port]),
    security: isEmailSecurity(stored[KEYS.security]) ? stored[KEYS.security] as EmailSecurity : 'starttls',
    username: stored[KEYS.username] ?? '',
    password: sealed ? decryptSecret(sealed) : '',
    fromAddress: stored[KEYS.fromAddress] ?? '',
    fromName: stored[KEYS.fromName] ?? '',
  };
}

export async function emailRuntimeSettings(executor: DbExecutor): Promise<EmailRuntimeSettings> {
  return runtimeOf(await readStored(executor));
}

/** The mail server as the sender uses it, or null when its settings are not whole and readable */
export function usableServer(settings: EmailRuntimeSettings): EmailServer | null {
  if (!settings.host || !settings.fromAddress || settings.password === null) return null;
  if (settings.username && !settings.password) return null;
  // a user name and password never cross the network in the clear (only the database tests' server on this machine)
  if (settings.username && settings.security === 'none' && !isTestMailServer(settings.host, settings.port)) return null;
  return { ...settings, password: settings.password };
}

/** Whether the site sends email now: on, with whole and readable settings */
export async function emailOn(executor: DbExecutor): Promise<boolean> {
  const settings = await emailRuntimeSettings(executor);
  return settings.enabled && usableServer(settings) !== null;
}

export async function readEmailSettings(executor: DbExecutor): Promise<StorefrontEmailSettingsView> {
  const stored = await readStored(executor);
  const runtime = runtimeOf(stored);
  return {
    enabled: runtime.enabled,
    host: runtime.host,
    port: runtime.port,
    security: runtime.security,
    username: runtime.username,
    password: { configured: Boolean(stored[KEYS.password]), readable: runtime.password !== null },
    fromAddress: runtime.fromAddress,
    fromName: runtime.fromName,
    ready: runtime.enabled && usableServer(runtime) !== null,
    version: Number(stored[KEYS.version]) || 0,
    secretsKeyConfigured: isSecretsKeyConfigured(),
  };
}

async function lockVersion(tx: DbExecutor, expected: number): Promise<number> {
  await tx.insert(appSettings).values({ key: KEYS.version, value: '0' }).onConflictDoNothing({ target: appSettings.key });
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.version)).for('update');
  const current = Number(row?.value) || 0;
  if (current !== expected) {
    throw new OptimisticLockError({ entityType: 'StorefrontEmailSettings', entityId: KEYS.version, expectedVersion: expected, currentVersion: current });
  }
  return current;
}

async function writeValue(tx: DbExecutor, key: string, value: string): Promise<void> {
  await tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

const invalid = (message: string, field: string, code: string) => new ValidationError(message, { field }, code);

function checkedInput(input: StorefrontEmailSettingsInput) {
  const host = String(input.host ?? '').trim().toLowerCase();
  if (host && !isEmailHost(host)) throw invalid('نام سرور ایمیل را بی «://» و بی مسیر بنویسید (مانند mail.example.com).', 'host', 'STOREFRONT_EMAIL_HOST_INVALID');
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw invalid('درگاه سرور ایمیل باید عددی از ۱ تا ۶۵۵۳۵ باشد.', 'port', 'STOREFRONT_EMAIL_PORT_INVALID');
  if (host && net.isIP(host) && isPrivateOrReservedIp(host) && !isTestMailServer(host, input.port)) {
    throw invalid('نشانی سرور ایمیل داخلی یا رزروشده است و برای امنیت پذیرفته نمی‌شود.', 'host', 'STOREFRONT_EMAIL_HOST_INSIDE');
  }
  if (!isEmailSecurity(input.security)) throw invalid('نوع رمزگذاری شناخته نیست.', 'security', 'STOREFRONT_EMAIL_SECURITY_INVALID');
  const username = String(input.username ?? '').trim();
  // a user name and password never cross the network in the clear (only the database tests' server on this machine speaks plain)
  if (username && input.security === 'none' && !isTestMailServer(host, input.port)) throw invalid('سروری که نام کاربری و رمز می‌خواهد بی رمزگذاری پذیرفته نیست؛ یکی از دو رمزگذاری را برگزینید.', 'security', 'STOREFRONT_EMAIL_PLAIN_SIGN_IN');
  if (username.length > EMAIL_USERNAME_MAX || /[\r\n]/.test(username)) throw invalid('نام کاربری سرور ایمیل درست نیست.', 'username', 'STOREFRONT_EMAIL_USERNAME_INVALID');
  const password = String(input.password ?? '');
  if (password.length > EMAIL_PASSWORD_MAX || /[\r\n]/.test(password)) throw invalid('رمز سرور ایمیل درست نیست.', 'password', 'STOREFRONT_EMAIL_PASSWORD_INVALID');
  const rawFrom = String(input.fromAddress ?? '').trim();
  const fromAddress = rawFrom ? normalizeEmail(rawFrom) : '';
  if (rawFrom && !fromAddress) throw invalid('نشانی فرستنده را درست بنویسید (مانند shop@example.com).', 'fromAddress', 'STOREFRONT_EMAIL_FROM_INVALID');
  const fromName = String(input.fromName ?? '').trim();
  if (fromName.length > EMAIL_FROM_NAME_MAX || /[\r\n<>"]/.test(fromName)) throw invalid('نام فرستنده درست نیست.', 'fromName', 'STOREFRONT_EMAIL_FROM_NAME_INVALID');
  return { host, username, password, fromAddress, fromName };
}

export async function saveEmailSettings(req: Request, input: StorefrontEmailSettingsInput): Promise<StorefrontEmailSettingsView> {
  const checked = checkedInput(input);
  // encrypted before the transaction: no secrets key = 503 and nothing written
  const sealed = checked.password && !input.clearPassword ? encryptSecret(checked.password) : '';
  await orm.transaction(async (tx) => {
    const current = await lockVersion(tx, input.version);
    const stored = await readStored(tx);
    const before = runtimeOf(stored);
    const sealedAfter = input.clearPassword ? '' : sealed || stored[KEYS.password] || '';
    // a password belongs to its server: sending it to a new server would hand it to a third party
    if (sealedAfter && sealedAfter === stored[KEYS.password] && (checked.host !== before.host || checked.username !== before.username)) {
      throw invalid('با عوض کردن سرور یا نام کاربری، رمز را هم دوباره وارد کنید (یا رمز ذخیره‌شده را پاک کنید).', 'password', 'STOREFRONT_EMAIL_PASSWORD_FOR_OTHER_SERVER');
    }
    const enabled = input.enabled === true;
    if (enabled) {
      if (!checked.host) throw invalid('برای روشن کردن ایمیل، نام سرور ایمیل را بنویسید.', 'host', 'STOREFRONT_EMAIL_NEEDS_HOST');
      if (!checked.fromAddress) throw invalid('برای روشن کردن ایمیل، نشانی فرستنده را بنویسید.', 'fromAddress', 'STOREFRONT_EMAIL_NEEDS_FROM');
      if (checked.username && !sealedAfter) throw invalid('برای روشن کردن ایمیل با نام کاربری، رمز سرور ایمیل را هم وارد کنید.', 'password', 'STOREFRONT_EMAIL_NEEDS_PASSWORD');
      if (sealedAfter && sealedAfter === stored[KEYS.password] && before.password === null) {
        throw invalid('رمز ذخیره‌شدهٔ سرور ایمیل با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ رمز را دوباره وارد کنید.', 'password', 'STOREFRONT_EMAIL_PASSWORD_UNREADABLE');
      }
    }
    const after = { enabled, host: checked.host, port: input.port, security: input.security, username: checked.username, fromAddress: checked.fromAddress, fromName: checked.fromName };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [key, value] of Object.entries(after)) {
      const was = before[key as keyof typeof after];
      // the addresses and the user name stay out of the audit row (AGENTS.md §5.5), only that they changed and their domain
      if (was === value) continue;
      if (key === 'fromAddress') changes[key] = { before: was ? maskedEmail(String(was)) : '', after: value ? maskedEmail(String(value)) : '' };
      else if (key === 'username') changes[key] = { before: maskedUsername(String(was)), after: maskedUsername(String(value)) };
      else changes[key] = { before: was, after: value };
    }
    const passwordChanged = sealedAfter !== (stored[KEYS.password] ?? '');
    // the password never enters the audit row: only that it changed
    if (passwordChanged) changes.password = { before: stored[KEYS.password] ? '[PROTECTED]' : '', after: sealedAfter ? '[PROTECTED]' : '' };
    if (Object.keys(changes).length === 0) return;
    await writeValue(tx, KEYS.enabled, enabled ? '1' : '0');
    await writeValue(tx, KEYS.host, checked.host);
    await writeValue(tx, KEYS.port, String(input.port));
    await writeValue(tx, KEYS.security, input.security);
    await writeValue(tx, KEYS.username, checked.username);
    await writeValue(tx, KEYS.fromAddress, checked.fromAddress);
    await writeValue(tx, KEYS.fromName, checked.fromName);
    if (passwordChanged) await writeValue(tx, KEYS.password, sealedAfter);
    await writeValue(tx, KEYS.version, String(current + 1));
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'email',
      description: 'تنظیمات ایمیل سایت ذخیره شد', details: { changes },
    });
  });
  invalidateSettingsCache();
  return readEmailSettings(orm);
}

const TEST_SUBJECT = 'ایمیل آزمایشی فروشگاه';
const TEST_TEXT = 'این ایمیل آزمایشی از تنظیمات ایمیل سایت فرستاده شد. اگر آن را می‌بینید، ایمیل سایت درست کار می‌کند.';

/** «ایمیل آزمایشی»: one real mail to the address typed, from the stored settings, even while email is off */
export async function sendTestEmail(req: Request, input: { to: string }): Promise<StorefrontEmailTestResult> {
  const to = normalizeEmail(input.to);
  if (!to) throw invalid('نشانی ایمیل را درست بنویسید (مانند name@example.com).', 'to', 'STOREFRONT_EMAIL_TO_INVALID');
  const settings = await emailRuntimeSettings(orm);
  if (settings.password === null) throw invalid('رمز ذخیره‌شدهٔ سرور ایمیل با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ آن را دوباره وارد کنید.', 'password', 'STOREFRONT_EMAIL_PASSWORD_UNREADABLE');
  if (settings.username && settings.security === 'none' && !isTestMailServer(settings.host, settings.port)) throw invalid('سروری که نام کاربری و رمز می‌خواهد بی رمزگذاری پذیرفته نیست؛ یکی از دو رمزگذاری را برگزینید.', 'security', 'STOREFRONT_EMAIL_PLAIN_SIGN_IN');
  const server = usableServer(settings);
  if (!server) throw invalid('اول نام سرور ایمیل، نشانی فرستنده و (اگر نام کاربری دارد) رمز را ذخیره کنید.', 'host', 'STOREFRONT_EMAIL_NOT_SET');
  const result = await sendEmail(server, { to, subject: TEST_SUBJECT, text: TEST_TEXT });
  await orm.transaction(async (tx) => {
    await logActivity({
      req, tx, action: 'CREATE', entity: 'فروشگاه سایت', entityId: 'email-test',
      description: `ایمیل آزمایشی به ${maskedEmail(to)} ${result.ok ? 'فرستاده شد' : 'فرستاده نشد'}`,
      details: { to: maskedEmail(to), sent: result.ok },
    });
  });
  return { sent: result.ok, error: result.ok ? '' : result.error };
}
