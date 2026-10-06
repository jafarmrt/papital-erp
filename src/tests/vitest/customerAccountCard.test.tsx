import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useCRMData: () => ({ leads: [], activities: [] }),
}));
vi.mock('../../components/crm/crmSharedHosts', () => ({
  CrmInteractionModalHost: () => null,
  CrmCustomerDossierHost: () => null,
}));

import CustomersPage from '../../pages/CustomersPage';
import { CustomerDossierDrawer } from '../../components/crm/CustomerDossierDrawer';

const user: User = { id: 1, username: 'sales', full_name: 'فروشنده آزمون', role: 'sales' };
const customer = { id: 7, name: 'علی کاظمی', phone: '09121110001', partyType: 'both', version: 1 } as Customer;
const card = {
  items: [{ voucherId: 1, voucherNumber: 1, date: '2026-10-01', description: 'فروش', accountName: 'دریافتنی', accountCode: '1201', detailedId: 7, debit: 1_000_000, credit: 0, runningBalance: 1_000_000 }],
  totalDebit: 1_000_000,
  totalCredit: 0,
  finalBalance: 1_000_000,
  currency: 'IRR',
};

function apiResponse(url: string): unknown {
  if (url.startsWith('/customers?')) return { data: [customer], total: 1, page: 1, totalPages: 1 };
  if (url === '/customers/7/account-card') return { report: card, ...card };
  if (url.startsWith('/documents')) return { data: [] };
  return [];
}

const calledUrls = () => fetchJson.mock.calls.map(c => String(c[0]));

beforeEach(() => {
  fetchJson.mockImplementation((url: string) => Promise.resolve(apiResponse(url)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

// v9.0.4 (TD-416، تصمیم مالک محصول ت۱ الف): کارت حساب طرف حساب با شناسه او از سرور گرفته می‌شود، نه با نام «شامل»
describe('party account card by id (TD-416)', () => {
  it('the customers page «تراز مالی» card asks for the party by id, never by name', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CustomersPage user={user} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('تراز مالی'));
    await waitFor(() => expect(calledUrls()).toContain('/customers/7/account-card'));
    expect(calledUrls().filter(u => u.includes('account-card') && u !== '/customers/7/account-card')).toEqual([]);
    expect(await screen.findByText('مانده بدهکار (بدهی شخص به ما)')).toBeTruthy();
  });

  it('the customer dossier loads the same card by id', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CustomerDossierDrawer
          customer={customer}
          onClose={() => undefined}
          allLeads={[]}
          allActivities={[]}
          onOpenLeadDrawer={() => undefined}
          onOpenLeadModal={() => undefined}
          onOpenActivityModal={() => undefined}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calledUrls()).toContain('/customers/7/account-card'));
    expect(calledUrls().filter(u => u.includes('account-card') && u !== '/customers/7/account-card')).toEqual([]);
  });
});
