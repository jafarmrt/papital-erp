import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import type { Request } from 'express';
import sharp from 'sharp';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { crmLeads, fileAttachments } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils.js';
import { MEDIA_LIGHT_LONG_SIDE } from '../../lib/media/mediaRules.js';
import {
  CRM_ATTACHMENT_ENTITY_TYPES, CRM_ATTACHMENT_FORMAT_TEXT, CRM_ATTACHMENT_LIMIT_TEXT, CRM_ATTACHMENT_MAX_BYTES,
  CRM_ATTACHMENT_MAX_FILES, CRM_ATTACHMENT_TOO_LARGE_TEXT, CRM_ATTACHMENT_TYPES, crmAttachmentTypeOf, crmAttachmentUrl,
  type CrmAttachmentOwner, type CrmAttachmentView,
} from '../../lib/crm/crmAttachments.js';
import { getAttachmentsRoot } from '../../lib/storage.js';
import { receiveToTemp, sniffMediaType } from '../media/mediaStorage.js';
import { lockLiveActivity } from './crmActivityEdit.js';

/**
 * v10.2 package 7 (N-02 §3.3, product-owner decisions ت۶ / ت۷ / ت۸ of the CRM plan): image and PDF attachments of a sales
 * file (`crm_lead`) and of an activity or follow-up (`crm_activity`). A file comes as the raw request body (like the media
 * library), streams to `<attachment root>/.tmp` with its size counted, and its first bytes must prove the type (JPG, PNG,
 * WEBP or PDF). An image keeps its original unchanged and gets a light WEBP (long side `MEDIA_LIGHT_LONG_SIDE`) with sharp,
 * the media library's pipeline; both live in `<attachment root>/crm_lead|crm_activity/`, the light one as
 * `<uuid>.light.webp` in `file_attachments.light_storage_path`. The row is written under the owner's row lock, which
 * also counts its live files (at most `CRM_ATTACHMENT_MAX_FILES`), with the owner's audit row in the same `tx`. Files
 * are read only through `GET /api/attachments/:id` with `crm.view`; they never enter the media library. Removing one
 * detaches its row (the file stays on disk, the rule of every attachment).
 */

const AUDIT_ENTITY: Readonly<Record<CrmAttachmentOwner, string>> = {
  lead: 'فرصت فروش CRM',
  activity: 'اقدام و تماس CRM',
};

export interface CrmAttachmentActor {
  req?: Request;
  username: string;
  name: string;
}

type AttachmentRow = typeof fileAttachments.$inferSelect;

function tooLarge(): ValidationError {
  return new ValidationError(CRM_ATTACHMENT_TOO_LARGE_TEXT, undefined, 'CRM_ATTACHMENT_TOO_LARGE');
}

function formatError(): ValidationError {
  return new ValidationError(CRM_ATTACHMENT_FORMAT_TEXT, undefined, 'CRM_ATTACHMENT_FORMAT');
}

export function crmAttachmentView(row: AttachmentRow): CrmAttachmentView {
  return {
    id: row.id,
    name: row.originalName,
    type: row.mimeType,
    size: row.sizeBytes,
    hasLight: Boolean(row.lightStoragePath),
    url: crmAttachmentUrl(row.id),
    lightUrl: row.lightStoragePath ? crmAttachmentUrl(row.id, 'light') : null,
    uploadedBy: row.createdBy,
    uploadedAt: serverTimestampToUtcIso(row.createdAt) ?? row.createdAt,
  };
}

/** The type the first bytes prove, among the accepted ones */
async function sniffedType(filePath: string): Promise<string | null> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    const bytes = head.subarray(0, bytesRead);
    if (bytes.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
    const media = sniffMediaType(bytes);
    return media && CRM_ATTACHMENT_TYPES[media] ? media : null;
  } finally {
    await handle.close();
  }
}

