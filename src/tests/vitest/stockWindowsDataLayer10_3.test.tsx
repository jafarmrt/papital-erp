import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownReads } from './helpers/ownReads';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

/**
 * 10.3 (ARCH review finding 3, part 8): the stock windows and reports read through the shared cache. A stock document,
 * transfer, item save or project save elsewhere refreshes a window that is open; each opening reads again and counts only
 * what it read itself.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  sourceStock: /موجودی قابل انتقال در مبدا/,
  refNumber: /شماره حواله \/ عطف/,
} as const;

let stockInA = 5;
let nextRefs: string[] = [];
let reservedItemCode = 'P-7';
let codeHistory = [{ oldCode: 'NE-090', newCode: 'NE-100', reason: 'r', username: 'u', createdAt: '2026-10-01T08:00:00.000Z' }];
const PICK = { id: 7, code: 'P-7', name: 'N', unit: 'u' };
const fetchJson = vi.fn(async (url: string): Promise<unknown> => {
  if (url === '/warehouses') return [{ code: 'A', name: 'WA' }, { code: 'B', name: 'WB' }];
  if (url.startsWith('/documents/next-ref')) return { nextRef: nextRefs.length > 1 ? nextRefs.shift() : nextRefs[0] };
  if (url.startsWith('/items/options?')) return { data: [{ ...PICK, stocks: { A: stockInA, B: 0 } }] };
  if (url === '/inventory/reserved-items') return reservedReport(reservedItemCode);
  if (url.endsWith('/code-history')) return { data: codeHistory };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ onChange }: { onChange: (value: string, raw?: unknown) => void }) => (
    <button type="button" onClick={() => onChange('7', { ...PICK, stocks: { A: 5, B: 0 } })}>pick item</button>
  ),
}));

import WarehouseTransferModal from '../../components/WarehouseTransferModal';
import ReservedItemsReportPage from '../../pages/ReservedItemsReportPage';
import { ItemCodeChangeModal } from '../../components/items/ItemCodeChangeModal';
import { formatPersianNumber } from '../../utils';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset } from '../../lib/queryInvalidation';
import type { Item } from '../../types';

function reservedReport(code: string) {
  return {
    summaryMetrics: { totalReservedItemsCount: 1, totalReservedQty: 1, totalReservedCost: 0, proformaReservationsCount: 1, projectReservationsCount: 0 },
    itemSummaries: [{
      itemId: 7, itemCode: code, itemName: 'N', category: 'C', unit: 'u', currentStock: 3, weightedAverageCost: 0,
      proformaReservedQty: 1, projectReservedQty: 0, totalReservedQty: 1, availableStock: 2, totalReservedCost: 0, reservations: [],
    }],
    allReservationEntries: [],
  };
}

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  stockInA = 5;
  nextRefs = [];
  reservedItemCode = 'P-7';
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const withClient = (client: QueryClient) => (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
const reads = (prefix: string) => fetchJson.mock.calls.filter(([url]) => url.startsWith(prefix)).length;
const transfer = (client: QueryClient, open: boolean) => withClient(client)(
  <WarehouseTransferModal isOpen={open} onClose={() => undefined} onSuccess={() => undefined} />,
);
const sourceStockLine = () => screen.getByText(SHOWN.sourceStock).textContent ?? '';
const refField = () => screen.getByLabelText(SHOWN.refNumber) as HTMLInputElement;

describe('stock windows refresh while open (10.3)', () => {
  it('the transfer window checks against the picked item\'s stock as it is now', async () => {
    const client = newClient();
    nextRefs = ['5'];
    render(transfer(client, true));
    fireEvent.click(await screen.findByText('pick item'));
    await waitFor(() => expect(sourceStockLine()).toContain(formatPersianNumber(5)));

    // a stock document elsewhere took 3 out of warehouse A
    stockInA = 2;
    await act(() => invalidatePreset(client, 'documentChange'));
    await waitFor(() => expect(sourceStockLine()).toContain(formatPersianNumber(2)));
  });

  it('an untouched transfer number follows the next free number; a typed one stays', async () => {
    const client = newClient();
    nextRefs = ['5', '6', '7'];
    render(transfer(client, true));
    await waitFor(() => expect(refField().value).toBe('5'));

    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.documents.all }));
    await waitFor(() => expect(refField().value).toBe('6'));

    fireEvent.change(refField(), { target: { value: 'TR-MINE' } });
    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.documents.all }));
    await waitFor(() => expect(reads('/documents/next-ref')).toBe(3));
    expect(refField().value).toBe('TR-MINE');
  });

  it('each opening of the transfer window reads the warehouses and the next number again', async () => {
    const client = newClient();
    nextRefs = ['5', '9'];
    const { rerender } = render(transfer(client, true));
    await waitFor(() => expect(refField().value).toBe('5'));
    rerender(transfer(client, false));
    rerender(transfer(client, true));
    await waitFor(() => expect(reads('/warehouses')).toBe(2));
    await waitFor(() => expect(refField().value).toBe('9'));
  });

  it('the reserved items report takes a change elsewhere and never shows a report cached from an earlier visit', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.inventory.reservedItems(), reservedReport('OLD-1'));
    render(withClient(client)(<MemoryRouter><ReservedItemsReportPage /></MemoryRouter>));
    expect(screen.queryByText('OLD-1')).toBeNull();
    expect(await screen.findByText('P-7')).toBeTruthy();

    reservedItemCode = 'P-8';
    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.inventory.all }));
    expect(await screen.findByText('P-8')).toBeTruthy();
  });

  it('the code history window shows a code change made meanwhile', async () => {
    const client = newClient();
    const item = { id: 7, code: 'NE-100', name: 'N', version: 3 } as unknown as Item;
    render(withClient(client)(<ItemCodeChangeModal item={item} onClose={() => undefined} onChanged={() => undefined} />));
    expect(await screen.findByText(/NE-090/)).toBeTruthy();

    codeHistory = [...codeHistory, { oldCode: 'NE-100', newCode: 'NE-200', reason: 'r', username: 'u', createdAt: '2026-10-02T08:00:00.000Z' }];
    await act(() => invalidatePreset(client, 'itemChange'));
    expect(await screen.findByText(/NE-200/)).toBeTruthy();
  });
});

const STOCK_WINDOWS = [
  'components/WarehouseTransferModal.tsx',
  'pages/ReservedItemsReportPage.tsx',
  'components/items/ItemCodeChangeModal.tsx',
  'components/inventory/WarehouseStockReconciliationPanel.tsx',
];

describe('the stock windows read only through the shared cache (10.3)', () => {
  it('their own fetch calls are writes', () => {
    expect(STOCK_WINDOWS.flatMap(ownReads)).toEqual([]);
  });
});
