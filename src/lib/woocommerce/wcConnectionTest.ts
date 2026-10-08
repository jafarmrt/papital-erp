/**
 * v9.0.333 (TD-723، B15-21): «آزمایش اتصال» ووکامرس با کلیدهای ذخیره‌شده.
 * پاسخ تنظیمات برای غیرمدیر کلیدها را «********» برمی‌گرداند و زبانه ووکامرس همین را به‌جای کلید می‌فرستاد، پس آزمایش برای
 * دارنده `woocommerce.manage` همیشه با خطای احراز هویت ووکامرس شکست می‌خورد، حتی با کلیدهای درست. اکنون مرورگر کلید خالی
 * یا ماسک‌شده را نمی‌فرستد (`wcTestConnectionBody`) و کارساز به‌جای آن کلید ذخیره‌شده را به کار می‌برد
 * (`resolveWcTestCredentials`)، و کلید ذخیره‌شده فقط به نشانی فروشگاه ذخیره‌شده فرستاده می‌شود تا کسی که نشانی را
 * تغییر نمی‌دهد (TD-668) نتواند کلیدها را به سایت دیگری بفرستد.
 */

/** مقدار ماسک کلیدهای محرمانه در پاسخ GET /settings برای غیرمدیر (همان `MASKED_SETTING_VALUE` کارساز) */
export const MASKED_SECRET_VALUE = '********';

export interface WcConnectionFields {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}

export type WcTestCredentialErrorCode = 'WC_TEST_SETTINGS_INCOMPLETE' | 'WC_TEST_STORED_KEYS_OTHER_URL';

export type WcTestCredentialResult =
  | { ok: true; credentials: WcConnectionFields; usesStoredKeys: boolean }
  | { ok: false; code: WcTestCredentialErrorCode; message: string };

/** مقداری که کاربر واقعاً وارد کرده است: نه خالی و نه ماسک */
export function isEnteredCredential(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== MASKED_SECRET_VALUE;
}

/** بدنه درخواست آزمایش اتصال: فقط فیلدهای واردشده، تا کارساز بقیه را از تنظیمات ذخیره‌شده بخواند */
export function wcTestConnectionBody(fields: WcConnectionFields): Partial<WcConnectionFields> {
  const body: Partial<WcConnectionFields> = {};
  if (isEnteredCredential(fields.url)) body.url = fields.url.trim();
  if (isEnteredCredential(fields.consumerKey)) body.consumerKey = fields.consumerKey.trim();
  if (isEnteredCredential(fields.consumerSecret)) body.consumerSecret = fields.consumerSecret.trim();
  return body;
}

function storeUrlKey(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** کلیدها و نشانی آزمایش: کلید واردنشده از تنظیمات ذخیره‌شده، و در آن صورت فقط با نشانی ذخیره‌شده */
export function resolveWcTestCredentials(
  body: Partial<Record<keyof WcConnectionFields, unknown>>,
  stored: WcConnectionFields
): WcTestCredentialResult {
  const enteredKey = isEnteredCredential(body.consumerKey) ? body.consumerKey.trim() : '';
  const enteredSecret = isEnteredCredential(body.consumerSecret) ? body.consumerSecret.trim() : '';
  const usesStoredKeys = !enteredKey || !enteredSecret;
  const storedUrl = stored.url.trim();
  const url = isEnteredCredential(body.url) ? body.url.trim() : storedUrl;
  const credentials: WcConnectionFields = {
    url,
    consumerKey: enteredKey || stored.consumerKey.trim(),
    consumerSecret: enteredSecret || stored.consumerSecret.trim(),
  };
  if (!credentials.url || !credentials.consumerKey || !credentials.consumerSecret) {
    return {
      ok: false,
      code: 'WC_TEST_SETTINGS_INCOMPLETE',
      message: 'برای آزمایش اتصال، نشانی فروشگاه و هر دو کلید ووکامرس لازم است. اگر کلیدها هنوز ذخیره نشده‌اند، مدیر سیستم باید آن‌ها را در همین زبانه وارد و ذخیره کند.',
    };
  }
  if (usesStoredKeys && storeUrlKey(url) !== storeUrlKey(storedUrl)) {
    return {
      ok: false,
      code: 'WC_TEST_STORED_KEYS_OTHER_URL',
      message: 'کلیدهای ذخیره‌شده ووکامرس فقط با نشانی فروشگاه ذخیره‌شده آزموده می‌شوند. برای آزمودن نشانی دیگر، هر دو کلید همان فروشگاه را وارد کنید.',
    };
  }
  return { ok: true, credentials, usesStoredKeys };
}
