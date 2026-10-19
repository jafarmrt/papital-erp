import type { Request } from 'express';
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { orm, pool } from '../../db/drizzle.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { getImageUploadsDir } from '../../lib/storage.js';
import {
  isHoldOver, ORPHAN_UPLOAD_CHUNK, ORPHAN_UPLOAD_DAY_PATTERN, ORPHAN_UPLOAD_LISTED_FAILURES, ORPHAN_UPLOAD_MIN_AGE_MINUTES,
  ORPHAN_UPLOAD_NAME_PATTERN, ORPHAN_UPLOAD_QUARANTINE_DIR, ORPHAN_UPLOAD_RUN_LIMIT, UPLOAD_UUID_PATTERN_SOURCE,
  uploadUuidOf, type OrphanUploadsReport,
} from '../../lib/system/orphanUploads.js';
import { logger } from '../../middleware/logger.js';

/**
 * v10.2.18 (OBS-R2-60, 10.2 package 13): image files of `public/uploads` that no row names (contract and rules in
 * `src/lib/system/orphanUploads.ts`). Only the files the image fields write are candidates, top level only (never
 * `.attachments`, the media library or a public asset folder). A file is named when its UUID appears anywhere in a row of
 * any base table of the current schema (the whole row read as text: a soft-deleted or copied record, a draft, a queued
 * event or an encoded address keeps its image). Only the audit log is not read, since its snapshots name every replaced
 * image. Not read either: tables of other schemas and binary (bytea) values, whose text is hex; the image fields never
 * write there. The folders are listed before the rows are read, so a file saved meanwhile is either named or too young.
 * A run (POST /api/system/orphan-uploads, system admin, by hand only, one at a time) acts only on the files of the
 * preview the admin confirmed, re-reads the rows for those files just before it moves or removes them, never deletes a
 * file outright: it moves it to `.orphaned/<day>/`, removes it only after the hold, and on a later run moves back one a
 * row names again. Each chunk of names writes its audit row inside the lock. The rows are read once per table with the
 * one UUID pattern and kept only for the UUIDs of the files at hand, so a table full of other UUIDs (outbox, sessions)
 * costs one pass and no memory (about 4 s for 500,000 rows, measured on PostgreSQL 16).
 */

export const ORPHAN_UPLOAD_AUDIT_ENTITY = 'تصویرهای بارگذاری‌شده';

/** Not read for references: before / after snapshots of records, which name every image ever replaced */
const UNREAD_TABLES = new Set(['activity_logs']);
/** A cheap filter before the pattern: a UUID's first two groups */
const UUID_PREFIX_FILTER = '[0-9a-f]{8}-[0-9a-f]{4}-';

interface UploadFile { name: string; uuid: string; absolute: string; size: number; mtimeMs: number; day?: string; }
type Operation = 'quarantine' | 'purge' | 'restore';

async function imageFilesIn(dir: string, day?: string): Promise<UploadFile[]> {
  const files: UploadFile[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !ORPHAN_UPLOAD_NAME_PATTERN.test(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const stat = await fs.promises.lstat(absolute);
    if (!stat.isFile()) continue;
    files.push({ name: entry.name, uuid: uploadUuidOf(entry.name), absolute, size: stat.size, mtimeMs: stat.mtimeMs, day });
  }
  return files;
}

/** The quarantine folder, refused when it is not a real folder (a link would move files elsewhere) */
async function quarantineRoot(uploadsDir: string): Promise<string> {
  const root = path.join(uploadsDir, ORPHAN_UPLOAD_QUARANTINE_DIR);
  const stat = await fs.promises.lstat(root).catch(() => null);
  if (stat && !stat.isDirectory()) {
    throw new ValidationError('پوشهٔ جدای تصویرهای بی‌صاحب پوشهٔ واقعی نیست؛ پیش از ادامه آن را بررسی کنید.', undefined, 'ORPHAN_UPLOADS_QUARANTINE_INVALID');
  }
  return root;
}

/** A day folder of the quarantine, made when missing and refused when it is not a real folder inside the uploads folder */
async function dayFolder(uploadsDir: string, root: string, day: string): Promise<string> {
  const dir = path.join(root, day);
  await fs.promises.mkdir(dir, { recursive: true });
  const stat = await fs.promises.lstat(dir);
  const [realDir, realUploads] = await Promise.all([fs.promises.realpath(dir), fs.promises.realpath(uploadsDir)]);
  if (!stat.isDirectory() || !realDir.startsWith(`${realUploads}${path.sep}`)) {
    throw new ValidationError('پوشهٔ روز در پوشهٔ جدای تصویرهای بی‌صاحب پوشهٔ واقعی نیست؛ پیش از ادامه آن را بررسی کنید.', undefined, 'ORPHAN_UPLOADS_QUARANTINE_INVALID');
  }
  return dir;
}

/** The held files; a day folder that is a link is never read (`Dirent.isDirectory` is false for a link) */
async function heldFiles(root: string): Promise<UploadFile[]> {
  const days = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: UploadFile[] = [];
  for (const d of days) {
    if (d.isDirectory() && ORPHAN_UPLOAD_DAY_PATTERN.test(d.name)) files.push(...await imageFilesIn(path.join(root, d.name), d.name));
  }
  return files;
}

/** Which of `candidates` (lower-cased UUIDs) any row of the scanned tables names, read in one snapshot; each table once */
async function uuidsInRows(candidates: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (candidates.length === 0) return found;
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '5min'`);
    // every base table: a uuid column is read as text too
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
        ORDER BY table_name`);
    for (const { table_name: table } of tables.rows) {
      if (UNREAD_TABLES.has(table)) continue;
      const rows = await client.query<{ value: string }>(
        `SELECT DISTINCT lower(m[1]) AS value
           FROM ${client.escapeIdentifier(table)} AS t, regexp_matches(t::text, $1, 'gi') AS m
          WHERE t::text ~* $2 AND lower(m[1]) = ANY($3::text[])`, [`(${UPLOAD_UUID_PATTERN_SOURCE})`, UUID_PREFIX_FILTER, candidates]);
      for (const r of rows.rows) found.add(r.value);
    }
    await client.query('COMMIT');
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return found;
}

