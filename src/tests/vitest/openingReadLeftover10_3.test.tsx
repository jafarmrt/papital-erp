import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { appQueryClient } from './helpers/queryWrapper';
import { READ_ON_EVERY_OPENING, useOpeningRead } from '../../hooks/queries/readOnEveryOpening';

/**
 * 10.3 (review of part 16): a window that stays mounted only disables its query when it closes, so a read still running
 * went on and the next opening joined it: that opening showed an answer read before it opened (a customer added in
 * between was missing) and sent no read of its own. Such a read now never counts; once it ends, the opening reads again.
 */
type Answer = { value: string };
const server = { value: 'first', fail: false };
const pending: Array<{ resolve: (a: Answer) => void; reject: (e: Error) => void }> = [];
const hold = { next: false };
const read = vi.fn(async (): Promise<Answer> => {
  if (hold.next) {
    hold.next = false;
    return new Promise((resolve, reject) => { pending.push({ resolve, reject }); });
  }
  if (server.fail) throw new Error('server refused the read');
  return { value: server.value };
});

afterEach(() => {
  cleanup();
  read.mockClear();
  pending.length = 0;
  Object.assign(server, { value: 'first', fail: false });
  hold.next = false;
});

function windowOf(client: QueryClient = appQueryClient(), open = true) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(({ isOpen }: { isOpen: boolean }) => useOpeningRead(useQuery({
    queryKey: ['opening-read-leftover'], queryFn: read, enabled: isOpen, ...READ_ON_EVERY_OPENING,
  }), isOpen), { wrapper, initialProps: { isOpen: open } });
}

describe('an opening never counts a read that began before it (10.3)', () => {
  it('a reopening while the earlier read still runs waits for it, then reads again and shows only its own answer', async () => {
    hold.next = true;
    const { result, rerender } = windowOf();
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ isOpen: false });
    server.value = 'with the customer added meanwhile';
    rerender({ isOpen: true });
    expect(read).toHaveBeenCalledTimes(1);
    hold.next = true;
    await act(async () => { pending[0]?.resolve({ value: 'first' }); });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    // the earlier read's answer is in the cache now, and never shown for this opening
    expect(result.current.data).toBeUndefined();
    await act(async () => { pending[1]?.resolve({ value: server.value }); });
    await waitFor(() => expect(result.current.data).toEqual({ value: 'with the customer added meanwhile' }));
    expect(result.current.current).toEqual({ value: 'with the customer added meanwhile' });
  });

  it('a failure of the earlier read is not this opening\'s; its own read answers', async () => {
    hold.next = true;
    const { result, rerender } = windowOf();
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ isOpen: false });
    rerender({ isOpen: true });
    server.value = 'second';
    await act(async () => { pending[0]?.reject(new Error('the earlier read failed')); });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(result.current.failedAt).toBe(0);
    await waitFor(() => expect(result.current.data).toEqual({ value: 'second' }));
    expect(result.current.error).toBeNull();
  });

  it('an earlier read that ended while the window was closed costs no extra read', async () => {
    hold.next = true;
    const { result, rerender } = windowOf();
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ isOpen: false });
    await act(async () => { pending[0]?.resolve({ value: 'first' }); });
    await new Promise(resolve => setTimeout(resolve, 20));
    server.value = 'second';
    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.data).toEqual({ value: 'second' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('each plain opening reads once and shows its own answer', async () => {
    const { result, rerender } = windowOf();
    await waitFor(() => expect(result.current.data).toEqual({ value: 'first' }));
    rerender({ isOpen: false });
    expect(result.current.data).toBeUndefined();
    server.value = 'second';
    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.data).toEqual({ value: 'second' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a failed read of this opening is said, and a later read clears it', async () => {
    server.fail = true;
    const client = appQueryClient();
    const { result } = windowOf(client);
    await waitFor(() => expect(result.current.failedAt).toBeGreaterThan(0));
    expect((result.current.error as Error).message).toBe('server refused the read');
    server.fail = false;
    await act(async () => { await client.invalidateQueries({ queryKey: ['opening-read-leftover'] }); });
    await waitFor(() => expect(result.current.data).toEqual({ value: 'first' }));
    expect(result.current.error).toBeNull();
  });
});
