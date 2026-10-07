import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CRMLead, Customer, User } from '../../types';

// v9.0.148 (TD-893، مدل مجوز §۴.۵): دکمه‌های افزودن، ویرایش و حذف طرف حساب، حذف پرونده فروش و تعریف کالا از فرم سند انبار
// با همان مجوز API نمایش داده می‌شوند، نه با کد نقش (`viewer`، `admin`، `manager`) یا «*».
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: () => false,
}));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
}));
vi.mock('../../SearchContext', () => ({
  useSearch: () => ({ searchQuery: '', debouncedSearchQuery: '', setSearchQuery: () => undefined }),
}));
vi.mock('../../components/crm/crmSharedHosts', () => ({
  CrmInteractionModalHost: () => null,
  CrmCustomerDossierHost: () => null,
}));

import CustomersPage from '../../pages/CustomersPage';
import DocumentsPage from '../../pages/DocumentsPage';
import { useCRMData } from '../../hooks/useCRMData';
import { CRMLeadsTable } from '../../components/crm/CRMLeadsTable';

const customer = { id: 7, name: 'علی کاظمی', phone: '09121110001', partyType: 'both', version: 1 } as Customer;
const lead = { id: 3, title: 'گردنبند عروس', customerName: 'علی کاظمی', stage: 'lead', estimatedValue: 0, currency: 'IRR' } as CRMLead;

function apiResponse(url: string): unknown {
  if (url.startsWith('/customers?')) return { data: [customer], total: 1, page: 1, totalPages: 1 };
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  if (url.startsWith('/items/options')) return { data: [] };
  if (url.startsWith('/projects/options')) return { success: true, data: [] };
  if (url === '/inventory/reserved-items') return { allReservationEntries: [] };
  if (url.startsWith('/documents/next-ref')) return { nextRef: 'RC-1' };
  return [];
}

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const userWithRole = (role: string): User => ({ id: 1, username: 'u', full_name: 'کاربر آزمون', role });

beforeEach(() => {
  granted.clear();
  fetchJson.mockImplementation((url: string) => Promise.resolve(apiResponse(url)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('party, sales file and stock form actions follow the API permission, not the role code (TD-893)', () => {
  it('the customers page offers add, edit and delete to a customers.manage holder even when its role code is viewer', async () => {
    granted.add('customers.manage');
    render(withClient(<CustomersPage user={userWithRole('viewer')} />));
    expect(await screen.findByText('علی کاظمی')).toBeTruthy();
    expect(screen.getByText('ثبت طرف حساب جدید')).toBeTruthy();
    expect(screen.getByTitle('ویرایش')).toBeTruthy();
    expect(screen.getByTitle('حذف')).toBeTruthy();
  });

  it('the customers page offers no add, edit or delete to a role without customers.manage', async () => {
    granted.add('customers.view');
    render(withClient(<CustomersPage user={userWithRole('sales_agent')} />));
    expect(await screen.findByText('علی کاظمی')).toBeTruthy();
    expect(screen.queryByText('ثبت طرف حساب جدید')).toBeNull();
    expect(screen.queryByTitle('ویرایش')).toBeNull();
    expect(screen.queryByTitle('حذف')).toBeNull();
  });

  it('a sales file can be deleted only by a crm.delete holder, whatever the role code', async () => {
    const asManager = renderHook(() => useCRMData(userWithRole('manager')), { wrapper: ({ children }) => withClient(children) });
    await waitFor(() => expect(asManager.result.current.loading).toBe(false));
    expect(asManager.result.current.canDeleteLead).toBe(false);
    asManager.unmount();

    granted.add('crm.delete');
    const withKey = renderHook(() => useCRMData(userWithRole('branch_sales')), { wrapper: ({ children }) => withClient(children) });
    await waitFor(() => expect(withKey.result.current.loading).toBe(false));
    expect(withKey.result.current.canDeleteLead).toBe(true);
  });

  it('the sales file list shows a delete button only when a delete handler is given', () => {
    const noop = () => undefined;
    const { unmount } = render(<CRMLeadsTable leads={[lead]} onOpenLeadDrawer={noop} onOpenActivityModal={noop} onOpenLeadModal={noop} />);
    expect(screen.getByTitle('ویرایش')).toBeTruthy();
    expect(screen.queryByTitle('حذف')).toBeNull();
    unmount();
    render(<CRMLeadsTable leads={[lead]} onOpenLeadDrawer={noop} onOpenActivityModal={noop} onOpenLeadModal={noop} onDeleteLead={noop} />);
    expect(screen.getByTitle('حذف')).toBeTruthy();
  });

  it('the stock document form offers item definition only to products.create or products.edit holders, not to the manager code', async () => {
    const { unmount } = render(withClient(<DocumentsPage user={userWithRole('manager')} />));
    expect(await screen.findByDisplayValue('RC-1')).toBeTruthy();
    expect(screen.queryByText('تعریف کالا / افزودن تصویر کالا')).toBeNull();
    unmount();

    granted.add('products.create');
    render(withClient(<DocumentsPage user={userWithRole('storekeeper')} />));
    expect(await screen.findByDisplayValue('RC-1')).toBeTruthy();
    expect(screen.getByText('تعریف کالا / افزودن تصویر کالا')).toBeTruthy();
  });
});
