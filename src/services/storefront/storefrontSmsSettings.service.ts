import type { Request } from 'express';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings, storefrontSmsMessages } from '../../db/schema.js';
import { STOREFRONT_SETTING_KEYS } from '../../lib/storefront/storefrontContracts.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { decryptSecret, encryptSecret, isSecretsKeyConfigured } from '../../lib/secretBox.js';
import {
  SMS_FAILURE_PAUSE_COUNT, SMS_FAILURE_PAUSE_MINUTES, SMS_HOURLY_CAP_DEFAULT, SMS_HOURLY_CAP_MAX, SMS_KINDS, SMS_KIND_TITLES, apiKeyError, isSmsKind, isSmsProvider, templateIdError,
  type SmsKind, type SmsProvider,
} from '../../lib/storefront/storefrontSmsRules.js';
import {
  STOREFRONT_SMS_SETTING_KEYS as KEYS, type SmsTemplates, type StorefrontSmsSettingsInput, type StorefrontSmsSettingsView,
} from '../../lib/storefront/storefrontSmsContracts.js';

/**
 * v11 phase 8.4a: the settings of the site's text messages in `app_settings` (`sf_sms_*`), a group of its own with its
 * own version beside the storefront's (so the two forms never overwrite each other): on or off (default off), the
 * provider, its key (encrypted with `ERP_SECRETS_KEY`, AGENTS.md §5.5; the screen sees only whether one is stored and its
 * last four letters), each message kind's template (an empty template = that kind is not sent) and the site's hourly
 * budget of login codes. One save writes the group under the lock of its version row with one audit row in the same
 * transaction; the audit row never holds the key.
 */
const GROUP_KEYS = [KEYS.enabled, KEYS.provider, KEYS.apiKey, KEYS.apiKeyHint, KEYS.templates, KEYS.hourlyCap, KEYS.orderHourlyCap, KEYS.loginPaused, KEYS.version, STOREFRONT_SETTING_KEYS.enabled] as const;

type Stored = Record<string, string>;

async function readStored(executor: DbExecutor): Promise<Stored> {
  const rows = await executor.select().from(appSettings).where(inArray(appSettings.key, [...GROUP_KEYS]));
  return Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]));
}

function templatesOf(stored: string | undefined): SmsTemplates {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(stored || '{}');
  } catch {
    parsed = {};
  }
  const out: SmsTemplates = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSmsKind(kind) && typeof value === 'string' && value.trim()) out[kind] = value.trim();
    }
  }
  return out;
}

function hourlyCapOf(stored: string | undefined): number {
  const value = Number(stored);
  return Number.isInteger(value) && value >= 1 && value <= SMS_HOURLY_CAP_MAX ? value : SMS_HOURLY_CAP_DEFAULT;
}

/** What the sender and the code service read: the plain key (null when stored but not readable with this server's key) */
export interface SmsRuntimeSettings {
  enabled: boolean;
  /** the site itself (`sf_enabled`): while it is off no buyer text is queued */
  siteEnabled: boolean;
  provider: SmsProvider;
  apiKey: string | null;
  templates: SmsTemplates;
  /** login codes in an hour (v12 phase 8b: order texts have `orderHourlyCap`) */
  hourlyCap: number;
  orderHourlyCap: number;
  /** v12 phase 8e: «حالت بی پیامک» by hand: no login code is sent (order texts still go) */
  loginPaused: boolean;
}

function runtimeOf(stored: Stored): SmsRuntimeSettings {
  const sealed = stored[KEYS.apiKey] ?? '';
  return {
    enabled: stored[KEYS.enabled] === '1',
    siteEnabled: stored[STOREFRONT_SETTING_KEYS.enabled] === '1',
    provider: isSmsProvider(stored[KEYS.provider]) ? stored[KEYS.provider] as SmsProvider : 'smsir',
    apiKey: sealed ? decryptSecret(sealed) : '',
    templates: templatesOf(stored[KEYS.templates]),
    hourlyCap: hourlyCapOf(stored[KEYS.hourlyCap]),
    orderHourlyCap: hourlyCapOf(stored[KEYS.orderHourlyCap]),
    loginPaused: stored[KEYS.loginPaused] === '1',
  };
}

export async function smsRuntimeSettings(executor: DbExecutor): Promise<SmsRuntimeSettings> {
  return runtimeOf(await readStored(executor));
}

/** The template a kind is sent with now, or null: the site or its texts off, no readable key, or no template for that kind */
export function activeTemplate(settings: SmsRuntimeSettings, kind: SmsKind): string | null {
  if (!settings.siteEnabled || !settings.enabled || !settings.apiKey) return null;
  return settings.templates[kind] ?? null;
}

