import { SMS_KIND_PARAMS, type SmsKind, type SmsParams, type SmsProvider } from '../../lib/storefront/storefrontSmsRules.js';

/**
 * v11 phase 8.4a: the one client of the site's SMS services. Both send a template the provider approved (sms.ir
 * `POST /v1/send/verify` with the key in `X-API-KEY`; Kavenegar `POST /v1/<key>/verify/lookup.json`, whose key is part of
 * the address by its own design). The key is never logged, never put in an error and never returned: a network error is
 * reduced to its name, because an undici error may carry the request address. Every call has a timeout and refuses a
 * redirect. The hosts are fixed here; only the database tests point them at a server on the same machine
 * (`ERP_SMS_TEST_API_BASE`, a plain `http` loopback origin, anything else ignored), so a key never leaves for another host.
 */
export const SMS_API_BASE: Readonly<Record<SmsProvider, string>> = {
  smsir: 'https://api.sms.ir',
  kavenegar: 'https://api.kavenegar.com',
};
export const SMS_TEST_API_BASE_ENV = 'ERP_SMS_TEST_API_BASE';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DEFAULT_TIMEOUT_MS = 10_000;

export function smsTestApiBase(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  return url.origin;
}

export function smsApiBase(provider: SmsProvider, env: NodeJS.ProcessEnv = process.env): string {
  const testBase = smsTestApiBase(env[SMS_TEST_API_BASE_ENV]);
  return testBase ? `${testBase}/${provider}` : SMS_API_BASE[provider];
}

export interface SmsSendRequest {
  provider: SmsProvider;
  apiKey: string;
  template: string;
  kind: SmsKind;
  phone: string;
  params: SmsParams;
}

export interface SmsSendResult {
  ok: boolean;
  /** HTTP status; 0 when no answer came (network error, timeout) */
  status: number;
  messageId: string;
  /** the provider's own error text or code, or the network error's name (never the address or the key) */
  error: string;
  /** a later attempt may succeed (no answer, 429, 5xx) */
  retryable: boolean;
}

function networkErrorText(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  if (err instanceof Error && err.name === 'AbortError') return 'aborted';
  return 'network error';
}

/** The provider's own words, cut short and with the key taken out should a provider ever echo it */
function cleanError(text: unknown, apiKey: string): string {
  let value = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (apiKey && value.includes(apiKey)) value = value.split(apiKey).join('[REDACTED]');
  return value;
}

const retryableStatus = (status: number) => status === 0 || status === 429 || status >= 500;

async function post(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown } | { status: 0; error: string }> {
  try {
    const response = await fetch(url, { ...init, method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (err) {
    return { status: 0, error: networkErrorText(err) };
  }
}

/** The template's values in the kind's order: Kavenegar numbers them, sms.ir names them */
function orderedParams(kind: SmsKind, params: SmsParams): Array<{ name: string; value: string }> {
  return SMS_KIND_PARAMS[kind].map(name => ({ name, value: String(params[name] ?? '') }));
}

async function sendSmsir(req: SmsSendRequest, timeoutMs: number): Promise<SmsSendResult> {
  const res = await post(`${smsApiBase('smsir')}/v1/send/verify`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': req.apiKey },
    body: JSON.stringify({ mobile: req.phone, templateId: Number(req.template), parameters: orderedParams(req.kind, req.params) }),
  }, timeoutMs);
  if ('error' in res) return { ok: false, status: 0, messageId: '', error: res.error, retryable: true };
  const body = (res.body ?? {}) as { status?: unknown; message?: unknown; data?: { messageId?: unknown } | null };
  // sms.ir answers 200 with `status: 1` on success; any other status is its own error code
  const ok = res.status === 200 && Number(body.status) === 1;
  return {
    ok,
    status: res.status,
    messageId: ok ? String(body.data?.messageId ?? '') : '',
    error: ok ? '' : cleanError(body.message ?? `HTTP ${res.status}`, req.apiKey),
    retryable: !ok && retryableStatus(res.status),
  };
}

async function sendKavenegar(req: SmsSendRequest, timeoutMs: number): Promise<SmsSendResult> {
  const form = new URLSearchParams({ receptor: req.phone, template: req.template });
  orderedParams(req.kind, req.params).forEach((p, index) => form.set(index === 0 ? 'token' : `token${index + 1}`, p.value));
  const res = await post(`${smsApiBase('kavenegar')}/v1/${encodeURIComponent(req.apiKey)}/verify/lookup.json`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Accept: 'application/json' },
    body: form.toString(),
  }, timeoutMs);
  if ('error' in res) return { ok: false, status: 0, messageId: '', error: res.error, retryable: true };
  const body = (res.body ?? {}) as { return?: { status?: unknown; message?: unknown }; entries?: Array<{ messageid?: unknown }> };
  // Kavenegar repeats the HTTP status in `return.status`; 200 is success
  const ok = res.status === 200 && Number(body.return?.status) === 200;
  return {
    ok,
    status: res.status,
    messageId: ok ? String(body.entries?.[0]?.messageid ?? '') : '',
    error: ok ? '' : cleanError(body.return?.message ?? `HTTP ${res.status}`, req.apiKey),
    retryable: !ok && retryableStatus(res.status),
  };
}

export async function sendTemplateSms(req: SmsSendRequest, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SmsSendResult> {
  return req.provider === 'smsir' ? sendSmsir(req, timeoutMs) : sendKavenegar(req, timeoutMs);
}
