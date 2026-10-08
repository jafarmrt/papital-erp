import { AppError } from '../../errors/customErrors.js';
import { decryptSecret, encryptSecret } from '../../lib/secretBox.js';
import { MASKED_SECRET_VALUE } from '../../lib/secrets/maskedSecret.js';

/**
 * v9.0.361 (TD-898، مشاهده ۱۱ بسته ۱۵، تصمیم مالک محصول ت۷ الف): کلید و رمز ووکامرس و کلید امضای وب‌هوک ووکامرس در
 * `app_settings` با `encryptSecret` (قاعده AGENTS §5، کلید `ERP_SECRETS_KEY`) ذخیره می‌شوند و فقط درون کارساز باز می‌شوند.
 * پیش‌تر متن ساده بودند و هر نسخه پشتیبان یا خواننده پایگاه‌داده آن‌ها را می‌دید. مقدار ساده قدیمی همان‌طور خوانده می‌شود تا
 * `npm run secrets:encrypt` آن را رمز کند؛ بدون کلید، مقدار تازه ذخیره نمی‌شود (503). متن رمزشده هرگز به مرورگر نمی‌رسد.
 */
export const ENCRYPTED_SETTING_KEYS: readonly string[] = ['wc_consumer_key', 'wc_consumer_secret', 'wc_webhook_secret'];

const ENCRYPTED = new Set(ENCRYPTED_SETTING_KEYS);

export const UNREADABLE_SETTING_SECRET_MESSAGE = 'کلیدهای ذخیره‌شده ووکامرس با کلید رمزنگاری فعلی کارساز (ERP_SECRETS_KEY) باز نمی‌شوند. کلید درست را به کارساز برگردانید، یا مدیر سیستم کلیدهای ووکامرس را دوباره وارد و ذخیره کند.';

export function isEncryptedSettingKey(key: string): boolean {
  return ENCRYPTED.has(key);
}

/** مقداری که در `app_settings` نوشته می‌شود: کلیدهای محرمانه رمزشده (خالی خالی می‌ماند)، بقیه همان */
export function sealSettingValue(key: string, value: string): string {
  return ENCRYPTED.has(key) ? encryptSecret(value) : value;
}

/** مقدار ساده ذخیره‌شده، یا null وقتی با کلید فعلی باز نمی‌شود */
export function readSettingValue(key: string, stored: string | undefined): string | null | undefined {
  if (stored === undefined || !ENCRYPTED.has(key)) return stored;
  return decryptSecret(stored);
}

/** مقدار ساده برای کار درون کارساز؛ مقدار باز نشده 503 `INTEGRATION_SECRET_UNREADABLE` (هرگز رشته خالی یا متن رمزشده) */
export function openSettingSecret(key: string, stored: string | undefined): string {
  const value = readSettingValue(key, stored ?? '');
  if (value === null) {
    throw new AppError(UNREADABLE_SETTING_SECRET_MESSAGE, 503, 'INTEGRATION_SECRET_UNREADABLE', { key });
  }
  return value ?? '';
}

/** پاسخ تنظیمات مدیر سیستم: کلید محرمانه باز می‌شود و مقدار باز نشده «********» می‌ماند تا ذخیره دوباره آن را دست نزند */
export function revealSettingSecrets<T extends { key: string; value: string }>(settings: T[]): T[] {
  return settings.map(s => {
    if (!ENCRYPTED.has(s.key)) return s;
    const value = decryptSecret(s.value);
    return { ...s, value: value === null ? MASKED_SECRET_VALUE : value };
  });
}
