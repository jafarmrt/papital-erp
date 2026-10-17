import { inArray, notLike } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, eventActionRules, personnel, users, webhookSubscriptions } from '../../db/schema.js';
import { decryptSecret, isEncryptedSecret, isSecretsKeyConfigured } from '../../lib/secretBox.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';
import type { HealthCheckTestResult } from '../../types/accounting.types.js';
import { isBcryptHash } from '../auth/loginSecurity.service.js';
import { ENCRYPTED_SETTING_KEYS } from '../settings/settingSecrets.js';
import { PLAIN_PASSWORD_LOCK_MARKER } from '../users/plainPasswordLock.js';

/**
 * v10.1.44 (OBS-PR-09): the two one-off upgrade commands (`npm run secrets:encrypt -- --apply` and
 * `npm run users:lock-plain-passwords -- --apply`) show up in the financial health check until they have run.
 * Read only, without row locks; only counts and record kinds are reported, never a value.
 */
export interface SecretsAtRestCounts {
  /** third-party secrets still stored as plain text, per place */
  plaintext: { personnel: number; settings: number; webhooks: number };
  /** stored secrets the current key cannot open */
  unreadable: number;
  /** users (deleted ones too) whose stored password is not a bcrypt hash and is not locked yet */
  nonBcryptPasswords: number;
  /** whether ERP_SECRETS_KEY is set on this server (missing = treated as set, for older callers) */
  keyConfigured?: boolean;
}

function tally(value: unknown, counts: { plain: number; unreadable: number }): void {
  const v = String(value ?? '');
  if (v === '') return;
  if (isEncryptedSecret(v)) {
    if (decryptSecret(v) === null) counts.unreadable++;
    return;
  }
  counts.plain++;
}

export async function countSecretsAtRest(): Promise<SecretsAtRestCounts> {
  const personnelRows = await orm.select({ value: personnel.nobitexPassword }).from(personnel);
  const settingRows = await orm.select({ value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, [...ENCRYPTED_SETTING_KEYS]));
  const webhookRows = await orm.select({ secretKey: webhookSubscriptions.secretKey, customHeaders: webhookSubscriptions.customHeaders }).from(webhookSubscriptions);
  const ruleRows = await orm.select({ config: eventActionRules.actionConfigJson }).from(eventActionRules);
  const passwordRows = await orm.select({ password: users.password }).from(users)
    .where(notLike(users.password, startsWithLikePattern(PLAIN_PASSWORD_LOCK_MARKER)));

  const p = { plain: 0, unreadable: 0 };
  personnelRows.forEach(r => tally(r.value, p));
  const s = { plain: 0, unreadable: 0 };
  settingRows.forEach(r => tally(r.value, s));
  const w = { plain: 0, unreadable: 0 };
  for (const row of webhookRows) {
    tally(row.secretKey, w);
    const headers = row.customHeaders && typeof row.customHeaders === 'object' && !Array.isArray(row.customHeaders)
      ? Object.values(row.customHeaders as Record<string, unknown>) : [];
    headers.forEach(h => tally(h, w));
  }
  // OBS-PR-07 (ت۴۰): an action rule's webhook token and header values count with the webhooks
  for (const { config } of ruleRows) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
    const { secretToken, headers } = config as { secretToken?: unknown; headers?: unknown };
    if (typeof secretToken === 'string') tally(secretToken, w);
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) Object.values(headers as Record<string, unknown>).forEach(h => tally(h, w));
  }
  return {
    plaintext: { personnel: p.plain, settings: s.plain, webhooks: w.plain },
    unreadable: p.unreadable + s.unreadable + w.unreadable,
    nonBcryptPasswords: passwordRows.filter(r => !isBcryptHash(r.password)).length,
    keyConfigured: isSecretsKeyConfigured(),
  };
}

