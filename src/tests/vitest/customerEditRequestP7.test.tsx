import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Customer, User } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
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

import CustomersPage from '../../pages/CustomersPage';

const user: User = { id: 1, username: 'sales', full_name: 'فروشنده آزمون', role: 'sales' };
const stored = { id: 7, name: 'گالری فیروزه', phone: '09121110001', partyType: 'customer', version: 4, notes: 'یادداشت ذخیره‌شده' } as Customer;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

// v10.2 package 7 (OBS-R2-24): «ویرایش» from a dossier on the sales page opens the party's full record read by id,
// never the pick-list row it was given (no version, no notes)
describe('customer_edit_request_by_id_obs_r2_24', () => {
  it('reads the full record by id instead of using the row passed in the address', async () => {
    fetchJson.mockImplementation((url: string) => {
      if (url === '/customers/7') return Promise.resolve(stored);
      if (url.startsWith('/customers?')) return Promise.resolve({ data: [], total: 0, page: 1, totalPages: 1 });
      return Promise.resolve([]);
    });
    const pickRow = { id: 7, name: 'نام کهنهٔ فهرست انتخاب' };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[{ pathname: '/customers', state: { editCustomerId: 7, editCustomer: pickRow } }]}>
          <CustomersPage user={user} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByDisplayValue('گالری فیروزه')).toBeTruthy();
    expect(screen.queryByDisplayValue('نام کهنهٔ فهرست انتخاب')).toBeNull();
    await waitFor(() => expect(fetchJson.mock.calls.filter((c) => c[0] === '/customers/7')).toHaveLength(1));
  });
});
