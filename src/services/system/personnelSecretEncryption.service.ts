import { eq, and, ne, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { encryptSecret, isEncryptedSecret, isSecretsKeyConfigured, decryptSecret } from '../../lib/secretBox.js';

/**
 * v7.0.139 (TD-189): رمزنگاری رمزهای نوبیتکس قدیمی که متن ساده ذخیره شده‌اند (ثبت‌های تازه از v7.0.139 رمزشده‌اند).
 * اجرای آزمایشی پیش‌فرض است و فقط می‌شمارد؛ با apply هر ردیف متن ساده رمزنگاری می‌شود. رمز رمزشده‌ای که با کلید فعلی
 * باز نمی‌شود («قفل») شمرده می‌شود و دست نمی‌خورد. پرسنل حذف‌شده هم رمزنگاری می‌شوند.
 */
export interface PersonnelSecretReport {
  keyConfigured: boolean;
  plaintext: number;
  encrypted: number;
  locked: number;
  encryptedNow: number;
}

export class PersonnelSecretEncryptionService {
  static async run(options: { apply: boolean }): Promise<PersonnelSecretReport> {
    const rows = await orm.select({ id: personnel.id, value: personnel.nobitexPassword })
      .from(personnel)
      .where(and(sql`${personnel.nobitexPassword} IS NOT NULL`, ne(personnel.nobitexPassword, '')));
    const keyConfigured = isSecretsKeyConfigured();
    const report: PersonnelSecretReport = { keyConfigured, plaintext: 0, encrypted: 0, locked: 0, encryptedNow: 0 };
    for (const row of rows) {
      const value = row.value || '';
      if (isEncryptedSecret(value)) {
        if (decryptSecret(value) === null) report.locked++;
        else report.encrypted++;
        continue;
      }
      report.plaintext++;
      if (options.apply) {
        // encryptSecret بدون کلید خطا می‌دهد؛ پس هیچ ردیفی بدون کلید تغییر نمی‌کند
        await orm.update(personnel).set({ nobitexPassword: encryptSecret(value) })
          .where(and(eq(personnel.id, row.id), eq(personnel.nobitexPassword, value)));
        report.encryptedNow++;
      }
    }
    return report;
  }
}
