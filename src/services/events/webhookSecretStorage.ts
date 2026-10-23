import { AppError } from '../../errors/customErrors.js';
import { decryptSecret, encryptSecret } from '../../lib/secretBox.js';

/**
 * v9.0.361 (TD-898، مشاهده ۱۱ بسته ۱۵، تصمیم مالک محصول ت۷ الف): کلید امضای اشتراک وب‌هوک و مقدار هر سرآیند سفارشی
 * (توکن API شریک) با `encryptSecret` (قاعده AGENTS §5، کلید `ERP_SECRETS_KEY`) ذخیره می‌شوند و فقط درون کارساز باز می‌شوند.
 * پیش‌تر هر دو متن ساده در `webhook_subscriptions` بودند و هر نسخه پشتیبان یا خواننده پایگاه‌داده آن‌ها را می‌دید.
 * نام سرآیندها پنهان نیست و ساده می‌ماند. مقدار ساده قدیمی همان‌طور خوانده می‌شود تا `npm run secrets:encrypt` آن را رمز کند؛
 * بدون کلید، کلید یا سرآیند تازه ذخیره نمی‌شود (503). مقدار رمزشده‌ای که با کلید فعلی باز نمی‌شود هرگز فرستاده نمی‌شود.
 */

export const UNREADABLE_WEBHOOK_SECRET_MESSAGE = 'کلید امضا یا سرآیندهای این درگاه با کلید رمزنگاری فعلی سرور (ERP_SECRETS_KEY) باز نمی‌شود. کلید درست را به سرور برگردانید، یا «ساخت کلید تازه» را بزنید و سرآیندها را دوباره وارد کنید.';

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

/**
 * OBS-PR-07 (decision ت۴۰ item 2): an action rule's webhook token (`actionConfigJson.secretToken`) and header values are
 * stored like a subscription's, with `encryptSecret`, and opened only inside the server. A legacy plain value is read as
 * it is until `npm run secrets:encrypt -- --apply`; a value the current key cannot open is never sent.
 */
export const UNREADABLE_RULE_SECRET_MESSAGE = 'توکن یا سرآیندهای این قانون خودکار با کلید رمزنگاری فعلی سرور (ERP_SECRETS_KEY) باز نمی‌شود. کلید درست را به سرور برگردانید، یا توکن و سرآیندها را در قانون دوباره وارد کنید.';

type RuleConfig = Record<string, unknown>;

const ruleConfigOf = (config: unknown): RuleConfig | null =>
  config && typeof config === 'object' && !Array.isArray(config) ? config as RuleConfig : null;

/** plain token and header values of a rule's action settings ← stored ones; 503 without the key when there is a secret */
export function sealRuleConfig(config: unknown): unknown {
  const source = ruleConfigOf(config);
  if (!source) return config;
  const sealed: RuleConfig = { ...source };
  if (typeof sealed.secretToken === 'string') sealed.secretToken = encryptSecret(sealed.secretToken);
  if (sealed.headers !== undefined) sealed.headers = sealHeaders(sealed.headers);
  return sealed;
}

/** stored action settings ← plain ones for use inside the server; a value the key cannot open is emptied and named */
export function openRuleConfig(config: unknown): { config: unknown; unreadableSecrets: string[] } {
  const source = ruleConfigOf(config);
  if (!source) return { config, unreadableSecrets: [] };
  const unreadableSecrets: string[] = [];
  const opened: RuleConfig = { ...source };
  if (typeof opened.secretToken === 'string') {
    const token = decryptSecret(opened.secretToken);
    if (token === null) unreadableSecrets.push('secretToken');
    opened.secretToken = token ?? '';
  }
  if (opened.headers !== undefined) {
    const headers: HeaderMap = {};
    for (const [name, value] of Object.entries(headersOf(opened.headers))) {
      const plain = decryptSecret(value);
      if (plain === null) unreadableSecrets.push(`headers.${name}`);
      headers[name] = plain ?? '';
    }
    opened.headers = headers;
  }
  return { config: opened, unreadableSecrets };
}
