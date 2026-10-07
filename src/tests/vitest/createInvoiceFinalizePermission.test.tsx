import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import type { User } from '../../types';

// v9.0.125 (TD-541 / TD-771): گزینه «فاکتور نهایی» صفحه صدور فاکتور با مجوز «قطعی کردن سند فروش» باز است، نه با کد نقش
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => granted.has(key) }));

function respond(url: string): unknown {
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  if (url === '/customers?limit=1000') return { data: [] };
  if (url === '/documents?status=proforma&limit=1000') return { data: [] };
  if (url === '/documents/next-ref?type=invoice') return { nextRef: 'INV-1001' };
  if (url.startsWith('/drafts/')) return { draft: null };
  return [];
}

function renderAs(role: string, permissions: string[]) {
  granted.clear();
  permissions.forEach(p => granted.add(p));
  fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
  const user: User = { id: 7, username: 'seller', full_name: 'کاربر آزمون', role };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CreateInvoicePage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function statusSelect(): Promise<HTMLSelectElement> {
  const finalOption = await screen.findByRole('option', { name: /فاکتور نهایی/ });
  return finalOption.closest('select') as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('CreateInvoicePage — final invoice by permission (TD-541)', () => {
  it('a custom role with documents.finalize may record a final invoice and starts on it', async () => {
    renderAs('branch_seller', ['documents.view', 'documents.create', 'documents.finalize']);
    const select = await statusSelect();
    const finalOption = screen.getByRole('option', { name: /فاکتور نهایی/ }) as HTMLOptionElement;
    expect(finalOption.disabled).toBe(false);
    await waitFor(() => expect(select.value).toBe('final'));
  });

  it('a role coded manager without documents.finalize records only proformas and is told which permission is missing', async () => {
    renderAs('manager', ['documents.view', 'documents.create']);
    const select = await statusSelect();
    const finalOption = screen.getByRole('option', { name: /فاکتور نهایی/ }) as HTMLOptionElement;
    expect(finalOption.disabled).toBe(true);
    expect(finalOption.textContent).toContain('قطعی کردن سند فروش');
    expect(select.value).toBe('proforma');
  });

  it('the system admin always may record a final invoice', async () => {
    renderAs('admin', []);
    const finalOption = (await screen.findByRole('option', { name: /فاکتور نهایی/ })) as HTMLOptionElement;
    expect(finalOption.disabled).toBe(false);
  });
});
