import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, setCsrfToken, IN_FLIGHT_STILL_RUNNING_MESSAGE } from '../../api';
import { resetSubmissionKeys, submissionKeyFor } from '../../lib/submissionKey';

// v9.0.297 (TD-679، B16-15): پس از پایان انتظار برای ۴۰۹ «در حال پردازش» کلید تکرار آزاد نمی‌شود
const fetchMock = vi.fn();
const inFlight = () => ({
  ok: false, status: 409,
  text: async () => JSON.stringify({ code: 'IDEMPOTENCY_IN_FLIGHT', error: 'درخواست تکراری در حال پردازش است.' }),
  headers: { get: (name: string) => (name === 'Retry-After' ? '0.001' : null) },
});

beforeEach(() => {
  vi.useFakeTimers();
  setCsrfToken('csrf-test');
  resetSubmissionKeys();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setCsrfToken(null);
});

describe('idempotency key kept while the server still runs the request (TD-679)', () => {
  it('keeps the key after the last wait so a resend asks for the same request', async () => {
    fetchMock.mockImplementation(async () => inFlight());
    const body = JSON.stringify({ year: 1404 });
    const call = fetchJson('/accounting/fiscal-closing/execute', { method: 'POST', body });
    const settled = expect(call).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_FLIGHT', message: IN_FLIGHT_STILL_RUNNING_MESSAGE });
    await vi.runAllTimersAsync();
    await settled;
    const sent = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
    expect(fetchMock.mock.calls.length).toBe(16);
    expect(submissionKeyFor('POST', '/accounting/fiscal-closing/execute', body)).toBe(sent);
  });
});