const chunksOf = <T>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ORPHAN_UPLOAD_CHUNK) out.push(list.slice(i, i + ORPHAN_UPLOAD_CHUNK));
  return out;
};

const errorCode = (err: unknown): string => (err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

/** Moves without replacing: a file already at the target is a failure, never overwritten */
async function moveFile(from: string, to: string): Promise<void> {
  if (await fs.promises.lstat(to).then(() => true, () => false)) {
    throw Object.assign(new Error('target exists'), { code: 'EEXIST' });
  }
  await fs.promises.rename(from, to);
}

/** The held copy is the same bytes as the file already back at the top level */
async function sameContent(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([fs.promises.readFile(a), fs.promises.readFile(b)]);
  return x.equals(y);
}

export interface OrphanUploadsOptions {
  apply: boolean;
  /** the files of the preview the admin confirmed: top-level names to move and `<day>/<name>` to remove */
  confirmed?: { quarantine: string[]; purge: string[] };
  /** the system admin's request, for the audit rows */
  req?: Request;
  /** tests only */
  uploadsDir?: string;
  now?: number;
  today?: string;
  afterScan?: () => Promise<void>;
}

export async function cleanupOrphanUploads(options: OrphanUploadsOptions): Promise<OrphanUploadsReport> {
  const report: OrphanUploadsReport = {
    dryRun: !options.apply, scannedFiles: 0, referencedFiles: 0, recentFiles: 0,
    orphans: { files: 0, bytes: 0, moved: 0, names: [] }, heldFiles: 0,
    expired: { files: 0, bytes: 0, removed: 0, names: [] }, restored: { files: 0, moved: 0 },
    skipped: 0, failures: [], failureCount: 0,
  };
  const today = options.today ?? await businessTodayIsoDate();
  const uploadsDir = options.uploadsDir ?? getImageUploadsDir();

  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.ORPHAN_UPLOADS_CLEANUP, async () => {
    const root = await quarantineRoot(uploadsDir);
    const top = await imageFilesIn(uploadsDir);
    const held = await heldFiles(root);
    report.scannedFiles = top.length;
    report.heldFiles = held.length;
    if (top.length === 0 && held.length === 0) return;
    const referenced = await uuidsInRows([...new Set([...top, ...held].map(f => f.uuid))]);
    const cutoff = (options.now ?? Date.now()) - ORPHAN_UPLOAD_MIN_AGE_MINUTES * 60_000;

    const orphans: UploadFile[] = [];
    for (const f of top) {
      if (referenced.has(f.uuid)) report.referencedFiles += 1;
      else if (f.mtimeMs > cutoff) report.recentFiles += 1;
      else orphans.push(f);
    }
    const expired: UploadFile[] = [];
    const restore: UploadFile[] = [];
    for (const f of held) {
      if (referenced.has(f.uuid)) restore.push(f);
      else if (isHoldOver(f.day ?? '', today)) expired.push(f);
    }
    const heldKey = (f: UploadFile) => `${f.day}/${f.name}`;
    const plannedOrphans = orphans.slice(0, ORPHAN_UPLOAD_RUN_LIMIT);
    const plannedExpired = expired.slice(0, ORPHAN_UPLOAD_RUN_LIMIT);
    report.orphans = { files: orphans.length, bytes: orphans.reduce((s, f) => s + f.size, 0), moved: 0, names: plannedOrphans.map(f => f.name) };
    report.expired = { files: expired.length, bytes: expired.reduce((s, f) => s + f.size, 0), removed: 0, names: plannedExpired.map(heldKey) };
    report.restored.files = restore.length;
    if (!options.apply) return;
    await options.afterScan?.();

    const fail = (name: string, err: unknown, failed: Array<{ name: string; code: string }>) => {
      const entry = { name, code: errorCode(err) };
      failed.push(entry);
      report.failureCount += 1;
      if (report.failures.length < ORPHAN_UPLOAD_LISTED_FAILURES) report.failures.push(entry);
    };
    const audit = async (operation: Operation, done: string[], failed: Array<{ name: string; code: string }>, extra: Record<string, unknown> = {}) => {
      if (done.length === 0 && failed.length === 0) return;
      const verb = operation === 'quarantine' ? 'انتقال به پوشهٔ جدا' : operation === 'purge' ? 'پاک کردن از پوشهٔ جدا' : 'بازگرداندن از پوشهٔ جدا';
      try {
        await orm.transaction(tx => logActivity({
          tx, req: options.req, action: operation === 'purge' ? 'DELETE' : 'UPDATE', entity: ORPHAN_UPLOAD_AUDIT_ENTITY,
          description: `${verb}: ${done.length} تصویر (${failed.length} خطا)`,
          details: { operation, names: done, failed, ...extra },
        }));
      } catch (err: unknown) {
        // the files have moved whatever the database says: their names reach the log file before the run stops
        logger.error(`[Uploads] orphan image ${operation} audit row failed; names: ${done.join(', ')}; failed: ${failed.map(f => `${f.name} ${f.code}`).join(', ')}`);
        throw err;
      }
    };

    // a file a row names again goes back, whatever its age; when the same bytes are already back, the held copy goes
    for (const chunk of chunksOf(restore)) {
      const done: string[] = [];
      const duplicates: string[] = [];
      const failed: Array<{ name: string; code: string }> = [];
      for (const f of chunk) {
        const target = path.join(uploadsDir, f.name);
        try {
          const taken = await fs.promises.lstat(target).then(st => st.isFile(), () => null);
          if (taken === true && await sameContent(f.absolute, target)) {
            await fs.promises.unlink(f.absolute);
            duplicates.push(heldKey(f));
          } else if (taken !== null) {
            fail(heldKey(f), { code: 'TARGET_EXISTS_DIFFERENT' }, failed);
            continue;
          } else {
            await moveFile(f.absolute, target);
            done.push(heldKey(f));
          }
          report.restored.moved += 1;
        } catch (err: unknown) { fail(heldKey(f), err, failed); }
      }
      await audit('restore', done, failed, duplicates.length > 0 ? { removedDuplicates: duplicates } : {});
    }

    // only what the admin confirmed, re-checked against the rows just before it moves (one pass for all of them)
    const confirmedMoves = new Set(options.confirmed?.quarantine ?? []);
    const confirmedPurges = new Set(options.confirmed?.purge ?? []);
    const toMove = plannedOrphans.filter(f => confirmedMoves.has(f.name));
    const toPurge = plannedExpired.filter(f => confirmedPurges.has(heldKey(f)));
    report.skipped += plannedOrphans.length - toMove.length + plannedExpired.length - toPurge.length;

    const movedNamed = await uuidsInRows(toMove.map(f => f.uuid));
    const day = toMove.length > 0 ? await dayFolder(uploadsDir, root, today) : '';
    for (const chunk of chunksOf(toMove)) {
      const named = movedNamed;
      const done: string[] = [];
      const failed: Array<{ name: string; code: string }> = [];
      for (const f of chunk) {
        if (named.has(f.uuid)) { report.skipped += 1; continue; }
        try {
          await moveFile(f.absolute, path.join(day, f.name));
          done.push(f.name);
          report.orphans.moved += 1;
        } catch (err: unknown) { fail(f.name, err, failed); }
      }
      await audit('quarantine', done, failed);
    }

    const purgeNamed = await uuidsInRows(toPurge.map(f => f.uuid));
    for (const chunk of chunksOf(toPurge)) {
      const named = purgeNamed;
      const done: string[] = [];
      const failed: Array<{ name: string; code: string }> = [];
      for (const f of chunk) {
        if (named.has(f.uuid)) { report.skipped += 1; continue; }
        try {
          await fs.promises.unlink(f.absolute);
          done.push(heldKey(f));
          report.expired.removed += 1;
        } catch (err: unknown) { fail(heldKey(f), err, failed); }
      }
      await audit('purge', done, failed);
    }
  });
  if (!outcome.acquired) {
    throw new ConflictError('بررسی تصویرهای بی‌صاحب هم‌اکنون در حال اجراست.', undefined, 'ORPHAN_UPLOADS_RUNNING');
  }
  logger.info(`[Uploads] orphan image cleanup ${options.apply ? 'applied' : 'preview'}: ${report.scannedFiles} scanned, ${report.referencedFiles} referenced, ${report.recentFiles} recent, ${report.orphans.files} orphan (${report.orphans.moved} moved), ${report.heldFiles} held, ${report.expired.files} expired (${report.expired.removed} removed), ${report.restored.moved} restored, ${report.skipped} skipped, ${report.failureCount} failed`);
  return report;
}
