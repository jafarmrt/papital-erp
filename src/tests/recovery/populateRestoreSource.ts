import '../../lib/processTimezone.js';
import 'dotenv/config';
import { runMigrations } from '../../db/migrator.js';
import { pool } from '../../db/drizzle.js';
import { bootstrapTestMasterData } from '../setup/testBootstrap.js';
import { runBusinessYearSimulation } from '../simulation/businessYearSimulator.js';

/**
 * حوزه K: پایگاه‌داده منبع آزمون‌های پشتیبان و بازیابی، با همان چیدمان پروداکشن (اسکیمای public، دفتر مهاجرت
 * drizzle) و داده واقعی کسب‌وکار از شبیه‌ساز یک سال کاری. در فرایند جدا با DATABASE_URL همان پایگاه‌داده اجرا
 * می‌شود (استخر برنامه تک‌نمونه است). دو رکورد پیوست هم می‌سازد تا پشتیبان فایل‌های پیوست را هم بسنجد.
 *   DATABASE_URL=... npx tsx src/tests/recovery/populateRestoreSource.ts
 */
async function main(): Promise<void> {
  const migration = await runMigrations();
  if (!migration.success) throw new Error(`migrations failed: ${migration.errors.join('; ')}`);
  await bootstrapTestMasterData();
  const sim = await runBusinessYearSimulation({ seed: 11, steps: Number(process.env.K_SIM_STEPS ?? 60), checkEvery: 1000 });
  await pool.query(
    `INSERT INTO file_attachments (id, entity_type, entity_id, storage_path, original_name, mime_type, size_bytes, sha256)
     VALUES ('00000000-0000-4000-8000-0000000000a1', 'document', 1, 'k-a1.pdf', 'a1.pdf', 'application/pdf', 4, 'k1'),
            ('00000000-0000-4000-8000-0000000000a2', 'document', 2, 'k-a2.pdf', 'a2.pdf', 'application/pdf', 4, 'k2')`
  );
  console.log(`POPULATED ok=${sim.counts.ok} rejected=${sim.counts.rejected}`);
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (err: unknown) => {
    console.error('POPULATE FAILED', err);
    await pool.end().catch(() => undefined);
    process.exit(2);
  });
