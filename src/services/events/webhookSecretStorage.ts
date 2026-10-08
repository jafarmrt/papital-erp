import { AppError } from '../../errors/customErrors.js';
import { decryptSecret, encryptSecret } from '../../lib/secretBox.js';

/**
 * v9.0.361 (TD-898، مشاهده ۱۱ بسته ۱۵، تصمیم مالک محصول ت۷ الف): کلید امضای اشتراک وب‌هوک و مقدار هر سرآیند سفارشی
 * (توکن API شریک) با `encryptSecret` (قاعده AGENTS §5، کلید `ERP_SECRETS_KEY`) ذخیره می‌شوند و فقط درون کارساز باز می‌شوند.
 * پیش‌تر هر دو متن ساده در `webhook_subscriptions` بودند و هر نسخه پشتیبان یا خواننده پایگاه‌داده آن‌ها را می‌دید.
 * نام سرآیندها پنهان نیست و ساده می‌ماند. مقدار ساده قدیمی همان‌طور خوانده می‌شود تا `npm run secrets:encrypt` آن را رمز کند؛
 * بدون کلید، کلید یا سرآیند تازه ذخیره نمی‌شود (503). مقدار رمزشده‌ای که با کلید فعلی باز نمی‌شود هرگز فرستاده نمی‌شود.
 */

export const UNREADABLE_WEBHOOK_SECRET_MESSAGE = 'کلید امضا یا سرآیندهای این درگاه با کلید رمزنگاری فعلی کارساز (ERP_SECRETS_KEY) باز نمی‌شود. کلید درست را به کارساز برگردانید، یا «ساخت کلید تازه» را بزنید و سرآیندها را دوباره وارد کنید.';

type HeaderMap = Record<string, string>;

function headersOf(value: unknown): HeaderMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, v]) => [name, String(v ?? '')]));
}

/** مقدار هر سرآیند رمز می‌شود (مقدار خالی خالی می‌ماند)؛ بدون کلید رمزنگاری 503 */
export function sealHeaders(headers: unknown): HeaderMap {
  return Object.fromEntries(Object.entries(headersOf(headers)).map(([name, value]) => [name, encryptSecret(value)]));
}

export type OpenedWebhookSubscription<T> = Omit<T, 'secretKey' | 'customHeaders'> & {
  secretKey: string;
  customHeaders: HeaderMap;
  /** فیلدهایی که با کلید فعلی باز نشدند (`secretKey`، `customHeaders.<name>`)؛ چنین اشتراکی چیزی نمی‌فرستد */
  unreadableSecrets: string[];
};

/** ردیف ذخیره‌شده ← کلید و سرآیندهای ساده برای کار درون کارساز؛ مقدار باز نشده خالی می‌شود و نامش ثبت می‌شود */
export function openWebhookSubscription<T extends { secretKey: string; customHeaders: unknown }>(row: T): OpenedWebhookSubscription<T> {
  const unreadableSecrets: string[] = [];
  const secretKey = decryptSecret(row.secretKey);
  if (secretKey === null) unreadableSecrets.push('secretKey');
  const customHeaders: HeaderMap = {};
  for (const [name, value] of Object.entries(headersOf(row.customHeaders))) {
    const plain = decryptSecret(value);
    if (plain === null) unreadableSecrets.push(`customHeaders.${name}`);
    customHeaders[name] = plain ?? '';
  }
  return { ...row, secretKey: secretKey ?? '', customHeaders, unreadableSecrets };
}

export function assertWebhookSecretsReadable(sub: { unreadableSecrets: string[] }): void {
  if (sub.unreadableSecrets.length > 0) {
    throw new AppError(UNREADABLE_WEBHOOK_SECRET_MESSAGE, 503, 'INTEGRATION_SECRET_UNREADABLE', { fields: sub.unreadableSecrets });
  }
}
