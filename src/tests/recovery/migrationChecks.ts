import fs from 'fs';
import os from 'os';
import path from 'path';
import { pool } from '../../db/drizzle.js';
import { runMigrations, type MigrationResult } from '../../db/migrator.js';
import { setupTestSchema } from '../setup/testDb.js';
import { REPO_ROOT } from './scratchDatabase.js';

/**
 * حوزه K (v8.0.81، v8.0.82): مهاجرت‌گر روی پایگاه‌داده‌ای که پیش‌تر مهاجرت گرفته — همان وضعی که هر به‌روزرسانی
 * پروداکشن دارد. هر آزمون در اسکیمای ایزوله تازه با دفتر مهاجرت خودش اجرا می‌شود و پوشه مهاجرت‌ها رونوشتی از
 * `drizzle/` به‌اضافه یک مهاجرت آزمایشی است. مهاجرت‌گر پوشه را از `process.cwd()/drizzle` برمی‌دارد، پس آزمون
 * پوشه کاری را موقتاً به رونوشت می‌برد (روی کد پیش از v8.0.81 هم همین مسیر خوانده می‌شود).
 */

interface JournalEntry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }

function readJournal(folder: string): { entries: JournalEntry[] } & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));
}

/** رونوشت drizzle/ که دفترش فقط مهاجرت‌های 0000 تا `lastIdx` را دارد (سطح مهاجرت یک نسخه قدیمی) */
export function migrationsCopyUpTo(root: string, lastIdx: number): string {
  const dir = path.join(root, 'drizzle');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(REPO_ROOT, 'drizzle'), dir, { recursive: true });
  const journal = readJournal(dir);
  journal.entries = journal.entries.filter(e => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal, null, 2));
  return dir;
}

/** رونوشت drizzle/ با یک مهاجرت آزمایشی 0050 که `when` داده‌شده را دارد */
function migrationsCopyWithProbe(root: string, tag: string, sql: string, when: (last: number) => number): { dir: string; last: number } {
  const dir = path.join(root, 'drizzle');
  fs.cpSync(path.join(REPO_ROOT, 'drizzle'), dir, { recursive: true });
  const journal = readJournal(dir);
  const last = journal.entries[journal.entries.length - 1];
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: when(last.when), tag, breakpoints: true });
  fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal, null, 2));
  fs.writeFileSync(path.join(dir, `${tag}.sql`), sql);
  return { dir, last: last.when };
}

export async function runMigrationsIn(root: string): Promise<MigrationResult> {
  const previous = process.cwd();
  process.chdir(root);
  try {
    return await runMigrations();
  } finally {
    process.chdir(previous);
  }
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [`"${schema}".${table}`]);
  return Boolean(r.rows[0]?.ok);
}

/** TD-364: مهاجرت تازه با `when` کوچک‌تر از آخرین مهاجرت اجراشده بی‌صدا رد نمی‌شود */
export async function checkSkippedMigrationRefused(): Promise<string[]> {
  const v: string[] = [];
  const inner = await setupTestSchema();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-k-mig-'));
  try {
    const tag = `${String(readJournal(path.join(REPO_ROOT, 'drizzle')).entries.length).padStart(4, '0')}_k_skip_probe`;
    // ساعت امروز (مثل drizzle-kit generate) از `when` ساختگیِ آینده‌ی دفتر عقب است
    const { last } = migrationsCopyWithProbe(root, tag, 'CREATE TABLE k_skip_probe (id integer);', l => Math.min(Date.now(), l - 60_000));
    const skipped = await runMigrationsIn(root);
    if (skipped.success) v.push(`مهاجرت ${tag} با when کوچک‌تر از آخرین مهاجرت اجراشده بی‌صدا رد شد و اجرا «موفق» گزارش شد`);
    else if (!skipped.errors.join(' ').includes(tag)) v.push(`خطای مهاجرت نام ${tag} را نمی‌گوید: ${skipped.errors.join('; ')}`);
    if (await tableExists(inner.schema, 'k_skip_probe')) v.push('مهاجرت ردشده اجرا شد');

    // همان مهاجرت با when بزرگ‌تر از آخرین: عادی اجرا می‌شود
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root);
    migrationsCopyWithProbe(root, tag, 'CREATE TABLE k_skip_probe (id integer);', () => last + 3_600_000);
    const normal = await runMigrationsIn(root);
    if (!normal.success || !(await tableExists(inner.schema, 'k_skip_probe'))) v.push(`مهاجرت تازه با when بزرگ‌تر اجرا نشد: ${normal.errors.join('; ')}`);

    // پایگاه‌داده جلوتر از این نسخه (همان مهاجرت آزمایشی اجرا شده ولی در دفتر کد نیست): اجرا رد می‌شود
    const ahead = await runMigrations();
    if (ahead.success) v.push('پایگاه‌داده‌ای که مهاجرت تازه‌تر از این نسخه دارد بی‌هشدار پذیرفته شد');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    await inner.teardown();
  }
  return v;
}

