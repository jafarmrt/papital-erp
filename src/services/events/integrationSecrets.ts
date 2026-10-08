import { ValidationError } from '../../errors/customErrors.js';
import { isMaskedSecret, maskHeaderValues, maskSecretValue } from '../../lib/secrets/maskedSecret.js';

/**
 * v9.0.339 (TD-710، B15-08، تصمیم مالک محصول ت۶ الف): کلید امضای وب‌هوک، توکن قانون وب‌هوک و مقدار سرآیندهای شریک
 * در هیچ پاسخی، برای هیچ کاربری حتی مدیر سیستم، نمی‌آیند. کلید امضا فقط یک بار، در پاسخ ساخت یا «ساخت کلید تازه»، دیده می‌شود.
 * پیش‌تر `GET /webhooks` فقط برای غیرمدیر کلید را می‌پوشاند و پاسخ toggle و PUT کلید کامل را می‌داد، و دارنده `events.view`
 * توکن API شریک (`customHeaders`) و توکن قانون (`actionConfigJson.secretToken`) را می‌دید.
 *
 * مقدار پوشیده «********» در ذخیره یعنی «مقدار ذخیره‌شده بماند»، و فقط برای همان نشانی مقصد: کسی که کلید را نمی‌بیند نباید
 * بتواند با تغییر نشانی، توکن ذخیره‌شده را به سایت خودش بفرستد (همان قاعده آزمایش اتصال ووکامرس، TD-723).
 */

type Row = Record<string, unknown>;

export const SECRET_REENTRY_MESSAGE = 'نشانی مقصد تغییر کرده است؛ مقدار پوشیده («********») فقط برای نشانی ذخیره‌شده نگه داشته می‌شود. توکن و مقدار سرآیندها را برای نشانی تازه دوباره وارد کنید.';

function headersOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Row).map(([name, v]) => [name, String(v ?? '')]));
}

function hasValues(headers: Record<string, string>): boolean {
  return Object.values(headers).some(v => v !== '');
}

/** اشتراک وب‌هوک برای پاسخ: کلید و مقدار سرآیندها پوشیده؛ `revealSecret` فقط در پاسخ ساخت و ساخت کلید تازه */
export function webhookSubscriptionView<T extends { secretKey?: string | null; customHeaders?: unknown }>(sub: T, options: { revealSecret?: boolean } = {}) {
  return {
    ...sub,
    secretKey: options.revealSecret ? (sub.secretKey ?? '') : maskSecretValue(sub.secretKey),
    customHeaders: maskHeaderValues(sub.customHeaders),
  };
}

/** قانون خودکار برای پاسخ: `secretToken` و مقدار `headers` تنظیمات اقدام پوشیده */
export function actionRuleView<T extends { actionConfigJson?: unknown }>(rule: T): T {
  const config = rule.actionConfigJson;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return rule;
  const masked: Row = { ...(config as Row) };
  if ('secretToken' in masked) masked.secretToken = maskSecretValue(masked.secretToken);
  if ('headers' in masked) masked.headers = maskHeaderValues(masked.headers);
  return { ...rule, actionConfigJson: masked };
}

/** سرآیندهای ذخیره: «********» = مقدار ذخیره‌شده همان سرآیند، فقط برای همان نشانی */
export function resolveMaskedHeaders(incoming: unknown, storedValue: unknown, sameTarget: boolean): Record<string, string> {
  const stored = headersOf(storedValue);
  const next = headersOf(incoming);
  for (const [name, value] of Object.entries(next)) {
    if (!isMaskedSecret(value)) continue;
    if (!(name in stored) || stored[name] === '') {
      throw new ValidationError(`برای سرآیند «${name}» مقداری ذخیره نشده است؛ مقدار آن را وارد کنید.`, undefined, 'INTEGRATION_SECRET_MASKED');
    }
    if (!sameTarget) throw new ValidationError(SECRET_REENTRY_MESSAGE, undefined, 'INTEGRATION_SECRET_REENTRY_REQUIRED');
    next[name] = stored[name];
  }
  return next;
}

/** نشانی تازه با سرآیندهای ذخیره‌شده‌ای که در بدنه نیامده‌اند: باید دوباره وارد شوند */
export function assertHeadersReenteredForNewTarget(storedValue: unknown, sameTarget: boolean): void {
  if (!sameTarget && hasValues(headersOf(storedValue))) {
    throw new ValidationError(SECRET_REENTRY_MESSAGE, undefined, 'INTEGRATION_SECRET_REENTRY_REQUIRED');
  }
}

/** تنظیمات اقدام قانون در ذخیره: توکن و سرآیند پوشیده از تنظیمات ذخیره‌شده، فقط با همان نشانی */
export function resolveRuleConfigSecrets(incoming: unknown, storedConfig: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const next: Row = { ...(incoming as Row) };
  const stored: Row = storedConfig && typeof storedConfig === 'object' && !Array.isArray(storedConfig) ? storedConfig as Row : {};
  const sameTarget = String(next.url ?? '').trim() === String(stored.url ?? '').trim();
  if (isMaskedSecret(next.secretToken)) {
    if (typeof stored.secretToken !== 'string' || stored.secretToken === '') {
      throw new ValidationError('برای این قانون توکنی ذخیره نشده است؛ توکن را وارد کنید یا کادر را خالی بگذارید.', undefined, 'INTEGRATION_SECRET_MASKED');
    }
    if (!sameTarget) throw new ValidationError(SECRET_REENTRY_MESSAGE, undefined, 'INTEGRATION_SECRET_REENTRY_REQUIRED');
    next.secretToken = stored.secretToken;
  }
  if (next.headers !== undefined) next.headers = resolveMaskedHeaders(next.headers, stored.headers, sameTarget);
  return next;
}
