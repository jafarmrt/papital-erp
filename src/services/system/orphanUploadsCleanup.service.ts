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
 * preview the admin confirmed, re-reads the rows for each chunk just before it moves or removes it, never deletes a file
 * outright: it moves it to `.orphaned/<day>/`, removes it only after the hold, and moves back one a row names again.
 * Each chunk of names writes its audit row inside the lock.
 */

export const ORPHAN_UPLOAD_AUDIT_ENTITY = 'تصویرهای بارگذاری‌شده';

/** Not read for references: before / after snapshots of records, which name every image ever replaced */
const UNREAD_TABLES = new Set(['activity_logs']);
/** A table without such a column holds no text, so no reference */
const TEXT_TYPES = ['text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY', 'USER-DEFINED'];
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

async function heldFiles(root: string): Promise<UploadFile[]> {
  const days = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: UploadFile[] = [];
  for (const d of days) {
    if (d.isDirectory() && ORPHAN_UPLOAD_DAY_PATTERN.test(d.name)) files.push(...await imageFilesIn(path.join(root, d.name), d.name));
  }
  return files;
}

/** The UUIDs `pattern` finds in any row of the scanned tables, lower-cased, read in one snapshot; each table once */
async function uuidsInRows(pattern: string): Promise<Set<string>> {
  const found = new Set<string>();
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '5min'`);
    const tables = await client.query<{ table_name: string }>(
      `SELECT DISTINCT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.data_type = ANY($1::text[])
        ORDER BY c.table_name`, [TEXT_TYPES]);
    for (const { table_name: table } of tables.rows) {
      if (UNREAD_TABLES.has(table)) continue;
      const rows = await client.query<{ value: string }>(
        `SELECT DISTINCT lower(m[1]) AS value
           FROM ${client.escapeIdentifier(table)} AS t, regexp_matches(t::text, $1, 'gi') AS m
          WHERE t::text ~* $2`, [`(${pattern})`, UUID_PREFIX_FILTER]);
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
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.rename(from, to);
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
    const referenced = await uuidsInRows(UPLOAD_UUID_PATTERN_SOURCE);
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
    const audit = async (operation: Operation, done: string[], failed: Array<{ name: string; code: string }>) => {
      if (done.length === 0 && failed.length === 0) return;
      const verb = operation === 'quarantine' ? 'انتقال به پوشهٔ جدا' : operation === 'purge' ? 'پاک کردن از پوشهٔ جدا' : 'بازگرداندن از پوشهٔ جدا';
      await orm.transaction(tx => logActivity({
        tx, req: options.req, action: operation === 'purge' ? 'DELETE' : 'UPDATE', entity: ORPHAN_UPLOAD_AUDIT_ENTITY,
        description: `${verb}: ${done.length} تصویر (${failed.length} خطا)`,
        details: { operation, names: done, failed },
      }));
    };

    // a file a row names again goes back, whatever its age
    for (const chunk of chunksOf(restore)) {
      const done: string[] = [];
      const failed: Array<{ name: string; code: string }> = [];
      for (const f of chunk) {
        try {
          await moveFile(f.absolute, path.join(uploadsDir, f.name));
          done.push(heldKey(f));
          report.restored.moved += 1;
        } catch (err: unknown) { fail(heldKey(f), err, failed); }
      }
      await audit('restore', done, failed);
    }

    // only what the admin confirmed, each chunk re-checked against the rows just before it moves
    const confirmedMoves = new Set(options.confirmed?.quarantine ?? []);
    const confirmedPurges = new Set(options.confirmed?.purge ?? []);
    const toMove = plannedOrphans.filter(f => confirmedMoves.has(f.name));
    const toPurge = plannedExpired.filter(f => confirmedPurges.has(heldKey(f)));
    report.skipped += plannedOrphans.length - toMove.length + plannedExpired.length - toPurge.length;

    for (const chunk of chunksOf(toMove)) {
      const named = await uuidsInRows(chunk.map(f => f.uuid).join('|'));
      const done: string[] = [];
      const failed: Array<{ name: string; code: string }> = [];
      for (const f of chunk) {
        if (named.has(f.uuid)) { report.skipped += 1; continue; }
        try {
          await moveFile(f.absolute, path.join(root, today, f.name));
          done.push(f.name);
          report.orphans.moved += 1;
        } catch (err: unknown) { fail(f.name, err, failed); }
      }
      await audit('quarantine', done, failed);
    }

    for (const chunk of chunksOf(toPurge)) {
      const named = await uuidsInRows(chunk.map(f => f.uuid).join('|'));
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
