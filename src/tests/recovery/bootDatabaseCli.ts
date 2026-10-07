import '../../lib/processTimezone.js';
import 'dotenv/config';
import { pool } from '../../db/drizzle.js';
import { prepareDatabaseAtBoot } from '../../services/system/bootData.js';

/**
 * بسته ۲ (v9.0.133 به بعد، TD-591 / TD-526): کارهای داده‌ای بوت سرور (`prepareDatabaseAtBoot`) روی پایگاه‌داده‌ای که
 * DATABASE_URL می‌گوید، در فرایند جدا (استخر برنامه تک‌نمونه است). آزمون‌های نصب تازه آن را روی پایگاه‌داده خالی اجرا
 * می‌کنند و NODE_ENV را خودشان می‌دهند.
 *   DATABASE_URL=... NODE_ENV=production npx tsx src/tests/recovery/bootDatabaseCli.ts
 */
prepareDatabaseAtBoot()
  .then(async () => {
    console.log('BOOT DATA OK');
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('BOOT DATA FAILED', err);
    await pool.end().catch(() => undefined);
    process.exit(2);
  });
