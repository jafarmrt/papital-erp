// V10-2.3: helper واحد استاندارد فشرده‌سازی تصاویر کلاینت‌ساید (سقف پیش‌فرض ۳۰۰ کیلوبایت)
// جایگزین قواعد پراکنده سقف حجم در فرم‌های آپلود (ترنسفر، پروفایل، راه‌اندازی، تنظیمات)

export interface CompressOptions {
  maxBytes?: number;
  maxSizePx?: number;
}

const DEFAULT_MAX_BYTES = 300 * 1024;
const DEFAULT_MAX_SIZE_PX = 1600;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read-error'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode-error'));
    img.src = src;
  });
}

function approxBytesFromDataUrl(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

/**
 * تصویر ورودی را با canvas بازکدگذاری می‌کند تا خروجی dataURL زیر سقف تعیین‌شده باشد.
 * ابتدا کیفیت JPEG کاهش می‌یابد، سپس ابعاد؛ در صورت نرسیدن به سقف، بهترین تلاش برگردانده می‌شود.
 */
export async function compressTo300KB(file: File, opts: CompressOptions = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxSizePx = opts.maxSizePx ?? DEFAULT_MAX_SIZE_PX;

  const srcDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(srcDataUrl);

  const initialScale = Math.min(1, maxSizePx / Math.max(img.width || 1, img.height || 1));
  let width = Math.max(40, Math.round(img.width * initialScale));
  let height = Math.max(40, Math.round(img.height * initialScale));
  let quality = 0.85;

  let best = '';
  let attempt = 0;
  while (attempt < 14) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL('image/jpeg', quality);
    best = out;

    if (approxBytesFromDataUrl(out) <= maxBytes) {
      return out;
    }

    if (quality > 0.4) {
      quality -= 0.15;
    } else {
      width = Math.max(40, Math.round(width * 0.8));
      height = Math.max(40, Math.round(height * 0.8));
    }
    attempt += 1;
  }

  return best;
}
