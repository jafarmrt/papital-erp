import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (package 2 part 17): a customer save, a customer delete and a sales file turned into a customer refreshed only one
 * side: the customer lists or the sales files. The sales files and the dashboard show the customer's name, and the invoice
 * form a conversion opens picks its buyer from the customer lists, so each write now refreshes all three.
 */
const fetchJson = vi.fn(async (_url: string, _opts?: { method?: string }) => ({ success: true, customer: { id: 7 } }));
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: { method?: string }) => fetchJson(url, opts), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { useConvertLeadToCustomerMutation, useDeleteCustomerMutation, useSaveCustomerMutation } from '../../hooks/queries/useCustomerQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => { cleanup(); fetchJson.mockClear(); });

async function keysRefreshedBy(run: (client: ReturnType<typeof appQueryClient>) => Promise<unknown>) {
  const client = appQueryClient();
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  await run(client);
  return invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
}
const hookIn = <T,>(client: ReturnType<typeof appQueryClient>, hook: () => T) =>
  renderHook(hook, { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) }).result;

const REFRESHED = [QUERY_KEYS.customers.all, QUERY_KEYS.crm.all, QUERY_KEYS.dashboard.all].map(k => JSON.stringify(k));

describe('customer writes refresh every screen that shows the customer (10.3)', () => {
  it('a customer save', async () => {
    const keys = await keysRefreshedBy(async client => {
      const save = hookIn(client, useSaveCustomerMutation);
      await act(async () => { await save.current.mutateAsync({ id: 3, payload: { name: 'renamed' } }); });
    });
    expect(keys).toEqual(expect.arrayContaining(REFRESHED));
  });

  it('a customer delete', async () => {
    const keys = await keysRefreshedBy(async client => {
      const remove = hookIn(client, useDeleteCustomerMutation);
      await act(async () => { await remove.current.mutateAsync(3); });
    });
    expect(keys).toEqual(expect.arrayContaining(REFRESHED));
  });

  it('a sales file turned into a customer', async () => {
    const keys = await keysRefreshedBy(async client => {
      const convert = hookIn(client, useConvertLeadToCustomerMutation);
      await act(async () => { await convert.current.mutateAsync(11); });
    });
    expect(keys).toEqual(expect.arrayContaining(REFRESHED));
    expect(fetchJson).toHaveBeenCalledWith('/crm/leads/11/convert-to-customer', { method: 'POST' });
  });
});
