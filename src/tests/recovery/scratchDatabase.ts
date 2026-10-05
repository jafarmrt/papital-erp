import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pkg from 'pg';

/**
 * v8.0.81 به بعد (حوزه K): ابزار آزمون‌های پشتیبان، بازیابی و مهاجرت. این آزمون‌ها اسکریپت‌های واقعی
 * (`scripts/backup.sh`، `scripts/restore.sh`، `update.sh`) را روی پایگاه‌داده‌های جدا اجرا می‌کنند، چون پشتیبان کل
 * پایگاه‌داده را می‌گیرد و بازیابی پایگاه‌داده تازه می‌سازد. نام همه پایگاه‌داده‌ها و نقش‌ها با `erp_k_` شروع می‌شود
 * و در پایان حذف می‌شوند.
 */

export const REPO_ROOT = process.cwd();

export interface ScriptResult {
  code: number;
  output: string;
}

/** اجرای ناهم‌زمان یک فرمان (حلقه رویداد آزاد می‌ماند تا سرور HTTP آزمون پاسخ دهد) */
export function runCommand(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<ScriptResult> {
  return new Promise(resolve => {
    execFile(file, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      timeout: options.timeoutMs ?? 300_000,
      maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, output: `${stdout}${stderr}` });
    });
  });
}

/** محیط فرمان بدون متغیرهای پایگاه‌داده برنامه (اسکریپت‌ها باید خودشان از .env بخوانند) */
export function scriptEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['DATABASE_URL', 'ATTACHMENTS_DIR', 'UPLOADS_DIR', 'APP_DIR', 'BACKUP_DIR', 'RESTORE_ADMIN_URL', 'RESTORE_MODE', 'RESTORE_CONFIRM', 'RESTORE_KEEP', 'PGPASSWORD']) {
    delete env[key];
  }
  return { ...env, ...extra };
}

export function databaseUrlParts(url: string): { user: string; password: string; host: string; port: string; database: string } {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.replace(/^\//, ''),
  };
}

export function urlFor(user: string, password: string, database: string): string {
  const base = databaseUrlParts(process.env.DATABASE_URL ?? '');
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${base.host}:${base.port}/${database}`;
}

/** اتصال مدیر (همان کاربر DATABASE_URL آزمون‌ها، که در CI و هوک شروع جلسه ابرکاربر است) روی پایگاه‌داده postgres */
export function adminUrl(): string {
  const base = databaseUrlParts(process.env.DATABASE_URL ?? '');
  return urlFor(base.user, base.password, 'postgres');
}

export async function querySql<T extends pkg.QueryResultRow = pkg.QueryResultRow>(url: string, text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pkg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

export interface ScratchCluster {
  role: string;
  password: string;
  /** پایگاه‌داده منبع (مالک: نقش بالا، مثل نقشی که install.sh می‌سازد: LOGIN بی CREATEDB) */
  database: string;
  appUrl: string;
  tmpDir: string;
  /** پایگاه‌داده‌هایی که آزمون ساخته و در پایان حذف می‌شوند */
  created: string[];
  teardown: () => Promise<void>;
}

/** نقش و پایگاه‌داده‌ای مثل نصب واقعی: نقش LOGIN بی CREATEDB، مالک پایگاه‌داده */
export async function createScratchCluster(label: string): Promise<ScratchCluster> {
  const suffix = `${label}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const role = `erp_k_role_${suffix}`;
  const password = `pw_${suffix}`;
  const database = `erp_k_db_${suffix}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-k-'));
  const created: string[] = [database];
  await querySql(adminUrl(), `CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
  await querySql(adminUrl(), `CREATE DATABASE "${database}" OWNER "${role}"`);
  const teardown = async (): Promise<void> => {
    const dbs = await querySql<{ datname: string }>(adminUrl(), `SELECT datname FROM pg_database WHERE datname LIKE $1 OR datname = ANY($2::text[])`, [`${database}%`, created]);
    for (const { datname } of dbs) {
      await querySql(adminUrl(), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [datname]).catch(() => undefined);
      await querySql(adminUrl(), `DROP DATABASE IF EXISTS "${datname}"`).catch(() => undefined);
    }
    const drills = await querySql<{ datname: string }>(adminUrl(), `SELECT d.datname FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE r.rolname = $1`, [role]);
    for (const { datname } of drills) await querySql(adminUrl(), `DROP DATABASE IF EXISTS "${datname}"`).catch(() => undefined);
    await querySql(adminUrl(), `DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
  return { role, password, database, appUrl: urlFor(role, password, database), tmpDir, created, teardown };
}

/** ابزارهای کلاینت PostgreSQL که اسکریپت‌ها لازم دارند؛ خطای روشن اگر نصب نیستند */
export async function clientToolsMissing(): Promise<string | null> {
  for (const tool of ['psql', 'pg_dump', 'pg_restore']) {
    const r = await runCommand(tool, ['--version']);
    if (r.code !== 0) return `ابزار ${tool} نصب نیست (PostgreSQL client 16+ لازم است)`;
  }
  return null;
}

/** پوشه برنامه آزمایشی: اسکریپت‌های واقعی مخزن، بی .env و بی پوشه بارگذاری‌ها (هر آزمون خودش می‌سازد) */
export function makeAppDir(root: string): string {
  const appDir = path.join(root, 'app');
  for (const rel of ['scripts/backup.sh', 'scripts/restore.sh', 'scripts/sql/backup-manifest.sql', 'drizzle/meta/_journal.json']) {
    const from = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(appDir, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(appDir, rel));
  }
  return appDir;
}
