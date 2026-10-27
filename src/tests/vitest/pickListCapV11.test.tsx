import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PICK_LIST_IDS_MAX, PICK_LIST_IDS_PATTERN, PICK_LIST_LIMIT, cappedPickListUrl, isCutPickList, parsePickListIds, pickListIds,
  pickListIdsUrl, pickListServerSearchUrl, takePickList,
} from '../../lib/permissions/pickListCap';

/**
 * v11 phase 6.1ch (C13): the party and item pick lists a form reads hold at most the cap (5,000 parties were 1.2 MB on
 * each form opening). A picker over a list at the cap also searches on the server, and a form that needs a chosen or
 * stored row the list lacks reads it by id: the invoice buyer, a dossier from the sales page, the project form's stored
 * customer, the stock form's reserved items.
 */
type Opts = { method?: string; body?: string; signal?: AbortSignal };
const requested: string[] = [];
let answer: (url: string, opts?: Opts) => unknown = () => [];
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  fetchJson: vi.fn(async (url: string, opts?: Opts) => {
    requested.push(url);
    return answer(url, opts);
  }),
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: ['warehouse.in', 'warehouse.out'], isAdmin: false } }),
  useHasPermission: () => false,
}));

const { VoucherDetailedPicker } = await import('../../components/accounting/VoucherDetailedPicker');
const { useInvoiceBuyer } = await import('../../hooks/invoices/useInvoiceBuyer');
const { useDossierPartyFinder } = await import('../../hooks/crm/useDossierParty');
const { useProjectForm } = await import('../../components/project-modal/useProjectForm');
const { withPickRows } = await import('../../hooks/queries/usePickListRows');
const DocumentsPage = (await import('../../pages/DocumentsPage')).default;

afterEach(() => { cleanup(); requested.length = 0; answer = () => []; });

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
/** a party list at the cap: the server had more */
const parties = (n: number, partyType = 'customer') => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `طرف حساب ${i + 1}`, partyType }));
const far = { id: 5001, name: 'مشتری دور', partyType: 'customer', city: 'یزد', phone: '09120000001' };
const decoded = () => requested.map(u => decodeURIComponent(u.replace(/\+/g, ' ')));
const pause = (ms = 350) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