/** The light WEBP of an image; an image sharp cannot read is 422 */
async function lightVersion(filePath: string): Promise<Buffer> {
  try {
    return await sharp(filePath, { limitInputPixels: 300_000_000 })
      .rotate()
      .resize({ width: MEDIA_LIGHT_LONG_SIDE, height: MEDIA_LIGHT_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ValidationError('تصویر خوانده نشد؛ فایل آسیب دیده یا قالب آن پشتیبانی نمی‌شود.', undefined, 'CRM_ATTACHMENT_IMAGE_UNREADABLE');
  }
}

/** Locks the live owner row (`FOR UPDATE`); a missing or deleted one is 404 */
async function lockOwner(tx: DbExecutor, owner: CrmAttachmentOwner, ownerId: number): Promise<{ title: string }> {
  if (owner === 'activity') {
    const row = await lockLiveActivity(tx, ownerId);
    return { title: row.title };
  }
  const [lead] = await tx.select({ id: crmLeads.id, title: crmLeads.title }).from(crmLeads)
    .where(and(eq(crmLeads.id, ownerId), eq(crmLeads.isDeleted, 0))).for('update');
  if (!lead) throw new NotFoundError('پرونده فروش یافت نشد', { id: ownerId }, 'CRM_LEAD_NOT_FOUND');
  return { title: lead.title };
}

function liveOwnerFiles(owner: CrmAttachmentOwner, ownerIds: number[]) {
  return and(
    eq(fileAttachments.entityType, CRM_ATTACHMENT_ENTITY_TYPES[owner]),
    inArray(fileAttachments.entityId, ownerIds.length > 0 ? ownerIds : [-1]),
    eq(fileAttachments.isDeleted, 0),
  );
}

async function removeQuietly(paths: string[]): Promise<void> {
  for (const p of paths) {
    await fs.promises.rm(p, { force: true }).catch((err: unknown) => {
      logger.warn(`[crm-attachments] could not remove ${p}: ${errorMessageOf(err)}`);
    });
  }
}

export const CrmAttachmentService = {
  /** Live attachments of several records of one kind, by record id, oldest first */
  async listByOwners(owner: CrmAttachmentOwner, ownerIds: number[], executor: DbExecutor): Promise<Map<number, CrmAttachmentView[]>> {
    const out = new Map<number, CrmAttachmentView[]>();
    const ids = [...new Set(ownerIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return out;
    const rows = await executor.select().from(fileAttachments)
      .where(liveOwnerFiles(owner, ids))
      .orderBy(asc(fileAttachments.createdAt), asc(fileAttachments.id));
    for (const row of rows) {
      const list = out.get(row.entityId) ?? [];
      list.push(crmAttachmentView(row));
      out.set(row.entityId, list);
    }
    return out;
  },

  /** Number of live attachments of several records of one kind, by record id (a record without any is absent) */
  async countByOwners(owner: CrmAttachmentOwner, ownerIds: number[], executor: DbExecutor): Promise<Map<number, number>> {
    const ids = [...new Set(ownerIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return new Map();
    const rows = await executor.select({ entityId: fileAttachments.entityId, count: sql<number>`count(*)::int` })
      .from(fileAttachments).where(liveOwnerFiles(owner, ids)).groupBy(fileAttachments.entityId);
    return new Map(rows.map((r) => [r.entityId, Number(r.count)]));
  },

  /** Attachments of one live record; a missing or deleted record is 404 */
  async list(owner: CrmAttachmentOwner, ownerId: number): Promise<CrmAttachmentView[]> {
    return orm.transaction(async (tx) => {
      if (owner === 'activity') await lockLiveActivity(tx, ownerId);
      else {
        const [lead] = await tx.select({ id: crmLeads.id }).from(crmLeads).where(and(eq(crmLeads.id, ownerId), eq(crmLeads.isDeleted, 0)));
        if (!lead) throw new NotFoundError('پرونده فروش یافت نشد', { id: ownerId }, 'CRM_LEAD_NOT_FOUND');
      }
      return (await this.listByOwners(owner, [ownerId], tx)).get(ownerId) ?? [];
    });
  },

  async upload(
    owner: CrmAttachmentOwner, ownerId: number,
    input: { body: Readable; fileName: string; declaredType: string },
    actor: CrmAttachmentActor,
  ): Promise<CrmAttachmentView> {
    const fileName = input.fileName.trim().slice(0, 255) || 'پیوست';
    const declared = crmAttachmentTypeOf(fileName, input.declaredType);
    if (!declared) throw formatError();
    const root = getAttachmentsRoot();
    const received = await receiveToTemp(input.body, CRM_ATTACHMENT_MAX_BYTES, { tmpDir: path.join(root, '.tmp'), tooLarge });
    const written: string[] = [received.tempPath];
    try {
      const actual = await sniffedType(received.tempPath);
      if (actual !== declared) throw formatError();
      const spec = CRM_ATTACHMENT_TYPES[actual];
      const light = spec.image ? await lightVersion(received.tempPath) : null;

      const entityType = CRM_ATTACHMENT_ENTITY_TYPES[owner];
      const id = crypto.randomUUID();
      const storagePath = `${entityType}/${id}.${spec.ext}`;
      const lightStoragePath = light ? `${entityType}/${id}.light.webp` : null;

      return await orm.transaction(async (tx) => {
        const record = await lockOwner(tx, owner, ownerId);
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(fileAttachments)
          .where(liveOwnerFiles(owner, [ownerId]));
        if (Number(count) >= CRM_ATTACHMENT_MAX_FILES) {
          throw new ValidationError(CRM_ATTACHMENT_LIMIT_TEXT, { count }, 'CRM_ATTACHMENT_LIMIT');
        }
        const absolute = path.join(root, storagePath);
        await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
        await fs.promises.rename(received.tempPath, absolute);
        written.push(absolute);
        if (light && lightStoragePath) {
          const lightAbsolute = path.join(root, lightStoragePath);
          await fs.promises.writeFile(lightAbsolute, light, { flag: 'wx' });
          written.push(lightAbsolute);
        }
        const [row] = await tx.insert(fileAttachments).values({
          id,
          entityType,
          entityId: ownerId,
          storagePath,
          lightStoragePath,
          originalName: fileName,
          mimeType: actual,
          sizeBytes: received.sizeBytes,
          sha256: received.sha256,
          createdBy: actor.name.slice(0, 120),
        }).returning();
        await logActivity({
          req: actor.req,
          tx,
          userFullName: actor.name,
          action: 'UPDATE',
          entity: AUDIT_ENTITY[owner],
          entityId: String(ownerId),
          description: `افزودن پیوست «${fileName}» به «${record.title}»`,
          details: { attachmentAdded: { id, name: fileName, type: actual, size: received.sizeBytes, hasLight: Boolean(light) } },
        });
        return crmAttachmentView(row);
      });
    } catch (err) {
      // the files of a refused or rolled back upload never stay behind
      await removeQuietly(written);
      throw err;
    }
  },

  /** Detaches one live attachment of a live record; the file stays on disk */
  async remove(owner: CrmAttachmentOwner, ownerId: number, attachmentId: string, actor: CrmAttachmentActor): Promise<void> {
    await orm.transaction(async (tx) => {
      const record = await lockOwner(tx, owner, ownerId);
      const [row] = await tx.select().from(fileAttachments)
        .where(and(eq(fileAttachments.id, attachmentId), liveOwnerFiles(owner, [ownerId])))
        .for('update');
      if (!row) throw new NotFoundError('پیوست یافت نشد', { id: attachmentId }, 'CRM_ATTACHMENT_NOT_FOUND');
      await tx.update(fileAttachments).set({ isDeleted: 1 }).where(eq(fileAttachments.id, row.id));
      await logActivity({
        req: actor.req,
        tx,
        userFullName: actor.name,
        action: 'UPDATE',
        entity: AUDIT_ENTITY[owner],
        entityId: String(ownerId),
        description: `حذف پیوست «${row.originalName}» از «${record.title}»`,
        details: { attachmentRemoved: { id: row.id, name: row.originalName, type: row.mimeType, size: row.sizeBytes } },
      });
    });
  },
};
