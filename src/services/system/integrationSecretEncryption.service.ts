import { eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, eventActionRules, webhookSubscriptions } from '../../db/schema.js';
import { decryptSecret, encryptSecret, isEncryptedSecret, isSecretsKeyConfigured } from '../../lib/secretBox.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { ENCRYPTED_SETTING_KEYS } from '../settings/settingSecrets.js';

/**
 * v9.0.361 (TD-898، تصمیم ت۷ الف): رمزنگاری کلیدهای یکپارچگی که پیش از این نسخه متن ساده ذخیره شده‌اند: کلید و رمز ووکامرس و
 * کلید امضای وب‌هوک ووکامرس در `app_settings`، و کلید امضا و مقدار هر سرآیند سفارشی اشتراک‌های وب‌هوک. همان قاعده رمزهای
 * پرسنل (TD-189): اجرای آزمایشی فقط می‌شمارد؛ با apply هر مقدار ساده رمز می‌شود، زیر قفل ردیف و در یک تراکنش برای هر ردیف.
 * مقدار رمزشده‌ای که با کلید فعلی باز نمی‌شود («قفل») شمرده می‌شود و دست نمی‌خورد. از v10.1.59 (OBS-PR-07، ت۴۰) توکن و
 * مقدار سرآیندهای قانون‌های خودکار وب‌هوک هم.
 */
export interface IntegrationSecretReport {
  keyConfigured: boolean;
  plaintext: number;
  encrypted: number;
  locked: number;
  encryptedNow: number;
}

type Tally = Omit<IntegrationSecretReport, 'keyConfigured' | 'encryptedNow'>;

function tallyValue(value: string, tally: Tally): boolean {
  if (value === '') return false;
  if (isEncryptedSecret(value)) {
    if (decryptSecret(value) === null) tally.locked++;
    else tally.encrypted++;
    return false;
  }
  tally.plaintext++;
  return true;
}

export class IntegrationSecretEncryptionService {
  static async run(options: { apply: boolean }): Promise<IntegrationSecretReport> {
    const report: IntegrationSecretReport = { keyConfigured: isSecretsKeyConfigured(), plaintext: 0, encrypted: 0, locked: 0, encryptedNow: 0 };

    const settingRows = await orm.select().from(appSettings).where(inArray(appSettings.key, [...ENCRYPTED_SETTING_KEYS]));
    for (const row of settingRows) {
      if (!tallyValue(row.value, report) || !options.apply) continue;
      await orm.transaction(async (tx) => {
        const [locked] = await tx.select().from(appSettings).where(eq(appSettings.key, row.key)).for('update');
        if (!locked || locked.value === '' || isEncryptedSecret(locked.value)) return;
        await tx.update(appSettings).set({ value: encryptSecret(locked.value) }).where(eq(appSettings.key, row.key));
        report.encryptedNow++;
      });
    }
    if (options.apply && report.encryptedNow > 0) invalidateSettingsCache();

    const subRows = await orm.select({ id: webhookSubscriptions.id }).from(webhookSubscriptions);
    for (const { id } of subRows) {
      await orm.transaction(async (tx) => {
        const [sub] = await tx.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).for('update');
        if (!sub) return;
        let changed = 0;
        const keyIsPlain = tallyValue(sub.secretKey, report);
        const secretKey = keyIsPlain && options.apply ? encryptSecret(sub.secretKey) : sub.secretKey;
        if (secretKey !== sub.secretKey) changed++;
        const stored = (sub.customHeaders && typeof sub.customHeaders === 'object' && !Array.isArray(sub.customHeaders))
          ? sub.customHeaders as Record<string, unknown> : {};
        const customHeaders: Record<string, string> = {};
        for (const [name, raw] of Object.entries(stored)) {
          const value = String(raw ?? '');
          const isPlain = tallyValue(value, report);
          customHeaders[name] = isPlain && options.apply ? encryptSecret(value) : value;
          if (customHeaders[name] !== value) changed++;
        }
        if (!options.apply || changed === 0) return;
        await tx.update(webhookSubscriptions).set({ secretKey, customHeaders }).where(eq(webhookSubscriptions.id, id));
        report.encryptedNow += changed;
      });
    }

    // OBS-PR-07 (ت۴۰): an action rule's webhook token and header values
    const ruleRows = await orm.select({ id: eventActionRules.id }).from(eventActionRules);
    for (const { id } of ruleRows) {
      await orm.transaction(async (tx) => {
        const [rule] = await tx.select().from(eventActionRules).where(eq(eventActionRules.id, id)).for('update');
        const config = rule?.actionConfigJson;
        if (!config || typeof config !== 'object' || Array.isArray(config)) return;
        const next: Record<string, unknown> = { ...(config as Record<string, unknown>) };
        let changed = 0;
        if (typeof next.secretToken === 'string' && tallyValue(next.secretToken, report) && options.apply) {
          next.secretToken = encryptSecret(next.secretToken);
          changed++;
        }
        const headers = next.headers && typeof next.headers === 'object' && !Array.isArray(next.headers) ? next.headers as Record<string, unknown> : null;
        if (headers) {
          const sealed: Record<string, string> = {};
          for (const [name, raw] of Object.entries(headers)) {
            const value = String(raw ?? '');
            const isPlain = tallyValue(value, report);
            sealed[name] = isPlain && options.apply ? encryptSecret(value) : value;
            if (sealed[name] !== value) changed++;
          }
          next.headers = sealed;
        }
        if (!options.apply || changed === 0) return;
        await tx.update(eventActionRules).set({ actionConfigJson: next }).where(eq(eventActionRules.id, id));
        report.encryptedNow += changed;
      });
    }
    return report;
  }
}