/** TD-366: مهاجرت بی مهلت ۶۰ ثانیه‌ای درخواست‌ها اجرا می‌شود و دو اجرای هم‌زمان پشت هم می‌روند */
export async function checkMigrationSession(): Promise<string[]> {
  const v: string[] = [];
  const fresh = await setupTestSchema({ migrate: async () => ({ success: true, appliedCount: 0, errors: [] }) });
  try {
    const [a, b] = await Promise.all([runMigrations(), runMigrations()]);
    if (!a.success || !b.success) v.push(`دو اجرای هم‌زمان مهاجرت: یکی شکست خورد (${[...a.errors, ...b.errors].join('; ').slice(0, 200)})`);
    const rows = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${fresh.schema}".__drizzle_migrations`);
    const known = readJournal(path.join(REPO_ROOT, 'drizzle')).entries.length;
    if (rows.rows[0]?.n !== known) v.push(`دفتر مهاجرت پس از دو اجرای هم‌زمان ${rows.rows[0]?.n} ردیف دارد (انتظار ${known})`);
  } finally {
    await fresh.teardown();
  }

  const inner = await setupTestSchema();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-k-mig-'));
  try {
    const tag = `${String(readJournal(path.join(REPO_ROOT, 'drizzle')).entries.length).padStart(4, '0')}_k_session_probe`;
    migrationsCopyWithProbe(root, tag, `CREATE TABLE k_session_probe AS SELECT current_setting('statement_timeout') AS st;`, l => l + 3_600_000);
    const r = await runMigrationsIn(root);
    if (!r.success) {
      v.push(`مهاجرت آزمایشی اجرا نشد: ${r.errors.join('; ')}`);
    } else {
      const st = await pool.query<{ st: string }>(`SELECT st FROM "${inner.schema}".k_session_probe`);
      if (st.rows[0]?.st !== '0') v.push(`مهاجرت با مهلت دستور ${st.rows[0]?.st} اجرا شد (انتظار ۰ = بی‌مهلت)`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    await inner.teardown();
  }
  return v;
}

/**
 * TD-368 (v8.0.89): ارتقای سرور واقعی از v7.0.137 (مهاجرت‌ها تا 0044). سندی که 0044 تبدیل تاریخش را رد کرده (سال
 * مالی بسته) تاریخ جلالی‌اش را نگه می‌دارد و قید تاریخ سند NOT VALID می‌ماند؛ پر کردن source_cheque_id در 0047 همان
 * سطر را به‌روز می‌کرد، قید را می‌شکست و کل ارتقا برمی‌گشت.
 */
export async function checkUpgradeFromV70137(): Promise<string[]> {
  const v: string[] = [];
  const fresh = await setupTestSchema({ migrate: async () => ({ success: true, appliedCount: 0, errors: [] }) });
  const q = (text: string) => pool.query(text.replace(/\$S\./g, `"${fresh.schema}".`));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-k-mig-'));
  try {
    migrationsCopyUpTo(root, 43);
    const level43 = await runMigrationsIn(root);
    if (!level43.success) return [`مهاجرت تا 0043 انجام نشد: ${level43.errors.join('; ')}`];
    // سال ۱۴۰۲ بسته؛ سند ثبت چک و سند وصول آن با تاریخ جلالی قدیمی
    await q(`INSERT INTO $S.fiscal_periods (fiscal_year, status) VALUES (1402, 'closed')`);
    await q(`INSERT INTO $S.journal_vouchers (voucher_number, date, description) VALUES (990001, '1402/12/25', 'k registration')`);
    await q(`INSERT INTO $S.journal_vouchers (voucher_number, date, description, reference_module, reference_number) VALUES (990002, '1402/12/27', 'k cleared', 'cheque', 'K-123456')`);
    await q(`INSERT INTO $S.cheques (type, cheque_number, amount, bank_name, party_name, issue_date, due_date, voucher_id)
             VALUES ('received', 'K-123456', 1000, 'k', 'k', '2024-03-15', '2024-03-20', (SELECT id FROM $S.journal_vouchers WHERE voucher_number = 990001))`);
    migrationsCopyUpTo(root, 44);
    const level44 = await runMigrationsIn(root);
    const check = async () => (await q(`SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'chk_journal_vouchers_date_datefmt' AND conrelid = '$S.journal_vouchers'::regclass`)).rows[0] as { convalidated: boolean; def: string } | undefined;
    const before = await check();
    if (!level44.success || before?.convalidated !== false) return [`پیش‌شرط آزمون برقرار نشد: 0044 باید قید تاریخ سند را NOT VALID بگذارد (${level44.errors.join('; ')})`];

    // ارتقا به این نسخه: همه مهاجرت‌های بعد از 0044 در یک اجرا
    migrationsCopyUpTo(root, Number.MAX_SAFE_INTEGER);
    const upgrade = await runMigrationsIn(root);
    if (!upgrade.success) {
      v.push(`ارتقا از v7.0.137 شکست خورد: ${upgrade.errors.join('; ').slice(0, 300)}`);
      return v;
    }
    const rows = (await q(`SELECT voucher_number, date, source_cheque_id IS NOT NULL AS linked FROM $S.journal_vouchers WHERE voucher_number IN (990001, 990002) ORDER BY 1`)).rows as Array<{ date: string; linked: boolean }>;
    if (rows.length !== 2 || !rows.every(r => r.linked)) v.push('سندهای چک سال بسته به چک پیوند نخوردند');
    if (rows.map(r => r.date).join(',') !== '1402/12/25,1402/12/27') v.push(`تاریخ سندهای ردشده عوض شد: ${rows.map(r => r.date).join(',')}`);
    const after = await check();
    if (after?.convalidated !== false || after.def !== before.def) v.push('قید تاریخ سند پس از ارتقا همان قید NOT VALID قبلی نیست');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    await fresh.teardown();
  }
  return v;
}

/**
 * v9.0.396 (TD-589, B01-09): a migration that leaves a constraint or index out on unclean data says so with
 * `RAISE WARNING '... SKIPPED'`; the migrator now returns that notice in `warnings` and logs it. On v9.0.395 it listened
 * to no notice and answered `success: true, warnings: []`. An ordinary notice (an object created) stays out of `warnings`.
 */
export async function checkMigrationNoticesReported(): Promise<string[]> {
  const v: string[] = [];
  const inner = await setupTestSchema();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-k-mig-'));
  const skipped = 'TD-589 probe: 2 orphan probe rows - FK SKIPPED';
  const leftOut = 'TD-589 probe: unique index not created';
  const created = 'TD-589 probe: FK created';
  try {
    const tag = `${String(readJournal(path.join(REPO_ROOT, 'drizzle')).entries.length).padStart(4, '0')}_k_notice_probe`;
    migrationsCopyWithProbe(root, tag, `DO $$ BEGIN
  RAISE WARNING '${skipped}';
  RAISE NOTICE '${leftOut}';
  RAISE NOTICE '${created}';
END $$;`, l => l + 3_600_000);
    const r = await runMigrationsIn(root);
    if (!r.success) {
      v.push(`the probe migration failed: ${r.errors.join('; ')}`);
    } else {
      const warnings = r.warnings ?? [];
      if (!warnings.includes(skipped)) v.push(`the migrator did not return the SKIPPED warning (warnings: ${JSON.stringify(warnings)})`);
      if (!warnings.includes(leftOut)) v.push(`the migrator did not return the "not created" notice (warnings: ${JSON.stringify(warnings)})`);
      if (warnings.includes(created)) v.push('the migrator returned an ordinary notice as a warning');
    }
    const again = await runMigrationsIn(root);
    if (!again.success) v.push(`a later run without new migrations failed: ${again.errors.join('; ')}`);
    if ((again.warnings ?? []).some(w => w.startsWith('TD-589 probe'))) v.push('a later run without new migrations returned the old warnings again');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    await inner.teardown();
  }
  return v;
}
