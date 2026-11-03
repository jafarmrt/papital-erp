// @vitest-environment node
/**
 * v11 phase 8.4a (docs/roadmap/V11_STOREFRONT_8_4_SMS_START_PLAN.md): the site's SMS rules and the provider client.
 * The client sends each provider's template call (sms.ir with the key in a header, Kavenegar with the key in its address
 * by design), reads success only from the provider's own status, never puts the key in an error, refuses redirects,
 * marks only a missing answer, 429 or 5xx as worth another try, and points at a test server only on a loopback origin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OTP_CODE_LENGTH, SMS_KINDS, SMS_KIND_PARAMS, SMS_KIND_SUGGESTED_TEXT, apiKeyError, maskedMobile, normalizeOtpCode, smsParamValue,
  suggestedTemplateText, templateIdError,
} from '../../lib/storefront/storefrontSmsRules';
import { SMS_TEST_API_BASE_ENV, sendTemplateSms, smsApiBase, smsTestApiBase } from '../../services/storefront/storefrontSmsClient';

const KEY = 'AbCdEf0123456789SecretKeyValue';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

describe('SMS rules', () => {
  it('no message names an amount, a price or a buyer', () => {
    for (const kind of SMS_KINDS) {
      expect(SMS_KIND_SUGGESTED_TEXT[kind]).not.toMatch(/ریال|تومان|مبلغ\s*\{|نام/);
      expect(SMS_KIND_PARAMS[kind].every(p => ['CODE', 'ORDER', 'TRACKING'].includes(p))).toBe(true);
    }
  });
  it('writes the placeholders the way each panel does', () => {
    expect(suggestedTemplateText('order_shipped', 'smsir')).toContain('#ORDER#');
    expect(suggestedTemplateText('order_shipped', 'smsir')).toContain('#TRACKING#');
    expect(suggestedTemplateText('order_shipped', 'kavenegar')).toContain('%token%');
    expect(suggestedTemplateText('order_shipped', 'kavenegar')).toContain('%token2%');
    expect(suggestedTemplateText('otp', 'kavenegar')).toContain('%token%');
  });
  it('checks a template id by the provider', () => {
    expect(templateIdError('smsir', '123456')).toBeNull();
    expect(templateIdError('smsir', 'login')).not.toBeNull();
    expect(templateIdError('kavenegar', 'papital-login')).toBeNull();
    expect(templateIdError('kavenegar', 'ورود')).not.toBeNull();
    expect(templateIdError('kavenegar', '')).toBeNull();
  });
  it('takes a pasted key and refuses spaces', () => {
    expect(apiKeyError(KEY)).toBeNull();
    expect(apiKeyError('abc def ghi')).not.toBeNull();
    expect(apiKeyError('')).toBeNull();
  });
  it('reads a login code in any digits and only at its length', () => {
    expect(OTP_CODE_LENGTH).toBe(5);
    expect(normalizeOtpCode('۱۲۳۴۵')).toBe('12345');
    expect(normalizeOtpCode('١٢٣ ٤٥')).toBe('12345');
    expect(normalizeOtpCode('1234')).toBeNull();
    expect(normalizeOtpCode('12a45')).toBeNull();
  });
  it('drops spaces from a tracking code and hides the middle of a phone', () => {
    expect(smsParamValue(' 1234 5678 ')).toBe('12345678');
    expect(maskedMobile('09121234567')).toBe('0912***4567');
  });
});

describe('SMS client', () => {
  it('sms.ir: the verify call with the key in its header; status 1 is success', async () => {
    const calls = stubFetch(200, { status: 1, message: 'موفق', data: { messageId: 987654, cost: 1 } });
    const res = await sendTemplateSms({ provider: 'smsir', apiKey: KEY, template: '123456', kind: 'order_shipped', phone: '09121234567', params: { ORDER: '100001', TRACKING: '777' } });
    expect(res).toMatchObject({ ok: true, messageId: '987654', error: '' });
    expect(calls[0].url).toBe('https://api.sms.ir/v1/send/verify');
    expect(calls[0].init.redirect).toBe('manual');
    expect((calls[0].init.headers as Record<string, string>)['X-API-KEY']).toBe(KEY);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      mobile: '09121234567', templateId: 123456, parameters: [{ name: 'ORDER', value: '100001' }, { name: 'TRACKING', value: '777' }],
    });
  });
  it('sms.ir: an answer 200 with another status is a failure, not a success', async () => {
    stubFetch(200, { status: 0, message: 'اعتبار کافی نیست', data: null });
    const res = await sendTemplateSms({ provider: 'smsir', apiKey: KEY, template: '1', kind: 'otp', phone: '09121234567', params: { CODE: '12345' } });
    expect(res).toMatchObject({ ok: false, error: 'اعتبار کافی نیست', retryable: false });
  });
  it('Kavenegar: the lookup call with numbered tokens; return.status 200 is success', async () => {
    const calls = stubFetch(200, { return: { status: 200, message: 'تایید شد' }, entries: [{ messageid: 8792343, status: 5 }] });
    const res = await sendTemplateSms({ provider: 'kavenegar', apiKey: KEY, template: 'papital-ship', kind: 'order_shipped', phone: '09121234567', params: { ORDER: '100001', TRACKING: '777' } });
    expect(res).toMatchObject({ ok: true, messageId: '8792343' });
    expect(calls[0].url).toBe(`https://api.kavenegar.com/v1/${KEY}/verify/lookup.json`);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(Object.fromEntries(form)).toEqual({ receptor: '09121234567', template: 'papital-ship', token: '100001', token2: '777' });
  });
  it('never puts the key in an error, even when a provider echoes it or the network fails', async () => {
    stubFetch(401, { return: { status: 401, message: `apikey ${KEY} is not valid` } });
    const res = await sendTemplateSms({ provider: 'kavenegar', apiKey: KEY, template: 't', kind: 'otp', phone: '09121234567', params: { CODE: '12345' } });
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain(KEY);
    expect(res.retryable).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`fetch failed for ${url}`); }));
    const down = await sendTemplateSms({ provider: 'kavenegar', apiKey: KEY, template: 't', kind: 'otp', phone: '09121234567', params: { CODE: '12345' } });
    expect(down).toMatchObject({ ok: false, status: 0, error: 'network error', retryable: true });
  });
  it('a 429 or a 5xx is worth another try; a 4xx is not', async () => {
    stubFetch(503, {});
    expect((await sendTemplateSms({ provider: 'smsir', apiKey: KEY, template: '1', kind: 'otp', phone: '09121234567', params: { CODE: '1' } })).retryable).toBe(true);
    stubFetch(429, {});
    expect((await sendTemplateSms({ provider: 'smsir', apiKey: KEY, template: '1', kind: 'otp', phone: '09121234567', params: { CODE: '1' } })).retryable).toBe(true);
    stubFetch(400, { status: 10, message: 'bad' });
    expect((await sendTemplateSms({ provider: 'smsir', apiKey: KEY, template: '1', kind: 'otp', phone: '09121234567', params: { CODE: '1' } })).retryable).toBe(false);
  });
  it('the test server is used only on a plain loopback origin', () => {
    expect(smsTestApiBase('http://127.0.0.1:4567')).toBe('http://127.0.0.1:4567');
    expect(smsTestApiBase('https://127.0.0.1:4567')).toBeNull();
    expect(smsTestApiBase('http://example.com')).toBeNull();
    expect(smsTestApiBase('http://127.0.0.1:4567/path')).toBeNull();
    vi.stubEnv(SMS_TEST_API_BASE_ENV, 'http://evil.example');
    expect(smsApiBase('smsir')).toBe('https://api.sms.ir');
    vi.stubEnv(SMS_TEST_API_BASE_ENV, 'http://localhost:9999');
    expect(smsApiBase('kavenegar')).toBe('http://localhost:9999/kavenegar');
  });
});
