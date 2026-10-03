import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { PersonnelSecretEncryptionService } from '../src/services/system/personnelSecretEncryption.service.js';

/**
 * v7.0.139 (TD-189): رمزنگاری رمزهای نوبیتکس پرسنل که هنوز متن ساده ذخیره شده‌اند.
 *   npm run secrets:encrypt             ← اجرای آزمایشی: فقط شمارش، بدون تغییر
 *   npm run secrets:encrypt -- --apply  ← رمزنگاری واقعی (نیازمند ERP_SECRETS_KEY)
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const r = await PersonnelSecretEncryptionService.run({ apply });
  console.log(apply ? '🔐 رمزنگاری رمزهای نوبیتکس پرسنل' : '🔎 اجرای آزمایشی (بدون تغییر) — برای رمزنگاری واقعی: npm run secrets:encrypt -- --apply');
  console.log(`   کلید ERP_SECRETS_KEY: ${r.keyConfigured ? 'تنظیم شده' : '❌ تنظیم نشده'}`);
  console.log(`   رمز متن ساده: ${r.plaintext}${apply ? `، رمزنگاری‌شده در این اجرا: ${r.encryptedNow}` : ''}`);
  console.log(`   رمز رمزنگاری‌شده: ${r.encrypted}`);
  if (r.locked > 0) {
    console.log(`   ⚠️ رمز رمزنگاری‌شده‌ای که با کلید فعلی باز نمی‌شود: ${r.locked} (کلید عوض شده یا گم شده است)`);
  }
}

main()
  .catch((err) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
