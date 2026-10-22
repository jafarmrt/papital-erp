import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { resetSubmissionKeys, submissionKeyFor } from '../../lib/submissionKey';

// TD-1328: a form sent with files keeps one resubmission key until a definitive answer, and a request still running
// after half an hour keeps its key locked, so a repeat waits instead of running it a second time.

const extendLock = vi.fn(async () => undefined);
vi.mock('../../services/idempotency.service.js', () => ({
  IDEMPOTENCY_KEY_TTL_SECONDS: 86400,
  IdempotencyService: {
    acquireKey: vi.fn(async () => ({ state: 'acquired', action: 'PROCESS_NEW' })),
    extendLock,
    saveResponse: vi.fn(async () => undefined),
    releaseKey: vi.fn(async () => undefined),
  },
}));

function receiptForm(fileName: string, size: number): FormData {
  const form = new FormData();
  form.append('documentId', '17');
  form.append('file', new File(['x'.repeat(size)], fileName, { type: 'application/pdf', lastModified: 1_700_000_000_000 }));
  return form;
}

beforeEach(() => resetSubmissionKeys());
afterEach(() => {
  vi.useRealTimers();
  extendLock.mockClear();
});

describe('idempotency_keys_td_1328', () => {
  it('a form with files sent again keeps its key; another file or another field takes a new one', () => {
    const first = submissionKeyFor('POST', '/attachments', receiptForm('invoice.pdf', 10));
    expect(submissionKeyFor('POST', '/attachments', receiptForm('invoice.pdf', 10))).toBe(first);
    expect(submissionKeyFor('POST', '/attachments', receiptForm('invoice.pdf', 11))).not.toBe(first);
    expect(submissionKeyFor('POST', '/attachments', receiptForm('other.pdf', 10))).not.toBe(first);
    const file = new File(['abc'], 'scan.png', { type: 'image/png', lastModified: 1 });
    expect(submissionKeyFor('POST', '/upload', file)).toBe(submissionKeyFor('POST', '/upload', file));
  });

  it('a body that cannot be read without its content still takes a new key each time', () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    expect(submissionKeyFor('POST', '/upload', bytes)).not.toBe(submissionKeyFor('POST', '/upload', bytes));
  });

  it('the lock of a request still running after 30 minutes keeps being renewed', async () => {
    vi.useFakeTimers();
    const { idempotency } = await import('../../middleware/idempotency');
    const handler = idempotency({ scope: 'inventory', lockTimeoutSeconds: 60 });
    const req = { method: 'POST', headers: { 'idempotency-key': 'long-job' }, body: { a: 1 }, originalUrl: '/api/inventory/rebuild', baseUrl: '/api' } as unknown as Request;
    const res = { on: vi.fn(), setHeader: vi.fn(), json: vi.fn(), send: vi.fn(), statusCode: 200 } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    handler(req, res, next);
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(35 * 60 * 1000);
    const callsAt35 = extendLock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(extendLock.mock.calls.length).toBeGreaterThan(callsAt35);
  });

  it('a payslip answer and an answer over the limit are not kept with the key', async () => {
    const { keptResponseBody, IDEMPOTENCY_REPLAY_BODY, IDEMPOTENCY_RESPONSE_MAX_BYTES } = await import('../../middleware/idempotency');
    expect(keptResponseBody('payroll', { amount: 5 })).toBe(IDEMPOTENCY_REPLAY_BODY);
    expect(keptResponseBody('piecework', { amount: 5 })).toBe(IDEMPOTENCY_REPLAY_BODY);
    expect(keptResponseBody('documents', { id: 3 })).toEqual({ id: 3 });
    expect(keptResponseBody('documents', { text: 'x'.repeat(IDEMPOTENCY_RESPONSE_MAX_BYTES + 1) })).toBe(IDEMPOTENCY_REPLAY_BODY);
  });
});
