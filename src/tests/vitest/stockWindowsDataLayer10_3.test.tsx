import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownReads } from './helpers/ownReads';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 8): the stock windows and reports read through the shared cache. A stock document,
 * transfer, item save or project save elsewhere refreshes a window that is open; each opening reads again and counts only
 * what it read itself.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  sourceStock: /موجودی قابل انتقال در مبدا/,
  refNumber: /شماره حواله \/ عطف/,
  fromWarehouse: /انبار مبدا \(کاهش موجودی\)/,
  toWarehouse: /انبار مقصد \(افزایش موجودی\)/,
  readFailed: 'خطا در دریافت لیست کالاها و انبارها',
  repair: /اعمال ترمیم/,
  repairable: 'کالای قابل ترمیم:',
} as const;

let stockInA = 5;
let nextRefs: string[] = [];
let reservedItemCode = 'P-7';
const FIRST_HISTORY = [{ oldCode: 'NE-090', newCode: 'NE-100', reason: 'r', username: 'u', createdAt: '2026-10-01T08:00:00.000Z' }];
let codeHistory = FIRST_HISTORY;
let warehousesFail = false;
let pickedRowGone = false;
let repairable = 1;
const PICK = { id: 7, code: 'P-7', name: 'N', unit: 'u' };
const fetchJson = vi.fn(async (url: string, options?: { method?: string }): Promise<unknown> => {
  if (url === '/warehouses') {
    if (warehousesFail) throw new Error('unreadable');
    return [{ code: 'A', name: 'WA' }, { code: 'B', name: 'WB' }];
  }
  if (url.startsWith('/documents/next-ref')) return { nextRef: nextRefs.length > 1 ? nextRefs.shift() : nextRefs[0] };
  // the picked item's own row; once it is gone, another item (a code that contains it) is all the list has
  if (url.startsWith('/items/options?')) return { data: [pickedRowGone ? { ...PICK, id: 8, stocks: { A: 1000 } } : { ...PICK, stocks: { A: stockInA, B: 0 } }] };
  if (url === '/inventory/reserved-items') return reservedReport(reservedItemCode);
  if (url.endsWith('/code-history')) return { data: codeHistory };
  if (url === '/inventory/warehouse-stock-reconciliation/repair' && options?.method === 'POST') {
    repairable = 0;
    return { message: 'done' };
  }
  if (url === '/inventory/warehouse-stock-reconciliation') return reconciliation(repairable);
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, options?: { method?: string }) => fetchJson(url, options) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
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
import { WarehouseStockReconciliationPanel } from '../../components/inventory/WarehouseStockReconciliationPanel';
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

function reconciliation(repairableItems: number) {
  return {
    summary: { itemsChecked: 1, mismatchRows: repairableItems, negativeLedgerRows: 0, blockedItems: 0, codeMismatchRows: 0, cacheMismatchItems: 0, repairableItems },
    rows: [],
    unresolvedLocations: [],
  };
}

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  stockInA = 5;
  nextRefs = [];
  reservedItemCode = 'P-7';
  codeHistory = FIRST_HISTORY;
  warehousesFail = false;
  pickedRowGone = false;
  repairable = 1;
});

/** the app's read defaults (fresh for five minutes): a screen must read again on its own */
const newClient = appQueryClient;
const withClient = (client: QueryClient) => (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
const reads = (prefix: string) => fetchJson.mock.calls.filter(([url, options]) => url.startsWith(prefix) && !options?.method).length;
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

  it('the transfer window starts from the first two warehouses, again on each opening', async () => {
    const client = newClient();
    nextRefs = ['5'];
    const { rerender } = render(transfer(client, true));
    const from = () => (screen.getByLabelText(SHOWN.fromWarehouse) as HTMLSelectElement).value;
    const to = () => (screen.getByLabelText(SHOWN.toWarehouse) as HTMLSelectElement).value;
    await waitFor(() => expect([from(), to()]).toEqual(['A', 'B']));
    fireEvent.change(screen.getByLabelText(SHOWN.fromWarehouse), { target: { value: 'B' } });
    rerender(transfer(client, false));
    rerender(transfer(client, true));
    await waitFor(() => expect(reads('/warehouses')).toBe(2));
    await waitFor(() => expect([from(), to()]).toEqual(['A', 'B']));
  });

  it('a failed warehouse read says so at once, with one request, under the app\'s retry policy', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
    nextRefs = ['5'];
    warehousesFail = true;
    render(transfer(client, true));
    expect(await screen.findByText(SHOWN.readFailed)).toBeTruthy();
    expect(reads('/warehouses')).toBe(1);
  });

  it('when the picked item is gone, the window keeps the row it picked, never another item\'s', async () => {
    const client = newClient();
    nextRefs = ['5'];
    pickedRowGone = true;
    render(transfer(client, true));
    fireEvent.click(await screen.findByText('pick item'));
    await waitFor(() => expect(reads('/items/options?id=7')).toBe(1));
    await waitFor(() => expect(sourceStockLine()).toContain(formatPersianNumber(5)));
    expect(sourceStockLine()).not.toContain(formatPersianNumber(1000));
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
    expect(screen.queryByText('OLD-۱')).toBeNull();
    expect(await screen.findByText('P-۷')).toBeTruthy();

    reservedItemCode = 'P-8';
    await act(() => client.invalidateQueries({ queryKey: QUERY_KEYS.inventory.all }));
    expect(await screen.findByText('P-۸')).toBeTruthy();
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

/** another read under `inventory` on the same screen whose answer never comes */
function NeverAnswers() {
  useQuery({ queryKey: [...QUERY_KEYS.inventory.all, 'never-answers'], queryFn: () => new Promise<never>(() => undefined) });
  return null;
}

describe('the warehouse reconciliation repair (10.3)', () => {
  it('reads the report again after the repair, once, and waits for no other read', async () => {
    const client = newClient();
    render(withClient(client)(<><WarehouseStockReconciliationPanel /><NeverAnswers /></>));
    expect(await screen.findByText(`${SHOWN.repairable} ${formatPersianNumber(1)}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SHOWN.repair }));
    expect(await screen.findByText(`${SHOWN.repairable} ${formatPersianNumber(0)}`)).toBeTruthy();
    expect(await screen.findByRole('button', { name: SHOWN.repair })).toBeTruthy();
    expect(reads('/inventory/warehouse-stock-reconciliation')).toBe(2);
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
