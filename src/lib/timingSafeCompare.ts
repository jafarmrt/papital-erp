import crypto from 'crypto';

/**
 * مقایسه امن در زمان ثابت (Constant-time) دو توکن متنی با هش SHA-256.
 * هش‌کردن قبل از timingSafeEqual طول هر دو طرف را یکسان می‌کند و از
 * افشای طول/محتوا از طریق زمان پاسخ جلوگیری می‌نماید (یافته S-3 / TD-092).
 * (v4.0.29: تلفیق دو پیاده‌سازی موازی در metricsAuth و auth.routes به یک منبع واحد)
 */
export function safeCompareTokens(a: string, b: string): boolean {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a.trim()).digest();
  const hashB = crypto.createHash('sha256').update(b.trim()).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