describe('the cap of a pick list (C13)', () => {
  it('asks the cap and one row, keeps the cap, and knows a list at the cap may lack rows', () => {
    expect(cappedPickListUrl('/customers/options')).toBe('/customers/options?limit=1001');
    expect(cappedPickListUrl('/items/options?type=raw_material')).toBe('/items/options?type=raw_material&limit=1001');
    expect(cappedPickListUrl('/items/options?limit=5')).toBe('/items/options?limit=1001');
    expect(takePickList(parties(PICK_LIST_LIMIT + 1))).toHaveLength(PICK_LIST_LIMIT);
    expect(isCutPickList(parties(PICK_LIST_LIMIT - 1))).toBe(false);
    expect(isCutPickList(parties(PICK_LIST_LIMIT))).toBe(true);
    expect(pickListServerSearchUrl(parties(3), '/customers/options')).toBeUndefined();
    expect(pickListServerSearchUrl(parties(PICK_LIST_LIMIT), '/customers/options?partyType=supplier')).toBe('/customers/options?partyType=supplier');
  });

  it('reads chosen rows by id: each id once, in order, the filters dropped, malformed ids refused', () => {
    expect(pickListIds([5, '3', 5, null, 0, -2, 'x', 2.5, undefined])).toEqual([3, 5]);
    expect(pickListIds(Array.from({ length: PICK_LIST_IDS_MAX + 9 }, (_, i) => i + 1))).toHaveLength(PICK_LIST_IDS_MAX);
    expect(pickListIdsUrl('/customers/options?partyType=customer', [9, 2, 9])).toBe('/customers/options?ids=2,9');
    expect(parsePickListIds('7,3,7')).toEqual([3, 7]);
    expect(parsePickListIds(undefined)).toBeUndefined();
    for (const good of ['1', '1,2,3', '2147483647']) expect(PICK_LIST_IDS_PATTERN.test(good)).toBe(true);
    for (const bad of ['', '0', '01', '1,', ',1', '1,,2', 'a', '-1', '12345678901']) expect(PICK_LIST_IDS_PATTERN.test(bad)).toBe(false);
    expect(PICK_LIST_IDS_PATTERN.test(Array.from({ length: PICK_LIST_IDS_MAX + 1 }, (_, i) => i + 1).join(','))).toBe(false);
  });

  it('adds the rows read by id after the list, each once', () => {
    const list = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    expect(withPickRows(list, [])).toBe(list);
    expect(withPickRows(list, [{ id: 2, name: 'B' }, { id: 3, name: 'c' }, { id: 3, name: 'C' }]).map(r => r.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('the voucher row picker of a cut party list (C13)', () => {
  it('searches the customers of the server and hands back the chosen party; a list under the cap stays a plain list', async () => {
    answer = () => [far];
    const onChange = vi.fn();
    const value = { detailedType: 'customer' as const, detailedId: null, detailedName: '' };
    render(<VoucherDetailedPicker value={value} onChange={onChange} customers={parties(PICK_LIST_LIMIT)} personnelList={[]} />, { wrapper: wrapperOf(newClient()) });
    fireEvent.click(screen.getByRole('button', { name: 'انتخاب مشتری' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'جست‌وجو در فهرست' }), { target: { value: 'دور' } });
    await pause();
    expect(decoded()).toEqual(['/customers/options?partyType=customer&search=دور&limit=50']);
    await waitFor(() => expect(screen.getByText('مشتری دور (یزد)')).toBeTruthy());
    fireEvent.click(screen.getByText('مشتری دور (یزد)'));
    expect(onChange).toHaveBeenCalledWith({ detailedType: 'customer', detailedId: 5001, detailedName: 'مشتری دور' });
    cleanup();
    render(<VoucherDetailedPicker value={value} onChange={() => undefined} customers={parties(3)} personnelList={[]} />, { wrapper: wrapperOf(newClient()) });
    expect(screen.getByRole('combobox', { name: 'انتخاب مشتری' }).tagName).toBe('SELECT');
  });
});

describe('a chosen or stored party the cut list lacks (C13)', () => {
  it('the invoice buyer finds the party of a draft\'s name on the server and fills its fields', async () => {
    answer = (url) => (url.includes('search=') ? [{ ...far, id: 5002, name: 'مشتری دور ب' }, far] : []);
    const { result } = renderHook(() => useInvoiceBuyer(parties(PICK_LIST_LIMIT) as never), { wrapper: wrapperOf(newClient()) });
    act(() => { result.current.setBuyerName('مشتری دور'); });
    await waitFor(() => expect(result.current.selectedCustomerId).toBe('5001'));
    expect(result.current.buyerCity).toBe('یزد');
    expect(result.current.buyerPhone).toBe('09120000001');
    expect(decoded()).toEqual(['/customers/options?search=مشتری دور&limit=50']);
  });

  it('the invoice buyer of a list under the cap asks the server nothing, as before', async () => {
    const { result } = renderHook(() => useInvoiceBuyer(parties(3) as never), { wrapper: wrapperOf(newClient()) });
    act(() => { result.current.setBuyerName('مشتری دور'); });
    await pause(50);
    expect(result.current.selectedCustomerId).toBe('');
    expect(requested).toEqual([]);
  });

  it('a dossier opened from the sales page reads its party by id, or by the only party of the file\'s name', async () => {
    answer = (url) => (url.includes('ids=5001') || url.includes('search=') ? [far] : []);
    const { result } = renderHook(() => useDossierPartyFinder(parties(PICK_LIST_LIMIT) as never), { wrapper: wrapperOf(newClient()) });
    await expect(result.current({ customerId: 5001 })).resolves.toMatchObject({ id: 5001, name: 'مشتری دور' });
    await expect(result.current({ customerName: ' مشتری دور ' })).resolves.toMatchObject({ id: 5001 });
    await expect(result.current({ customerId: 2 })).resolves.toMatchObject({ id: 2 });
    expect(decoded()).toEqual(['/customers/options?ids=5001', '/customers/options?search=مشتری دور&limit=50']);
    const short = renderHook(() => useDossierPartyFinder(parties(3) as never), { wrapper: wrapperOf(newClient()) });
    await expect(short.result.current({ customerId: 5001 })).resolves.toBeNull();
    expect(requested).toHaveLength(2);
  });

  it('the project form keeps the stored customer of an edited project beyond the cap: its name is saved, never emptied', async () => {
    answer = (url, opts) => {
      if (opts?.method) return { success: true };
      if (url === '/customers/options?limit=1001') return parties(PICK_LIST_LIMIT + 1);
      if (url === '/customers/options?ids=5001') return [far];
      return [];
    };
    const project = {
      id: 44, project_code: 'PRJ-44', title: 'پروژه دور', customer_id: 5001, customer_name: 'مشتری دور', quantity: 1, unit: 'عدد',
      start_date: '2026-10-01', end_date: '2026-12-01', priority: 'medium', status: 'in_progress', version: 3, products: [], stages: [],
    };
    const { result } = renderHook(() => useProjectForm({
      isOpen: true, onClose: vi.fn(), projectToEdit: project, customersList: [], itemsList: [], onSuccess: vi.fn(),
    } as never), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(result.current.selectedCustomer?.phone).toBe('09120000001'));
    expect(result.current.selectedCustomer?.name).toBe('مشتری دور');
    await act(async () => { await result.current.handleSubmit({ preventDefault: () => undefined } as never); });
    const put = (await import('../../api')).fetchJson as unknown as { mock: { calls: Array<[string, Opts | undefined]> } };
    const saved = put.mock.calls.filter(([url, opts]) => url === '/projects/44' && opts?.method === 'PUT').map(([, opts]) => JSON.parse(String(opts?.body)));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ customer_id: 5001, customer_name: 'مشتری دور' });
  });
});

describe('the stock form\'s reserved items beyond the cut item list (C13)', () => {
  it('reads a reserved item the list lacks by id, so «add» puts it in the remittance', async () => {
    const reservedItem = { id: 3, type: 'raw_material', name: 'سنگ فیروزه', code: 'RM-3', current_stock: 10, unit: 'عدد', purchase_price: 500, stocks: { WH1: 10 }, stock_WH1: 10 };
    const others = Array.from({ length: PICK_LIST_LIMIT + 1 }, (_, i) => ({ id: 10_000 + i, name: `کالای ${i}`, code: `X-${i}`, unit: 'عدد', current_stock: 1 }));
    answer = (url) => {
      if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
      if (url === '/personnel') return [];
      if (url === '/projects/options') return { success: true, data: [{ id: 7, projectCode: 'PRJ-7', project_code: 'PRJ-7', title: 'گردنبند سفارشی', status: 'in_progress' }] };
      if (url === '/items/options?limit=1001') return { data: others };
      if (url === '/items/options?ids=3') return { data: [reservedItem] };
      if (url === '/inventory/reserved-items') {
        return { allReservationEntries: [{ sourceType: 'project', sourceId: 7, sourceRef: 'PRJ-7', sourceTitle: 'گردنبند سفارشی', itemId: 3, itemCode: 'RM-3', itemName: 'سنگ فیروزه', reservedQty: 4, unit: 'عدد' }] };
      }
      if (url.startsWith('/documents/next-ref')) return { nextRef: 'RM-2001' };
      return [];
    };
    const user = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };
    render(<DocumentsPage user={user as never} />, { wrapper: wrapperOf(newClient()) });
    fireEvent.click(screen.getByText('خروج از انبار (حواله مصرف)'));
    await screen.findByText('پروژه PRJ-۷ - گردنبند سفارشی');
    fireEvent.change(screen.getByDisplayValue('— خروج عمومی (بدون تخصیص به پروژه) —'), { target: { value: '7' } });
    await screen.findByText('+ افزودن');
    await waitFor(() => expect(requested).toContain('/items/options?ids=3'));
    fireEvent.click(screen.getByText('+ افزودن'));
    expect(await screen.findByText('✓ در سند')).toBeTruthy();
  });
});

describe('every party and item pick list a form reads is capped (C13)', () => {
  const SRC = join(process.cwd(), 'src');
  const clientFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ['tests', 'routes', 'services', 'db', 'middleware'].includes(name) ? [] : clientFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
  /** the project materials and delivery tabs match their rows to items by code and name, which a cut list cannot answer */
  const WHOLE_LIST_READS = new Set(['src/hooks/queries/useProjectWorkspaceQueries.ts']);

  it('reads no whole party or item list, but the listed exception', () => {
    const whole = /fetchJson(?:<[^>]*>)?\(\s*(?:PICK_LIST_URLS\.(?:customers|items)\s*[,)]|`\$\{PICK_LIST_URLS\.(?:customers|items)\}\?type=[^`]*`\s*[,)])/;
    const offenders = clientFiles(SRC)
      .filter(path => whole.test(readFileSync(path, 'utf8')))
      .map(path => path.slice(process.cwd().length + 1))
      .filter(path => !WHOLE_LIST_READS.has(path));
    expect(offenders).toEqual([]);
  });

  it('wires the server search into every picker fed by a capped party or item list', () => {
    const files = [
      'src/components/accounting/AccountExplorerTab.tsx', 'src/components/accounting/ChequesTab.tsx',
      'src/components/accounting/treasury/TreasuryTransactionModal.tsx', 'src/components/accounting/VoucherDetailedPicker.tsx',
      'src/components/project-modal/ProjectGeneralForm.tsx', 'src/components/project-modal/ProjectProductsForm.tsx',
      'src/components/crm/CRMLeadModal.tsx', 'src/pages/CRMPage.tsx', 'src/hooks/useEntitySelectors.ts',
      'src/components/reorder/ReorderPurchaseModal.tsx', 'src/components/documents/stock/StockCounterpartyField.tsx',
      'src/components/InventoryRebuildModal.tsx', 'src/components/inventory/allocations/AllocateMaterialDialog.tsx',
    ];
    for (const file of files) expect(readFileSync(join(process.cwd(), file), 'utf8'), file).toContain('pickListServerSearchUrl(');
  });
});