const fa = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export function buildSecretsAtRestHealthTest(counts: SecretsAtRestCounts): HealthCheckTestResult {
  const plain = counts.plaintext.personnel + counts.plaintext.settings + counts.plaintext.webhooks;
  const stored = plain + counts.nonBcryptPasswords + counts.unreadable;
  const items: HealthCheckTestResult['items'] = [];
  // OBS-PR-07 (ت۴۰): without ERP_SECRETS_KEY the encryption command cannot run and a webhook rule holding a token or
  // headers is refused on save, so the key comes first
  const noKey = counts.keyConfigured === false;
  // v10.1.67 (TD-1286): a missing key is a warning of its own, also on a server with no stored secret yet, since every
  // new WooCommerce key, messenger bot token or webhook key is refused until it is set
  const problems = stored + (noKey ? 1 : 0);
  const setKeyFirst = 'نخست کلید ERP_SECRETS_KEY را در فایل .env کارساز بگذارید و سرویس را دوباره راه بیندازید؛ ';
  if (noKey) {
    items.push({
      id: 'secrets_key_missing',
      title: 'کلید رمزنگاری ERP_SECRETS_KEY روی کارساز تعریف نشده است',
      subtitle: 'ذخیره کلید ووکامرس، نشانه ربات پیام‌رسان و کلید وب‌هوک رد می‌شود',
      details: 'روی کارساز در پوشه برنامه «bash scripts/ensure-env-secrets.sh .env» را اجرا کنید، سرویس را دوباره راه بیندازید و کلید تازه را جایی امن بیرون از کارساز نگه دارید. اگر رمزها پیش‌تر با کلیدی دیگر رمزنگاری شده‌اند، همان کلید پیشین را برگردانید.',
    });
  }
  if (plain > 0) {
    items.push({
      id: 'plaintext_secrets',
      title: 'رمز سامانه‌های بیرونی به‌صورت متن ساده',
      subtitle: `پرسنل ${fa(counts.plaintext.personnel)}، تنظیمات ${fa(counts.plaintext.settings)}، وب‌هوک ${fa(counts.plaintext.webhooks)}`,
      details: `${noKey ? setKeyFirst + 'سپس ' : ''}روی کارساز یک بار «npm run secrets:encrypt -- --apply» را اجرا کنید.`,
    });
  }
  if (counts.nonBcryptPasswords > 0) {
    items.push({
      id: 'non_bcrypt_passwords',
      title: 'گذرواژه کاربر بی درهم‌سازی امن',
      subtitle: `${fa(counts.nonBcryptPasswords)} کاربر`,
      details: 'روی کارساز یک بار «npm run users:lock-plain-passwords -- --apply» را اجرا کنید و سپس به این کاربران رمز موقت تازه بدهید.',
    });
  }
  if (counts.unreadable > 0) {
    items.push({
      id: 'unreadable_secrets',
      title: 'رمز ذخیره‌شده‌ای که با کلید فعلی باز نمی‌شود',
      subtitle: `${fa(counts.unreadable)} مقدار`,
      details: noKey
        ? 'کلید ERP_SECRETS_KEY روی کارساز تعریف نشده است؛ همان کلید پیشین را در فایل .env بگذارید یا این رمزها را دوباره وارد کنید.'
        : 'کلید ERP_SECRETS_KEY عوض شده است؛ کلید پیشین را برگردانید یا این رمزها را دوباره وارد کنید.',
    });
  }
  return {
    id: 'secrets_at_rest',
    category: 'system',
    title: 'رمزها و گذرواژه‌های ذخیره‌شده',
    description: 'رمز سامانه‌های بیرونی باید رمزنگاری‌شده و گذرواژه کاربران درهم‌سازی‌شده ذخیره شوند. پس از ارتقا از نسخه‌های قدیمی، دو فرمان یک‌باره این کار را می‌کنند؛ این بررسی نشان می‌دهد که آیا اجرا شده‌اند.',
    status: problems > 0 ? 'warning' : 'healthy',
    scoreImpact: problems > 0 ? -3 : 0,
    count: problems,
    message: stored > 0
      ? `${fa(stored)} رمز یا گذرواژه به شکل امن ذخیره نشده است.${noKey ? ' کلید ERP_SECRETS_KEY هم تعریف نشده است.' : ''}`
      : noKey
        ? 'کلید ERP_SECRETS_KEY روی کارساز تعریف نشده است.'
        : 'همه رمزها رمزنگاری‌شده و همه گذرواژه‌ها درهم‌سازی‌شده‌اند.',
    items,
    metrics: {
      plaintextSecrets: plain, nonBcryptPasswords: counts.nonBcryptPasswords, unreadableSecrets: counts.unreadable,
      secretsKeyMissing: noKey ? 1 : 0,
    },
  };
}
