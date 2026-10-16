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

/** OBS-R2-95: sources that may carry transparency keep a format with an alpha channel */
const ALPHA_CAPABLE_TYPES = new Set(['image/png', 'image/webp', 'image/gif']);

export type CompressedImageType = 'image/jpeg' | 'image/webp' | 'image/png';

/** True when any pixel of the drawn image is not fully opaque; an unreadable canvas counts as transparent (kept lossless). */
export function hasTransparentPixels(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const pixels = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * OBS-R2-95: the output format. An opaque photo becomes JPEG; a PNG, WEBP or GIF with transparency (a logo) keeps its
 * alpha channel: WEBP where the browser can write it, else PNG. JPEG has no alpha, so a transparent logo used to get a
 * black background.
 */
export function compressedImageType(sourceType: string, transparent: boolean): CompressedImageType {
  if (!ALPHA_CAPABLE_TYPES.has(sourceType) || !transparent) return 'image/jpeg';
  return 'image/webp';
}

function encodeCanvas(canvas: HTMLCanvasElement, type: CompressedImageType, quality: number): string {
  const out = canvas.toDataURL(type, quality);
  // a browser that cannot write WEBP returns PNG (still with alpha); `toDataURL` never falls back to JPEG
  if (type === 'image/webp' && !out.startsWith('data:image/webp')) return canvas.toDataURL('image/png');
  return out;
}

/**
 * تصویر ورودی را با canvas بازکدگذاری می‌کند تا خروجی dataURL زیر سقف تعیین‌شده باشد.
 * ابتدا کیفیت کاهش می‌یابد، سپس ابعاد؛ در صورت نرسیدن به سقف، بهترین تلاش برگردانده می‌شود.
 * OBS-R2-95: تصویر شفاف (لوگوی PNG) قالب دارای شفافیت (WEBP یا PNG) می‌گیرد، نه JPEG با زمینه سیاه.
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
  let outputType: CompressedImageType | null = null;

  let best = '';
  let attempt = 0;
  while (attempt < 14) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(img, 0, 0, width, height);
    if (outputType === null) {
      outputType = compressedImageType(file.type, ALPHA_CAPABLE_TYPES.has(file.type) && hasTransparentPixels(ctx, width, height));
    }
    const out = encodeCanvas(canvas, outputType, quality);
    best = out;

    if (approxBytesFromDataUrl(out) <= maxBytes) {
      return out;
    }

    // PNG has no quality setting: only smaller dimensions make it smaller
    if (quality > 0.4 && !out.startsWith('data:image/png')) {
      quality -= 0.15;
    } else {
      width = Math.max(40, Math.round(width * 0.8));
      height = Math.max(40, Math.round(height * 0.8));
    }
    attempt += 1;
  }

  return best;
}
