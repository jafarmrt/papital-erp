import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import GlobalHeaderSearch from '../../components/GlobalHeaderSearch';
import { SearchProvider, useSearch } from '../../SearchContext';
import { globalSearchTarget } from '../../lib/search/globalSearchTarget';

// TD-1155: a global search result opens its list searched by that record's own key, not the bare list page with the
// half-typed text.

const fetchJson = vi.fn((..._args: unknown[]) => Promise.resolve({
  items: [{ id: 4, name: 'گردنبند ماه', code: 'N-0042', type: 'product' }],
  customers: [], documents: [], projects: [],
}));
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(cleanup);

function Probe() {
  const location = useLocation();
  const { searchQuery } = useSearch();
  return <output data-testid="probe">{`${location.pathname}${location.search}|${searchQuery}`}</output>;
}

describe('global search result target (TD-1155)', () => {
  it('maps each kind to its list and the record key', () => {
    expect(globalSearchTarget({ kind: 'item', code: 'R-7', type: 'raw_material' })).toEqual({ path: '/products?type=raw_material', search: 'R-7' });
    expect(globalSearchTarget({ kind: 'item', code: 'N-1', type: 'product' })).toEqual({ path: '/products', search: 'N-1' });
    expect(globalSearchTarget({ kind: 'customer', name: ' بوتیک رز ' })).toEqual({ path: '/customers', search: 'بوتیک رز' });
    expect(globalSearchTarget({ kind: 'document', refNumber: '1001' })).toEqual({ path: '/invoices?search=1001', search: '1001' });
    expect(globalSearchTarget({ kind: 'project', code: 'P-12' })).toEqual({ path: '/projects', search: 'P-12' });
  });

  it('opens the item list searched by the chosen item code', async () => {
    render(
      <SearchProvider>
        <MemoryRouter initialEntries={['/']}>
          <GlobalHeaderSearch />
          <Probe />
        </MemoryRouter>
      </SearchProvider>,
    );
    const input = screen.getByPlaceholderText(/جستجوی سراسری/);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'گردن' } });
    const result = await screen.findByText('گردنبند ماه', {}, { timeout: 2000 });
    fireEvent.click(result);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('/products|N-0042'));
  });
});