/** v11 phase 8.4b: whether the site signs buyers in by SMS now (its texts on with a login code template) */
/**
 * v12 phase 8e (start plan §5, «حالت بی پیامک»): the latest `SMS_FAILURE_PAUSE_COUNT` login texts, all sent within the
 * last `SMS_FAILURE_PAUSE_MINUTES`, failed. Test texts do not count.
 */
export async function smsLoginFailing(executor: DbExecutor): Promise<boolean> {
  const latest = await executor.select({ status: storefrontSmsMessages.status }).from(storefrontSmsMessages)
    .where(and(eq(storefrontSmsMessages.kind, 'otp'), eq(storefrontSmsMessages.isTest, 0),
      gt(storefrontSmsMessages.createdAt, sql`now() - make_interval(mins => ${SMS_FAILURE_PAUSE_MINUTES})`)))
    .orderBy(desc(storefrontSmsMessages.createdAt), desc(storefrontSmsMessages.id)).limit(SMS_FAILURE_PAUSE_COUNT);
  return latest.length === SMS_FAILURE_PAUSE_COUNT && latest.every(r => r.status === 'failed');
}

/**
 * Whether the site signs in and proves phones by SMS: the texts on with a login template, and v12 phase 8e: not in
 * «حالت بی پیامک» (the owner's switch, or the latest login texts all failing). While it is off the site turns to email.
 */
export async function smsLoginOn(executor: DbExecutor): Promise<boolean> {
  const settings = await smsRuntimeSettings(executor);
  if (activeTemplate(settings, 'otp') === null || settings.loginPaused) return false;
  return !(await smsLoginFailing(executor));
}

export async function readSmsSettings(executor: DbExecutor): Promise<StorefrontSmsSettingsView> {
  const stored = await readStored(executor);
  const runtime = runtimeOf(stored);
  return {
    enabled: runtime.enabled,
    provider: runtime.provider,
    apiKey: { configured: Boolean(stored[KEYS.apiKey]), hint: stored[KEYS.apiKeyHint] ?? '', readable: runtime.apiKey !== null },
    templates: runtime.templates,
    hourlyCap: runtime.hourlyCap,
    orderHourlyCap: runtime.orderHourlyCap,
    loginPaused: runtime.loginPaused,
    autoPaused: await smsLoginFailing(executor),
    version: Number(stored[KEYS.version]) || 0,
    secretsKeyConfigured: isSecretsKeyConfigured(),
  };
}

async function lockVersion(tx: DbExecutor, expected: number): Promise<number> {
  await tx.insert(appSettings).values({ key: KEYS.version, value: '0' }).onConflictDoNothing({ target: appSettings.key });
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.version)).for('update');
  const current = Number(row?.value) || 0;
  if (current !== expected) {
    throw new OptimisticLockError({ entityType: 'StorefrontSmsSettings', entityId: KEYS.version, expectedVersion: expected, currentVersion: current });
  }
  return current;
}

