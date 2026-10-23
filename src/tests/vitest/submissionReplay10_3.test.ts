import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast, toast }));

import { ApiError, fetchJson, setCsrfToken, UNCONFIRMED_MUTATION_MESSAGE } from '../../api';
import { resetSubmissionKeys, SUBMISSION_KEYS_STORAGE_KEY } from '../../lib/submissionKey';
import { IDEMPOTENT_REPLAY_MESSAGE, SUBMISSION_REPLAYED_EVENT } from '../../lib/idempotentReplay';
import { queryClient } from '../../lib/queryClient';

/**
 * 10.3 (ARCH review finding 1), the browser half: a key still waiting for its answer survives a reload of the page
 * (sessionStorage, no body text stored), and a write answered with the «already registered» notice is an error with
 * that notice that refreshes the open lists, unless the screen handles the notice itself (`acceptReplay`).
 * Red on v10.3.0: after a reload the resend took a new key, and the notice came back as a successful answer.
 */
const fetchMock = vi.fn();
const REPLAY = { success: true, idempotentReplay: true, message: IDEMPOTENT_REPLAY_MESSAGE };

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), headers: { get: () => null } };
}

const sentKey = (call: number): string => (fetchMock.mock.calls[call][1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
const receipt = () => ({ method: 'POST', body: JSON.stringify({ amount: 7_770_000, partyName: 'مشتری آزمون', bankAccountId: 3 }) });

beforeEach(() => {
  setCsrfToken('csrf-test');
  sessionStorage.clear();
  resetSubmissionKeys();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setCsrfToken(null);
  vi.clearAllMocks();
});

describe('unanswered submission keys survive a reload of the page (10.3)', () => {
  it('a resend after a lost answer and a reload carries the same key; the tab keeps no amount or name', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchJson('/accounting/treasury', receipt())).rejects.toThrow(UNCONFIRMED_MUTATION_MESSAGE);
    const lostKey = sentKey(0);

    const stored = sessionStorage.getItem(SUBMISSION_KEYS_STORAGE_KEY) ?? '';
    expect(stored).toContain(lostKey);
    for (const text of ['7770000', 'مشتری', 'treasury', 'amount']) expect(stored).not.toContain(text);

    resetSubmissionKeys(true); // the page reloads: memory is gone, the tab's storage stays
    fetchMock.mockResolvedValueOnce(reply(201, { id: 9 }));
    await fetchJson('/accounting/treasury', receipt());
    expect(sentKey(1)).toBe(lostKey);
    // answered: the key leaves the tab, and a deliberate new receipt with the same content is a new one
    expect(sessionStorage.getItem(SUBMISSION_KEYS_STORAGE_KEY)).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(201, { id: 10 }));
    await fetchJson('/accounting/treasury', receipt());
    expect(sentKey(2)).not.toBe(lostKey);
  });

  it('a damaged or unavailable storage leaves the keys in memory and never fails a send', async () => {
    sessionStorage.setItem(SUBMISSION_KEYS_STORAGE_KEY, '{not json');
    resetSubmissionKeys(true);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchJson('/accounting/treasury', receipt())).rejects.toThrow(UNCONFIRMED_MUTATION_MESSAGE);

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    try {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(fetchJson('/accounting/treasury', { method: 'POST', body: '{"amount":1}' })).rejects.toThrow(UNCONFIRMED_MUTATION_MESSAGE);
      fetchMock.mockResolvedValueOnce(reply(201, { id: 1 }));
      await fetchJson('/accounting/treasury', { method: 'POST', body: '{"amount":1}' });
      expect(sentKey(2)).toBe(sentKey(1));
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('the «already registered» notice (10.3)', () => {
  it('a write answered with the notice fails with it and refreshes the open lists', async () => {
    const replayed = vi.fn();
    window.addEventListener(SUBMISSION_REPLAYED_EVENT, replayed);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    try {
      fetchMock.mockResolvedValueOnce(reply(200, REPLAY));
      const err = await fetchJson('/documents', { method: 'POST', body: '{"docType":"receipt"}' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('IDEMPOTENT_REPLAY');
      expect((err as ApiError).message).toBe(IDEMPOTENT_REPLAY_MESSAGE);
      expect(replayed).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalled();
    } finally {
      window.removeEventListener(SUBMISSION_REPLAYED_EVENT, replayed);
      invalidate.mockRestore();
    }
  });

  it('a screen that handles the notice gets it as the answer; a read is never taken for one', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, REPLAY));
    await expect(fetchJson('/piecework/payrolls', { method: 'POST', body: '{}', acceptReplay: true })).resolves.toEqual(REPLAY);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('acceptReplay');
    fetchMock.mockResolvedValueOnce(reply(200, REPLAY));
    await expect(fetchJson('/some/list')).resolves.toEqual(REPLAY);
  });

  it('a mutation hook shows the notice as information, not as a failure', () => {
    const onError = queryClient.getDefaultOptions().mutations?.onError as unknown as (e: unknown) => void;
    onError(new ApiError(IDEMPOTENT_REPLAY_MESSAGE, 'IDEMPOTENT_REPLAY', 200));
    expect(toast).toHaveBeenCalledWith(IDEMPOTENT_REPLAY_MESSAGE, { icon: 'ℹ️' });
    expect(toast.error).not.toHaveBeenCalled();
    onError(new ApiError('موجودی کافی نیست', 'VALIDATION_ERROR', 422));
    expect(toast.error).toHaveBeenCalledWith('موجودی کافی نیست');
  });
});
