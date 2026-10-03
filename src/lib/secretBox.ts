import crypto from 'node:crypto';
import { AppError } from '../errors/customErrors.js';

/**
 * v7.0.139 (TD-189, تصمیم مالک محصول: رمزنگاری): رمزنگاری رمزهای شخص ثالث در سطح برنامه با کلید جدا.
 * الگوریتم AES-256-GCM؛ کلید از متغیر محیطی `ERP_SECRETS_KEY` (حداقل ۳۲ نویسه، جدا از JWT_SECRET) با scrypt ساخته می‌شود.
 * قالب ذخیره: `enc:v1:<iv>:<tag>:<ciphertext>` (base64). مقدار قدیمی متن ساده (بدون پیشوند) همان‌طور خوانده می‌شود
 * تا `npm run secrets:encrypt` آن را رمزنگاری کند. اگر کلید گم شود، رمزهای ذخیره‌شده قابل بازیابی نیستند.
 */
const PREFIX = 'enc:v1:';
const KEY_SALT = 'papital-erp:secret-box:v1';
export const SECRETS_KEY_MIN_LENGTH = 32;

let cached: { raw: string; key: Buffer } | null = null;

function resolveKey(): Buffer | null {
  const raw = (process.env.ERP_SECRETS_KEY || '').trim();
  if (raw.length < SECRETS_KEY_MIN_LENGTH) return null;
  if (cached?.raw !== raw) cached = { raw, key: crypto.scryptSync(raw, KEY_SALT, 32) };
  return cached.key;
}

export function isSecretsKeyConfigured(): boolean {
  return resolveKey() !== null;
}

export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** متن ساده ← مقدار رمزشده؛ '' همان '' می‌ماند. بدون کلید معتبر خطا (503) می‌دهد تا رمز هرگز ساده ذخیره نشود. */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = resolveKey();
  if (!key) {
    throw new AppError(
      `کلید رمزنگاری تنظیم نشده است؛ مدیر سیستم باید ERP_SECRETS_KEY (حداقل ${SECRETS_KEY_MIN_LENGTH} نویسه) را در تنظیمات محیط سرور قرار دهد`,
      503,
      'SECRETS_KEY_MISSING'
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * مقدار ذخیره‌شده ← متن ساده. متن ساده قدیمی همان‌طور برمی‌گردد؛ مقدار رمزشده بدون کلید یا با کلید نادرست یا
 * دست‌کاری‌شده null برمی‌گرداند (هرگز خطا یا متن رمزشده به کاربر نمی‌رسد).
 */
export function decryptSecret(stored: unknown): string | null {
  if (typeof stored !== 'string' || stored === '') return '';
  if (!isEncryptedSecret(stored)) return stored;
  const key = resolveKey();
  if (!key) return null;
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, data] = parts.map(p => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
