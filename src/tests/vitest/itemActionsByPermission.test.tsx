import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rialDisplayOf } from '../../lib/rialDisplay';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// v9.0.209 (O14 of package 5): the item and pricing pages show their buttons and price fields by the permission of the
// server route each one calls (products.create / edit / delete, woocommerce.manage, products.edit_price), never by the
// role code «viewer»; the average cost is always shown in rials (O11).
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
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') }));

import ItemsPage from '../../pages/ItemsPage';
import PricingPage from '../../pages/PricingPage';

const item = {
  id: 11, type: 'product', code: '1404-N-101-01', name: 'گردنبند لوتوس', category: 'گردنبند', unit: 'عدد',
  current_stock: 4, reorder_point: 0, weighted_average_cost: 1500000, stocks: {}, version: 1,
};

function apiResponse(url: string): unknown {
  if (url.startsWith('/items?')) return { data: [item], total: 1, page: 1, totalPages: 1 };
  if (url === '/items/prices/all') return { 11: [{ id: 1, itemId: 11, title: 'عمده', price: 2000000, currency: 'IRR' }] };
  if (url === '/settings') return [{ key: 'pricing_strategies', value: 'عمده' }];
  if (url === '/categories') return [{ id: 1, name: 'گردنبند', prefix: 'N', type: 'product', defaultUnit: 'عدد' }];
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  return [];
}

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

beforeEach(() => {
  granted.clear();
  fetchJson.mockImplementation((url: string) => Promise.resolve(apiResponse(url)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('Items page actions by permission (O14)', () => {
  it('shows no add, edit or archive control to a reader with products.view only', async () => {
    granted.add('products.view');
    render(withClient(<ItemsPage />));
    await screen.findByText('گردنبند لوتوس');
    expect(screen.queryByText(/ثبت محصول جدید/)).toBeNull();
    expect(screen.queryByTitle('ویرایش قلم کالا')).toBeNull();
    expect(screen.queryByText('عملیات')).toBeNull();
  });

  it('shows the add button for products.create and the edit button for products.edit', async () => {
    granted.add('products.view');
    granted.add('products.create');
    granted.add('products.edit');
    render(withClient(<ItemsPage />));
    await screen.findByText('گردنبند لوتوس');
    expect(screen.getByText(/ثبت محصول جدید/)).toBeTruthy();
    expect(screen.getByTitle('ویرایش قلم کالا')).toBeTruthy();
  });

  it('shows the average cost in rials, not in the application currency (O11)', async () => {
    granted.add('products.view');
    render(withClient(<ItemsPage />));
    const row = (await screen.findByText('گردنبند لوتوس')).closest('tr') as HTMLElement;
    expect(within(row).getByTitle('میانگین موزون بهای هر واحد، به ریال').textContent).toMatch(/ریال/);
  });
});

describe('Pricing page price fields by permission (O14)', () => {
  it('a reader without products.edit_price sees prices read only, no quick import and no save button', async () => {
    granted.add('products.view');
    render(withClient(<PricingPage />));
    await screen.findByText('گردنبند لوتوس');
    await waitFor(() => expect(screen.getAllByPlaceholderText('مبلغ').length).toBeGreaterThan(0));
    for (const input of screen.getAllByPlaceholderText('مبلغ')) expect((input as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('ورود سریع اکسل قیمت')).toBeNull();
    expect(screen.queryByText('به‌روزرسانی قیمت‌ها')).toBeNull();
    expect(screen.queryByText('+۱۰٪')).toBeNull();
  });

  it('products.edit_price edits prices, imports and saves', async () => {
    granted.add('products.edit_price');
    render(withClient(<PricingPage />));
    await screen.findByText('گردنبند لوتوس');
    await waitFor(() => expect(screen.getAllByPlaceholderText('مبلغ').length).toBeGreaterThan(0));
    for (const input of screen.getAllByPlaceholderText('مبلغ')) expect((input as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('ورود سریع اکسل قیمت')).toBeTruthy();
    expect(screen.getByText('به‌روزرسانی قیمت‌ها')).toBeTruthy();
  });
});

describe('Pricing margin against the rial average cost (O10)', () => {
  it('shows no margin for a dollar price and the markup buttons write a rial price', async () => {
    granted.add('products.edit_price');
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/items/prices/all'
      ? { 11: [{ id: 1, itemId: 11, title: 'عمده', price: 20, currency: 'USD' }] }
      : apiResponse(url)));
    render(withClient(<PricingPage />));
    await screen.findByText('گردنبند لوتوس');
    const input = await waitFor(() => {
      const el = screen.getAllByPlaceholderText('مبلغ')[0] as HTMLInputElement;
      expect(el.value).toBe('20');
      return el;
    });
    expect(screen.queryByText(/سود|زیان|سربرسر/)).toBeNull();
    screen.getByText('+۱۰٪').click();
    await waitFor(() => expect(input.value).toBe('1650000'));
    const currency = input.parentElement?.querySelector('select') as HTMLSelectElement;
    expect(currency.value).toBe('IRR');
    expect(screen.getByText(/۱۰٪ سود/)).toBeTruthy();
  });
});
