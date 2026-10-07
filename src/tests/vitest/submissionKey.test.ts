import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, setCsrfToken } from '../../api';
import { resetSubmissionKeys } from '../../lib/submissionKey';

// TD-329: کلید تکرار درخواست مرورگر از محتوای ارسال ساخته می‌شود و تا پاسخ قطعی همان می‌ماند؛ ۴۰۹ «در حال پردازش» با همان کلید منتظر نتیجه می‌ماند.
const fetchMock = vi.fn();

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => headers[name] ?? null },
  };
}

const sentKey = (call: number): string => (fetchMock.mock.calls[call][1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
const pay = (amount: number) => ({ method: 'POST', body: JSON.stringify({ amount, bankAccountId: 3 }) });

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

describe('کلید تکرار درخواست از محتوای ارسال (TD-329)', () => {
  it('دو ارسال هم‌زمان یک محتوا یک کلید می‌گیرند و محتوای دیگر کلید دیگر', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async () => { await gate; return reply(201, { id: 1 }); });
    const first = fetchJson('/accounting/treasury', pay(1000));
    const second = fetchJson('/accounting/treasury', pay(1000));
    const other = fetchJson('/accounting/treasury', pay(2000));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    release();
    await Promise.all([first, second, other]);
    expect(sentKey(0)).toBe(sentKey(1));
    expect(sentKey(2)).not.toBe(sentKey(0));
  });

  it('ارسال دوباره پس از خطای شبکه همان کلید را دارد و پس از پاسخ موفق کلید تازه', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchJson('/accounting/treasury', pay(500))).rejects.toThrow('ارتباط با کارساز برقرار نشد');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentKey(1)).toBe(sentKey(0));

    const lostKey = sentKey(0);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reply(201, { id: 7 }));
    await fetchJson('/accounting/treasury', pay(500));
    await fetchJson('/accounting/treasury', pay(500));
    expect(sentKey(0)).toBe(lostKey);
    expect(sentKey(1)).not.toBe(lostKey);
  });

  it('پاسخ ۴۰۹ «در حال پردازش» با همان کلید منتظر نتیجه درخواست اول می‌ماند', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { code: 'IDEMPOTENCY_IN_FLIGHT', error: 'درخواست تکراری در حال پردازش است.' }, { 'Retry-After': '0.5' }))
      .mockResolvedValueOnce(reply(201, { id: 12, amount: 300 }));
    const result = await fetchJson<{ id: number }>('/accounting/treasury', pay(300));
    expect(result.id).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentKey(1)).toBe(sentKey(0));
  });

  it('پاسخ خطای برنامه کلید را آزاد می‌کند و options فراخواننده تغییر نمی‌کند', async () => {
    const options = pay(400);
    fetchMock.mockResolvedValueOnce(reply(422, { error: 'موجودی کافی نیست', code: 'VALIDATION_ERROR' }));
    await expect(fetchJson('/accounting/treasury', options)).rejects.toThrow('موجودی کافی نیست');
    expect(options).toEqual(pay(400));
    fetchMock.mockResolvedValueOnce(reply(201, { id: 3 }));
    await fetchJson('/accounting/treasury', options);
    expect(sentKey(1)).not.toBe(sentKey(0));
  });
});
