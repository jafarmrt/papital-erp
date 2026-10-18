import type { Request } from 'express';
import fs from 'fs';
import path from 'path';
import { orm, pool } from '../../db/drizzle.js';
import { ConflictError } from '../../errors/customErrors.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { getImageUploadsDir } from '../../lib/storage.js';
import {
  ORPHAN_UPLOAD_LISTED_NAMES, ORPHAN_UPLOAD_MIN_AGE_MINUTES, ORPHAN_UPLOAD_NAME_PATTERN,
  type OrphanUploadsReport,
} from '../../lib/system/orphanUploads.js';
import { logger } from '../../middleware/logger.js';

/**
 * v10.2.17 (OBS-R2-60, 10.2 package 13): removes the image files of `public/uploads` that no row names (contract and rules
 * in `src/lib/system/orphanUploads.ts`). Only the files the image fields write are candidates, top level only (never
 * `.attachments`, the media library or a public asset folder). A file is kept when any text or JSON column of any table
 * of the current schema names `uploads/<name>`: a soft-deleted record, a copied record, a draft or a queued event keeps
 * its image. Only the audit log is not read, since its before and after snapshots name every replaced image. The folder
 * is listed before the rows are read, so a file saved meanwhile is either named or younger than the minimum age.
 * Run by hand only (POST /api/system/orphan-uploads, system admin), a preview unless `apply`, one run at a time.
 */

export const ORPHAN_UPLOAD_AUDIT_ENTITY = 'تصویرهای بارگذاری‌شده';

/** Not read for references: before / after snapshots of records, which name every image ever replaced */
const UNREAD_TABLES = new Set(['activity_logs']);
const TEXT_TYPES = ['text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY'];

interface UploadFile { name: string; absolute: string; size: number; mtimeMs: number; }

async function listUploadFiles(dir: string): Promise<UploadFile[]> {
  const files: UploadFile[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !ORPHAN_UPLOAD_NAME_PATTERN.test(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const stat = await fs.promises.lstat(absolute);
    if (!stat.isFile()) continue;
    files.push({ name: entry.name, absolute, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return files;
}

/** Every `uploads/<name>` any row of the current schema names (the audit log aside), lower-cased */
async function referencedUploadNames(): Promise<Set<string>> {
  const names = new Set<string>();
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '5min'`);
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.data_type = ANY($1::text[])
        ORDER BY c.table_name, c.column_name`, [TEXT_TYPES]);
    for (const { table_name: table, column_name: column } of columns.rows) {
      if (UNREAD_TABLES.has(table)) continue;
      const rows = await client.query<{ value: string }>(
        `SELECT DISTINCT m[1] AS value
           FROM ${client.escapeIdentifier(table)}, regexp_matches(${client.escapeIdentifier(column)}::text, 'uploads/([A-Za-z0-9._-]+)', 'g') AS m
          WHERE ${client.escapeIdentifier(column)}::text LIKE '%uploads/%'`);
      for (const r of rows.rows) names.add(r.value.toLowerCase());
    }
    await client.query('COMMIT');
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return names;
}

export async function cleanupOrphanUploads(options: {
  apply: boolean;
  /** the system admin's request, for the audit row */
  req?: Request;
  /** tests only: another folder than `public/uploads` */
  uploadsDir?: string;
  now?: number;
}): Promise<OrphanUploadsReport> {
  const report: OrphanUploadsReport = {
    dryRun: !options.apply, scannedFiles: 0, referencedFiles: 0,
    orphans: { files: 0, bytes: 0, removed: 0, names: [] }, recentFiles: 0, failures: [],
  };
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.ORPHAN_UPLOADS_CLEANUP, async () => {
    const files = await listUploadFiles(options.uploadsDir ?? getImageUploadsDir());
    report.scannedFiles = files.length;
    if (files.length === 0) return;
    const referenced = await referencedUploadNames();
    const cutoff = (options.now ?? Date.now()) - ORPHAN_UPLOAD_MIN_AGE_MINUTES * 60_000;
    for (const f of files) {
      if (referenced.has(f.name.toLowerCase())) {
        report.referencedFiles += 1;
        continue;
      }
      if (f.mtimeMs > cutoff) {
        report.recentFiles += 1;
        continue;
      }
      report.orphans.files += 1;
      report.orphans.bytes += f.size;
      if (report.orphans.names.length < ORPHAN_UPLOAD_LISTED_NAMES) report.orphans.names.push(f.name);
      if (!options.apply) continue;
      try {
        await fs.promises.unlink(f.absolute);
        report.orphans.removed += 1;
      } catch (err: unknown) {
        report.failures.push({ name: f.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
  if (!outcome.acquired) {
    throw new ConflictError('پاک کردن تصویرهای بی‌صاحب هم‌اکنون در حال اجراست.', undefined, 'ORPHAN_UPLOADS_RUNNING');
  }
  if (options.apply && (report.orphans.removed > 0 || report.failures.length > 0)) {
    // the files are gone whatever the database says; the audit row is written in its own transaction, errors propagate
    await orm.transaction(tx => logActivity({
      tx,
      req: options.req,
      action: 'DELETE',
      entity: ORPHAN_UPLOAD_AUDIT_ENTITY,
      description: `پاک کردن ${report.orphans.removed} تصویر بی‌صاحب (${report.failures.length} خطا)`,
      details: { names: report.orphans.names, bytes: report.orphans.bytes, failures: report.failures },
    }));
  }
  logger.info(`[Uploads] orphan image cleanup ${options.apply ? 'applied' : 'preview'}: ${report.scannedFiles} scanned, ${report.referencedFiles} referenced, ${report.orphans.files} orphan (${report.orphans.removed} removed), ${report.recentFiles} recent`);
  return report;
}
