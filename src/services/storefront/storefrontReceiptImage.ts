import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { fileAttachments } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { getAttachmentsRoot } from '../../lib/storage.js';
import { decodeDataUrl } from '../attachments/attachmentStorage.service.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';

/**
 * v11 phase 8.2a, part 2 (start plan §5, decision 3): the photo or screenshot of a card-to-card receipt. The site shrinks
 * it on the phone first; the server takes only a JPEG, PNG or WEBP whose bytes prove the type, of at most 3 MB (so the
 * request stays inside the 5 MB body limit of every route). It is stored like every other attachment (a file under the
 * attachments folder and a `file_attachments` row) with its own entity type, which the general attachment route never
 * serves (`ownerIsLive` knows no such owner): only the «سفارش‌های سایت» page reads it, through its own route under
 * `site_orders.view`. A receipt without a photo is still taken.
 */
export const RECEIPT_IMAGE_ENTITY = 'storefront_receipt';
export const RECEIPT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
/** the longest data URL the receipt route accepts (base64 is about 4/3 of the bytes, plus its header) */
export const RECEIPT_IMAGE_DATA_URL_MAX = Math.ceil(RECEIPT_IMAGE_MAX_BYTES * 1.37) + 64;
const EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const imageError = (message: string) => new ValidationError(message, { field: 'image' }, 'STOREFRONT_RECEIPT_FIELD_INVALID');

/** The checked bytes of a receipt photo, or null when none was sent */
export function receiptImageOf(dataUrl: unknown): { mime: string; buffer: Buffer } | null {
  const text = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!text) return null;
  if (text.length > RECEIPT_IMAGE_DATA_URL_MAX) throw imageError('تصویر رسید بیش از ۳ مگابایت است؛ تصویر کوچک‌تری بفرستید.');
  let decoded: { mime: string; buffer: Buffer };
  try {
    decoded = decodeDataUrl(text);
  } catch {
    throw imageError('تصویر رسید خوانده نشد؛ دوباره بفرستید.');
  }
  if (!EXTENSIONS[decoded.mime]) throw imageError('تصویر رسید باید عکس JPEG، PNG یا WEBP باشد.');
  if (decoded.buffer.length === 0 || decoded.buffer.length > RECEIPT_IMAGE_MAX_BYTES) throw imageError('تصویر رسید بیش از ۳ مگابایت است؛ تصویر کوچک‌تری بفرستید.');
  return decoded;
}

/**
 * Writes the photo of a receipt (inside the receipt's transaction). The file is written before the row; if the
 * transaction rolls back, the file has no row and the attachments cleanup removes it later.
 */
export async function storeReceiptImage(executor: DbExecutor, receiptId: number, image: { mime: string; buffer: Buffer }): Promise<string> {
  const id = crypto.randomUUID();
  const storagePath = `${RECEIPT_IMAGE_ENTITY}/${id}.${EXTENSIONS[image.mime]}`;
  const absolute = path.join(getAttachmentsRoot(), storagePath);
  await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
  await fs.promises.writeFile(absolute, image.buffer, { flag: 'wx' });
  await executor.insert(fileAttachments).values({
    id, entityType: RECEIPT_IMAGE_ENTITY, entityId: receiptId, storagePath, originalName: `receipt-${receiptId}.${EXTENSIONS[image.mime]}`,
    mimeType: image.mime, sizeBytes: image.buffer.length, sha256: crypto.createHash('sha256').update(image.buffer).digest('hex'),
    createdBy: STOREFRONT_BOT_USER,
  });
  return id;
}

/** The receipts of a list that have a photo */
export async function receiptIdsWithImage(executor: DbExecutor, receiptIds: readonly number[]): Promise<Set<number>> {
  if (receiptIds.length === 0) return new Set();
  const rows = await executor.select({ entityId: fileAttachments.entityId }).from(fileAttachments).where(and(
    eq(fileAttachments.entityType, RECEIPT_IMAGE_ENTITY), inArray(fileAttachments.entityId, [...receiptIds]), eq(fileAttachments.isDeleted, 0),
  ));
  return new Set(rows.map(r => r.entityId));
}

/** The stored photo of a receipt: its absolute path and type, or null */
export async function receiptImageFile(executor: DbExecutor, receiptId: number): Promise<{ absolutePath: string; mime: string } | null> {
  const [row] = await executor.select({ storagePath: fileAttachments.storagePath, mimeType: fileAttachments.mimeType }).from(fileAttachments).where(and(
    eq(fileAttachments.entityType, RECEIPT_IMAGE_ENTITY), eq(fileAttachments.entityId, receiptId), eq(fileAttachments.isDeleted, 0),
  )).limit(1);
  if (!row || !EXTENSIONS[row.mimeType]) return null;
  const root = getAttachmentsRoot();
  const absolutePath = path.resolve(root, row.storagePath);
  if (!absolutePath.startsWith(root + path.sep)) return null;
  return { absolutePath, mime: row.mimeType };
}
