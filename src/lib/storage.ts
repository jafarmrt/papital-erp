import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { ValidationError } from '../errors/customErrors.js';

// Max allowed image size in bytes (3 MB)
const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;
// Allowed MIME formats
// V3.0.7 (TD-065): SVG از allowlist حذف شد — SVG می‌تواند حاوی اسکریپت باشد و
// فایل‌های با پیشوند logo عمومی و بدون احراز هویت سرو می‌شوند (وکتور XSS).
const ALLOWED_MIME_TYPES = new Set(['jpeg', 'jpg', 'png', 'webp', 'gif']);

const IMAGE_TOO_LARGE_MESSAGE = 'حجم تصویر ارسالی بیش از حد مجاز است (حداکثر ۳ مگابایت)';
const IMAGE_FORMAT_MESSAGE = 'فرمت تصویر نامعتبر است. پسوندهای مجاز: JPG, PNG, WEBP, GIF';
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/** Whether a field value is an inline data URL (any media type), which only `uploadBase64ToStorage` may store */
export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\s*data:/i.test(value);
}

/**
 * v9.0.256 (TD-642, finding B13-17): a refused image is a `ValidationError` (422 with its Persian message, also in
 * production), and any `data:` value that is not a base64 image of an allowed format is refused instead of being
 * returned unchanged and stored in the record column. A value that is not a data URL (a stored path) is returned as is.
 */
/** v9.0.359 (TD-619): the directory image fields are written to (also checked by the system health page) */
export function getImageUploadsDir(): string {
  return path.join(process.cwd(), 'public', 'uploads');
}

export const uploadBase64ToStorage = async (base64String: string, type: 'image' | 'thumbnail' = 'image', namePrefix?: string): Promise<string> => {
  if (!isDataUrl(base64String)) {
    return base64String;
  }

  // Pre-check string length before Buffer allocation (Base64 is ~1.33x binary size)
  // 3MB binary is roughly 4.1MB base64 string
  if (base64String.length > 5.5 * 1024 * 1024) {
    throw new ValidationError(IMAGE_TOO_LARGE_MESSAGE, undefined, 'IMAGE_TOO_LARGE');
  }

  const matches = base64String.trim().match(/^data:image\/([A-Za-z0-9.+-]+);base64,(.+)$/i);
  if (!matches || !BASE64_BODY.test(matches[2])) {
    throw new ValidationError(IMAGE_FORMAT_MESSAGE, undefined, 'IMAGE_FORMAT_INVALID');
  }

  const mimeSubtype = matches[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeSubtype)) {
    throw new ValidationError(IMAGE_FORMAT_MESSAGE, undefined, 'IMAGE_FORMAT_INVALID');
  }

  const ext = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;
  const data = matches[2];
  const buffer = Buffer.from(data, 'base64');

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new ValidationError(IMAGE_TOO_LARGE_MESSAGE, undefined, 'IMAGE_TOO_LARGE');
  }
  
  // V1.3.8: پیشوند نام فایل (مثل 'logo') باعث می‌شود فایل در گارد /uploads عمومی و
  // بدون احراز هویت سرو شود — برای لوگوی شرکت که در صفحه ورود (بدون نشست) نمایش داده می‌شود.
  const fileName = `${namePrefix ? namePrefix + '-' : ''}${uuidv4()}.${ext}`;
  const uploadDir = getImageUploadsDir();
  
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  const filePath = path.join(uploadDir, fileName);
  fs.writeFileSync(filePath, buffer);
  
  return `/uploads/${fileName}`;
};

