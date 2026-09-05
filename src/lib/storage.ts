import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// Max allowed image size in bytes (3 MB)
const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;
// Allowed MIME formats
// V3.0.7 (TD-065): SVG از allowlist حذف شد — SVG می‌تواند حاوی اسکریپت باشد و
// فایل‌های با پیشوند logo عمومی و بدون احراز هویت سرو می‌شوند (وکتور XSS).
const ALLOWED_MIME_TYPES = new Set(['jpeg', 'jpg', 'png', 'webp', 'gif']);

export const uploadBase64ToStorage = async (base64String: string, type: 'image' | 'thumbnail' = 'image', namePrefix?: string): Promise<string> => {
  if (!base64String || typeof base64String !== 'string' || !base64String.startsWith('data:image')) {
    return base64String;
  }

  // Pre-check string length before Buffer allocation (Base64 is ~1.33x binary size)
  // 3MB binary is roughly 4.1MB base64 string
  if (base64String.length > 5.5 * 1024 * 1024) {
    throw new Error('حجم تصویر ارسالی بیش از حد مجاز است (حداکثر ۳ مگابایت)');
  }

  const matches = base64String.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
  
  if (!matches || matches.length !== 3) {
    return base64String;
  }

  const mimeSubtype = matches[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeSubtype) && mimeSubtype !== 'jpeg') {
    throw new Error('فرمت تصویر نامعتبر است. پسوندهای مجاز: JPG, PNG, WEBP, GIF');
  }

  const ext = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;
  const data = matches[2];
  const buffer = Buffer.from(data, 'base64');

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('حجم تصویر ارسالی بیش از حد مجاز است (حداکثر ۳ مگابایت)');
  }
  
  // V1.3.8: پیشوند نام فایل (مثل 'logo') باعث می‌شود فایل در گارد /uploads عمومی و
  // بدون احراز هویت سرو شود — برای لوگوی شرکت که در صفحه ورود (بدون نشست) نمایش داده می‌شود.
  const fileName = `${namePrefix ? namePrefix + '-' : ''}${uuidv4()}.${ext}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  const filePath = path.join(uploadDir, fileName);
  fs.writeFileSync(filePath, buffer);
  
  return `/uploads/${fileName}`;
};