async function writeValue(tx: DbExecutor, key: string, value: string): Promise<void> {
  await tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

function checkedTemplates(provider: SmsProvider, input: SmsTemplates): SmsTemplates {
  const out: SmsTemplates = {};
  for (const kind of SMS_KINDS) {
    const value = String(input[kind] ?? '').trim();
    if (!value) continue;
    const problem = templateIdError(provider, value);
    if (problem) throw new ValidationError(`${SMS_KIND_TITLES[kind]}: ${problem}`, { field: `templates.${kind}` }, 'STOREFRONT_SMS_TEMPLATE_INVALID');
    out[kind] = value;
  }
  return out;
}

export async function saveSmsSettings(req: Request, input: StorefrontSmsSettingsInput): Promise<StorefrontSmsSettingsView> {
  if (!isSmsProvider(input.provider)) throw new ValidationError('سرویس پیامک شناخته نیست.', undefined, 'STOREFRONT_SMS_PROVIDER_INVALID');
  const newKey = String(input.apiKey ?? '').trim();
  const keyProblem = apiKeyError(newKey);
  if (keyProblem) throw new ValidationError(keyProblem, { field: 'apiKey' }, 'STOREFRONT_SMS_KEY_INVALID');
  if (!Number.isInteger(input.hourlyCap) || input.hourlyCap < 1 || input.hourlyCap > SMS_HOURLY_CAP_MAX) {
    throw new ValidationError(`سقف کد ورود در ساعت باید ۱ تا ${SMS_HOURLY_CAP_MAX.toLocaleString('fa-IR')} باشد.`, { field: 'hourlyCap' }, 'STOREFRONT_SMS_CAP_INVALID');
  }
  const orderCapInput = input.orderHourlyCap;
  if (orderCapInput !== undefined && (!Number.isInteger(orderCapInput) || orderCapInput < 1 || orderCapInput > SMS_HOURLY_CAP_MAX)) {
    throw new ValidationError(`سقف پیامک سفارش در ساعت باید ۱ تا ${SMS_HOURLY_CAP_MAX.toLocaleString('fa-IR')} باشد.`, { field: 'orderHourlyCap' }, 'STOREFRONT_SMS_CAP_INVALID');
  }
  const templates = checkedTemplates(input.provider, input.templates ?? {});
  // encrypted before the transaction: no secrets key = 503 and nothing written
  const sealedKey = newKey && !input.clearApiKey ? encryptSecret(newKey) : '';
  await orm.transaction(async (tx) => {
    const current = await lockVersion(tx, input.version);
    const stored = await readStored(tx);
    const before = runtimeOf(stored);
    const keyAfter = input.clearApiKey ? '' : sealedKey || stored[KEYS.apiKey] || '';
    // a key belongs to its provider: sending another provider's key would hand it to a third party
    if (input.provider !== before.provider && keyAfter && keyAfter === stored[KEYS.apiKey]) {
      throw new ValidationError('با عوض کردن سرویس پیامک، کلید سرویس تازه را هم وارد کنید (یا کلید ذخیره‌شده را پاک کنید).', { field: 'apiKey' }, 'STOREFRONT_SMS_KEY_FOR_OTHER_PROVIDER');
    }
    if (input.enabled && !keyAfter) {
      throw new ValidationError('برای روشن کردن پیامک، کلید سرویس پیامک را وارد کنید.', { field: 'apiKey' }, 'STOREFRONT_SMS_NEEDS_KEY');
    }
    if (input.enabled && keyAfter === stored[KEYS.apiKey] && before.apiKey === null) {
      throw new ValidationError('کلید ذخیره‌شدهٔ سرویس پیامک با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ کلید را دوباره وارد کنید.', { field: 'apiKey' }, 'STOREFRONT_SMS_KEY_UNREADABLE');
    }
    const enabled = input.enabled === true;
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (before.enabled !== enabled) changes.enabled = { before: before.enabled, after: enabled };
    if (before.provider !== input.provider) changes.provider = { before: before.provider, after: input.provider };
    if (JSON.stringify(before.templates) !== JSON.stringify(templates)) changes.templates = { before: before.templates, after: templates };
    if (before.hourlyCap !== input.hourlyCap) changes.hourlyCap = { before: before.hourlyCap, after: input.hourlyCap };
    const orderHourlyCap = orderCapInput ?? before.orderHourlyCap;
    if (before.orderHourlyCap !== orderHourlyCap) changes.orderHourlyCap = { before: before.orderHourlyCap, after: orderHourlyCap };
    const loginPaused = input.loginPaused ?? before.loginPaused;
    if (before.loginPaused !== loginPaused) changes.loginPaused = { before: before.loginPaused, after: loginPaused };
    const keyChanged = keyAfter !== (stored[KEYS.apiKey] ?? '');
    const hintAfter = !keyAfter ? '' : sealedKey ? newKey.slice(-4) : stored[KEYS.apiKeyHint] ?? '';
    // the key itself never enters the audit row: only that it changed and its last four letters
    if (keyChanged) changes.apiKey = { before: stored[KEYS.apiKeyHint] ? `…${stored[KEYS.apiKeyHint]}` : '', after: hintAfter ? `…${hintAfter}` : '' };
    if (Object.keys(changes).length === 0) return;
    await writeValue(tx, KEYS.enabled, enabled ? '1' : '0');
    await writeValue(tx, KEYS.provider, input.provider);
    await writeValue(tx, KEYS.templates, JSON.stringify(templates));
    await writeValue(tx, KEYS.hourlyCap, String(input.hourlyCap));
    await writeValue(tx, KEYS.orderHourlyCap, String(orderHourlyCap));
    await writeValue(tx, KEYS.loginPaused, loginPaused ? '1' : '0');
    if (keyChanged) {
      await writeValue(tx, KEYS.apiKey, keyAfter);
      await writeValue(tx, KEYS.apiKeyHint, hintAfter);
    }
    await writeValue(tx, KEYS.version, String(current + 1));
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'sms',
      description: 'تنظیمات پیامک سایت ذخیره شد', details: { changes },
    });
  });
  invalidateSettingsCache();
  return readSmsSettings(orm);
}
