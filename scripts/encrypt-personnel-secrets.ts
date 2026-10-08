import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { PersonnelSecretEncryptionService } from '../src/services/system/personnelSecretEncryption.service.js';
import { IntegrationSecretEncryptionService } from '../src/services/system/integrationSecretEncryption.service.js';

/**
 * v7.0.139 (TD-189): رمزنگاری رمزهای نوبیتکس پرسنل که هنوز متن ساده ذخیره شده‌اند.
 * v9.0.361 (TD-898، تصمیم ت۷ الف): همچنین کلید و رمز ووکامرس، کلید امضای وب‌هوک ووکامرس، و کلید امضا و سرآیندهای اشتراک‌های وب‌هوک.
 * خروجی پایانه انگلیسی است (قاعده t9).
 *   npm run secrets:encrypt             ← اجرای آزمایشی: فقط شمارش، بدون تغییر
 *   npm run secrets:encrypt -- --apply  ← رمزنگاری واقعی (نیازمند ERP_SECRETS_KEY)
 */
interface Counts { plaintext: number; encrypted: number; locked: number; encryptedNow: number }

function printCounts(label: string, r: Counts, apply: boolean): void {
  console.log(`   ${label}: plain text ${r.plaintext}${apply ? `, encrypted in this run ${r.encryptedNow}` : ''}, already encrypted ${r.encrypted}`);
  if (r.locked > 0) {
    console.log(`   ⚠️ ${label}: ${r.locked} encrypted value(s) cannot be decrypted with the current key (the key was changed or lost)`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const personnel = await PersonnelSecretEncryptionService.run({ apply });
  const integrations = await IntegrationSecretEncryptionService.run({ apply });
  console.log(apply ? '🔐 Encrypting stored secrets' : '🔎 Dry run (nothing changed). To encrypt: npm run secrets:encrypt -- --apply');
  console.log(`   ERP_SECRETS_KEY: ${personnel.keyConfigured ? 'set' : '❌ not set'}`);
  printCounts('Personnel Nobitex passwords', personnel, apply);
  printCounts('WooCommerce keys and webhook secrets', integrations, apply);
}

main()
  .catch((err) => {
    const code = (err as { code?: string } | null)?.code;
    console.error(code === 'SECRETS_KEY_MISSING'
      ? '❌ ERP_SECRETS_KEY is not set (at least 32 characters); nothing was encrypted'
      : `❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
