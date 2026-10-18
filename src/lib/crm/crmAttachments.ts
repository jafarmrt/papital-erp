/**
 * v10.2 package 7 (N-02 §3.3, product-owner decisions ت۶ / ت۷ / ت۸ of the CRM plan): image and PDF attachments of a sales
 * file and of an activity or follow-up. The rules are shared by the server (`src/services/crm/crmAttachments.service.ts`)
 * and the attachment box, so the browser refuses before sending what the server would refuse. An image keeps its original
 * and gets a light WEBP on the server (the media library's long side); the list shows the light one. Attachments stay
 * with their record in `file_attachments` and never enter the media library.
 */
import { formatPersianNumber } from '../../utils/persianNumber.js';

/** The two records that take attachments; `crm_lead` / `crm_activity` in `file_attachments.entity_type` */
export const CRM_ATTACHMENT_OWNERS = ['lead', 'activity'] as const;
export type CrmAttachmentOwner = (typeof CRM_ATTACHMENT_OWNERS)[number];

export const CRM_ATTACHMENT_ENTITY_TYPES: Readonly<Record<CrmAttachmentOwner, 'crm_lead' | 'crm_activity'>> = {
  lead: 'crm_lead',
  activity: 'crm_activity',
};

/** At most this many live files on one sales file or one activity */
export const CRM_ATTACHMENT_MAX_FILES = 10;
/** One file is at most 10 MB, the limit of every other attachment (`MAX_ATTACHMENT_FILE_MB`, kept equal by a test) */
export const CRM_ATTACHMENT_MAX_MB = 10;
export const CRM_ATTACHMENT_MAX_BYTES = CRM_ATTACHMENT_MAX_MB * 1024 * 1024;

/** Accepted types and the extension the original is stored with */
export const CRM_ATTACHMENT_TYPES: Readonly<Record<string, { ext: string; image: boolean }>> = {
  'image/jpeg': { ext: 'jpg', image: true },
  'image/png': { ext: 'png', image: true },
  'image/webp': { ext: 'webp', image: true },
  'application/pdf': { ext: 'pdf', image: false },
};

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

/** The `accept` list of the file picker */
export const CRM_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

export const CRM_ATTACHMENT_FORMAT_TEXT = 'فقط تصویر (JPG، PNG، WEBP) یا PDF پیوست می‌شود.';
export const CRM_ATTACHMENT_TOO_LARGE_TEXT = `حجم هر پیوست حداکثر ${formatPersianNumber(CRM_ATTACHMENT_MAX_MB)} مگابایت است.`;
export const CRM_ATTACHMENT_LIMIT_TEXT = `هر پرونده یا اقدام حداکثر ${formatPersianNumber(CRM_ATTACHMENT_MAX_FILES)} پیوست دارد.`;

/** The type of a file from its declared type, else its extension; null when it is not accepted */
export function crmAttachmentTypeOf(fileName: string, declaredType: string): string | null {
  const declared = declaredType.split(';')[0].trim().toLowerCase();
  if (CRM_ATTACHMENT_TYPES[declared]) return declared;
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_TYPES[ext] ?? null;
}

export function isCrmAttachmentImage(type: string): boolean {
  return CRM_ATTACHMENT_TYPES[type]?.image === true;
}

/**
 * The browser's check of the files picked for one record: a wrong type, a file above the limit or more files than the
 * record still takes is an error naming the file; nothing is sent then.
 */
export function crmAttachmentPickError(
  files: ReadonlyArray<{ name: string; type: string; size: number }>,
  alreadyAttached: number,
): string | null {
  for (const f of files) {
    if (!crmAttachmentTypeOf(f.name, f.type || '')) return `«${f.name}»: ${CRM_ATTACHMENT_FORMAT_TEXT}`;
    if (f.size > CRM_ATTACHMENT_MAX_BYTES) return `«${f.name}»: ${CRM_ATTACHMENT_TOO_LARGE_TEXT}`;
    if (f.size === 0) return `«${f.name}»: فایل خالی است.`;
  }
  if (alreadyAttached + files.length > CRM_ATTACHMENT_MAX_FILES) return CRM_ATTACHMENT_LIMIT_TEXT;
  return null;
}

/** One attachment as the server answers it */
export interface CrmAttachmentView {
  id: string;
  name: string;
  type: string;
  size: number;
  /** an image with a light version; the list shows `lightUrl` */
  hasLight: boolean;
  url: string;
  lightUrl: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

export function crmAttachmentUrl(id: string, variant?: 'light'): string {
  return `/api/attachments/${id}${variant === 'light' ? '?variant=light' : ''}`;
}

/** The upload and list route of a record's attachments */
export function crmAttachmentsPath(owner: CrmAttachmentOwner, ownerId: number): string {
  return `/crm/${owner === 'lead' ? 'leads' : 'activities'}/${ownerId}/attachments`;
}

/** Size of a file in Persian: «۲٫۴ مگابایت» or «۳۲۰ کیلوبایت» */
export function crmAttachmentSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${formatPersianNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} مگابایت`;
  return `${formatPersianNumber(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}
