/**
 * v9.0.359 (TD-619، B01-39): قرارداد کارت ذخیره‌سازی صفحه سلامت، مشترک سرور و رابط. کارت دو پوشه‌ای را می‌سنجد که
 * برنامه واقعاً در آن‌ها می‌نویسد: پوشه پیوست‌ها (`getAttachmentsRoot`، یعنی `ATTACHMENTS_DIR` یا
 * `public/uploads/.attachments`) و پوشه تصویرها (`getImageUploadsDir`). سنجش فقط اجازه نوشتن را می‌خواند و هیچ فایلی
 * نمی‌سازد.
 */

export type StorageLocationKind = 'attachments' | 'images';

export interface StorageLocationHealth {
  kind: StorageLocationKind;
  path: string;
  writable: boolean;
  message: string;
}

export interface StorageHealth {
  status: 'ok' | 'error';
  writable: boolean;
  locations: StorageLocationHealth[];
  message: string;
}

export const STORAGE_LOCATION_LABELS: Readonly<Record<StorageLocationKind, string>> = {
  attachments: 'پیوست‌ها',
  images: 'تصویرها',
};

export const STORAGE_LOCATION_MESSAGES: Readonly<Record<StorageLocationKind, { ok: string; error: string }>> = {
  attachments: {
    ok: 'پوشه پیوست‌ها قابل نوشتن است.',
    error: 'پوشه پیوست‌ها قابل نوشتن نیست؛ پیوست تازه ذخیره نمی‌شود. لاگ کارساز را ببینید.',
  },
  images: {
    ok: 'پوشه تصویرها قابل نوشتن است.',
    error: 'پوشه تصویرها قابل نوشتن نیست؛ تصویر و نشان‌واره تازه ذخیره نمی‌شود. لاگ کارساز را ببینید.',
  },
};

export const STORAGE_SUMMARY_MESSAGES = {
  ok: 'پوشه‌های پیوست‌ها و تصویرها قابل نوشتن‌اند.',
  error: 'دست‌کم یک پوشه ذخیره‌سازی قابل نوشتن نیست.',
} as const;
