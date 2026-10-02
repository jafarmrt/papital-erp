/**
 * v7.0.100 (TD-224 بند ۲، TD-236): نمایش پیوست‌ها در مرورگر.
 * - فراداده پیوست از v7.0.56 فقط `name` / `url` / `type` دارد؛ فیلدهای قدیمی `fileName` / `dataUrl` / `fileType`
 *   فقط برای داده‌های پیش از آن خوانده می‌شوند.
 * - فایل‌های `/api/attachments/<id>` نیاز به احراز هویت دارند؛ در محیط پیش‌نمایشی که کوکی مسدود است
 *   (EXPOSE_TOKEN_IN_BODY) مرورگر برای `<img src>` و لینک دانلود هدر Bearer نمی‌فرستد.
 */
import { getAuthToken } from '../../api';

export interface DisplayableAttachment {
  name?: string;
  url?: string;
  type?: string;
  fileName?: string;
  fileType?: string;
  dataUrl?: string;
}

const PROTECTED_ATTACHMENT_URL = /^(?:https?:\/\/[^/]+)?\/api\/attachments\/[0-9a-f-]{36}$/i;
const IMAGE_NAME = /\.(jpg|jpeg|png|webp|gif|svg)$/i;

export function attachmentSourceOf(att: DisplayableAttachment): string {
  return att.url || att.dataUrl || '';
}

export function attachmentNameOf(att: DisplayableAttachment): string {
  return att.name || att.fileName || '';
}

export function isImageAttachment(att: DisplayableAttachment): boolean {
  const type = att.type || att.fileType || '';
  return attachmentSourceOf(att).startsWith('data:image/') || type.startsWith('image/') || IMAGE_NAME.test(attachmentNameOf(att));
}

export function isProtectedAttachmentUrl(url: string | undefined): boolean {
  return Boolean(url && PROTECTED_ATTACHMENT_URL.test(url));
}

/** فقط وقتی توکن در حافظه است (حالت سازگاری پیش‌نمایش) فایل باید با هدر Bearer دریافت شود؛ با کوکی خود مرورگر کافی است. */
export function needsBearerFetch(url: string | undefined): boolean {
  return isProtectedAttachmentUrl(url) && Boolean(getAuthToken());
}

export async function fetchAttachmentBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const token = getAuthToken();
  const res = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!res.ok) throw new Error(`دریافت پیوست ناموفق بود (${res.status})`);
  return res.blob();
}

/** دانلود پیوست؛ در حالت توکن در حافظه فایل با هدر Bearer گرفته و از نشانی blob ذخیره می‌شود. */
export async function downloadAttachment(url: string, name: string): Promise<void> {
  let href = url;
  let objectUrl: string | null = null;
  if (needsBearerFetch(url)) {
    objectUrl = URL.createObjectURL(await fetchAttachmentBlob(url));
    href = objectUrl;
  }
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl as string), 60_000);
}
