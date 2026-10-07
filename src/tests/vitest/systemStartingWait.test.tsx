import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { fetchJson, setCsrfToken } from '../../api';
import { resetSubmissionKeys } from '../../lib/submissionKey';
import { isSystemStarting, resetSystemStarting } from '../../lib/systemStarting';
import { SystemStartingOverlay } from '../../components/common/SystemStartingOverlay';

// TD-584 (decision ت۲): while the server finishes an update it answers 503 SYSTEM_STARTING; the browser shows a
// waiting page and sends the same request again instead of showing an error.
const fetchMock = vi.fn();

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const starting = () => reply(503, { code: 'SYSTEM_STARTING', message: 'سامانه در حال به‌روزرسانی است؛ چند لحظه دیگر دوباره تلاش کنید' }, { 'Retry-After': '1' });

beforeEach(() => {
  setCsrfToken('csrf-test');
  resetSubmissionKeys();
  resetSystemStarting();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setCsrfToken(null);
});

describe('system starting answers (TD-584)', () => {
  it('waits through SYSTEM_STARTING and returns the answer of the resent request', async () => {
    fetchMock.mockResolvedValueOnce(starting()).mockResolvedValueOnce(reply(200, { ok: 1 }));
    render(<SystemStartingOverlay />);
    const pending = fetchJson<{ ok: number }>('/auth/me');
    expect(await screen.findByText('سامانه در حال به‌روزرسانی است')).toBeTruthy();
    expect(isSystemStarting()).toBe(true);
    await act(async () => { await expect(pending).resolves.toEqual({ ok: 1 }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isSystemStarting()).toBe(false);
    expect(screen.queryByText('سامانه در حال به‌روزرسانی است')).toBeNull();
  });

  it('resends a mutation with the same idempotency key', async () => {
    fetchMock.mockResolvedValueOnce(starting()).mockResolvedValueOnce(reply(201, { id: 7 }));
    await expect(fetchJson('/accounting/treasury', { method: 'POST', body: JSON.stringify({ amount: 5 }) })).resolves.toEqual({ id: 7 });
    const key = (call: number) => (fetchMock.mock.calls[call][1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
    expect(key(0)).toBeTruthy();
    expect(key(1)).toBe(key(0));
  });

  it('a 503 without SYSTEM_STARTING is an error at once', async () => {
    fetchMock.mockResolvedValue(reply(503, { code: 'DB_DOWN', message: 'پایگاه داده در دسترس نیست' }));
    await expect(fetchJson('/auth/me')).rejects.toThrow('پایگاه داده در دسترس نیست');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isSystemStarting()).toBe(false);
  });

  it('an aborted request stops waiting and closes the waiting page', async () => {
    fetchMock.mockResolvedValue(starting());
    const controller = new AbortController();
    const pending = fetchJson('/auth/me', { signal: controller.signal });
    await vi.waitFor(() => expect(isSystemStarting()).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(isSystemStarting()).toBe(false);
  });
});
