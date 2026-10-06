import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Customer } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import { CustomerDossierDrawer } from '../../components/crm/CustomerDossierDrawer';

const customer = { id: 7, name: 'علی کاظمی', phone: '09121110001', partyType: 'customer', version: 1 } as Customer;
const doc = (id: number, type: string, status: string) => ({ id, refNumber: `S-${id}`, type, status, date: '2026-10-01', currency: 'IRR', payableAmount: 1_000_000 });
const docs = [doc(1, 'invoice', 'final'), doc(2, 'invoice', 'proforma'), doc(3, 'invoice', 'draft'), doc(4, 'return', 'final')];

function apiResponse(url: string): unknown {
  if (url.startsWith('/customers/7/documents')) return { data: docs, total: docs.length, page: 1, totalPages: 1 };
  if (url === '/customers/7/account-card') return { items: [], totalDebit: 0, totalCredit: 0, finalBalance: 0, currency: 'IRR' };
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

// v9.0.6 (TD-417، تصمیم مالک محصول ت۱ الف): اسناد پرونده با شناسه طرف حساب از سرور، نه جست‌وجوی متنی نام
describe('customer dossier documents (TD-417)', () => {
  it('loads the sales documents of the party by id and labels each one by its own type and status', async () => {
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
    await waitFor(() => expect(calledUrls()).toContain('/customers/7/documents?limit=50'));
    expect(calledUrls().filter(u => u.startsWith('/documents'))).toEqual([]);

    fireEvent.click(await screen.findByText(/پیش‌فاکتورها و اسناد/));
    const rowOf = async (ref: string) => (await screen.findByText(`#${ref}`)).closest('tr') as HTMLElement;
    expect(within(await rowOf('S-1')).getByText('فاکتور فروش')).toBeTruthy();
    expect(within(await rowOf('S-1')).getByText('نهایی')).toBeTruthy();
    expect(within(await rowOf('S-2')).getAllByText('پیش‌فاکتور').length).toBe(2);
    expect(within(await rowOf('S-3')).getByText('پیش‌نویس')).toBeTruthy();
    expect(within(await rowOf('S-4')).getByText('برگشت از فروش')).toBeTruthy();
    expect(screen.queryByText('فاکتور نهایی')).toBeNull();
  });
});
