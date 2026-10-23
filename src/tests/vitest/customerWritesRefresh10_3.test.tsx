import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { appQueryClient } from './helpers/queryWrapper';
import type { User } from '../../types';

/**
 * 10.3 (package 2 part 17): a customer save, a customer delete and a sales file turned into a customer refreshed only one
 * side: the customer lists or the sales files. The sales files and the dashboard show the customer's name, and the invoice
 * form a conversion opens picks its buyer from the customer lists, so each write now refreshes all three. So does an
 * Excel import of customers.
 */
const fetchJson = vi.fn(async (url: string, _opts?: { method?: string }): Promise<unknown> =>
  url.startsWith('/customers?') ? { data: [], total: 0, page: 1, totalPages: 1 } : { success: true, customer: { id: 7 } });
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: { method?: string }) => fetchJson(url, opts), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../SearchContext', () => ({
  useSearch: () => ({ searchQuery: '', debouncedSearchQuery: '', setSearchQuery: () => undefined }),
}));
vi.mock('../../hooks/useCRMData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useCRMData')>()),
  useCRMData: () => ({ leads: [] }),
}));
vi.mock('../../components/crm/crmSharedHosts', () => ({
  CrmInteractionModalHost: () => null,
  CrmCustomerDossierHost: () => null,
  CrmLeadModalHost: () => null,
}));
const excel = { done: null as null | (() => void) };
vi.mock('../../components/customers/CustomerExcelModal', () => ({
  CustomerExcelModal: ({ onSuccess }: { onSuccess: () => void }) => { excel.done = onSuccess; return null; },
}));

import { useConvertLeadToCustomerMutation, useDeleteCustomerMutation, useSaveCustomerMutation } from '../../hooks/queries/useCustomerQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import CustomersPage from '../../pages/CustomersPage';

afterEach(() => { cleanup(); fetchJson.mockClear(); excel.done = null; });

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

  it('an Excel import of customers', async () => {
    const user: User = { id: 1, username: 'sales', full_name: 'sales tester', role: 'sales' };
    const keys = await keysRefreshedBy(async client => {
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/customers']}><CustomersPage user={user} /></MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(excel.done).not.toBeNull());
      await act(async () => { excel.done?.(); });
    });
    expect(keys).toEqual(expect.arrayContaining(REFRESHED));
  });
});

describe('a refused conversion is said once (10.3)', () => {
  it('the sales files page says it; the client\'s own notice for failed writes stays silent', async () => {
    fetchJson.mockRejectedValueOnce(new Error('server refused the conversion'));
    const clientNotice = vi.fn();
    const client = new QueryClient({ defaultOptions: { mutations: { onError: clientNotice } } });
    const convert = hookIn(client, useConvertLeadToCustomerMutation);
    await act(async () => { await expect(convert.current.mutateAsync(11)).rejects.toThrow('server refused the conversion'); });
    expect(clientNotice).not.toHaveBeenCalled();
  });
});
