import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, setCsrfToken } from '../../api';
import { resetSubmissionKeys } from '../../lib/submissionKey';

// v9.0.296 (TD-670، B16-06، تصمیم ت۳-الف): پس از قطع ارتباط فقط GET خودکار دوباره فرستاده می‌شود
const fetchMock = vi.fn();
const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => null } });

beforeEach(() => {
  setCsrfToken('csrf-test');
  resetSubmissionKeys();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setCsrfToken(null);
});

describe('no automatic resend of a save after a lost connection (TD-670)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is sent once and reports an unconfirmed save', async (method) => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(ok({ id: 1 }));
    const call = fetchJson('/crm/activities', { method, body: JSON.stringify({ title: 'تماس' }) });
    await expect(call).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringContaining('وضعیت را بررسی کنید') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a GET is still resent once', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(ok({ data: [] }));
    await expect(fetchJson('/crm/activities')).resolves.toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
