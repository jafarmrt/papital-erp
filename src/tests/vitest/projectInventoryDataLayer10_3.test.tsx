import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ownReads } from './helpers/ownReads';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 11): the materials planning page, the allocation tab and the materials tab read
 * through the shared cache. Each opening reads again and never shows what an earlier visit left in the cache; a change
 * elsewhere refreshes them; the page holds the project while the materials tab has an unsaved change; a save clears
 * the unsaved mark only when nothing was edited while it was under way.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  consume: 'ثبت مصرف قطعی در محصول',
  nine: '۹',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const allocation = (code: string) => ({
  id: 1, projectId: 7, projectCode: code, itemId: 9, itemCode: 'RM-9', itemName: 'glue', unit: 'pcs', quantity: 2,
  status: 'allocated', allocatedAt: '2026-10-01T08:00:00Z', username: 'admin',
});
const allocationPage = (code: string, all = 1) => ({
  allocations: [allocation(code)], total: 1, page: 1, limit: 50, statusCounts: { all, allocated: all, consumed: 0, released: 0 },
});
let serverAllocations = allocationPage('P-1');
let serverProjectTitle = 'v1';
let holdNext: string | null = null;
const held: Array<(answer: unknown) => void> = [];
/** the inventory PUT waits for the test */
let holdPut = false;
const heldPut: Array<(answer: unknown) => void> = [];
const projectOf = (title: string) => ({
  id: 7, version: 3, project_code: 'PRJ-7', title, status: 'in_progress', quantity: 2, unit: 'pcs', stages: [],
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'necklace', quantity: 2, unit: 'pcs' }],
});
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  const answer = (value: unknown) => {
    if (holdNext && url.startsWith(holdNext)) {
      holdNext = null;
      return new Promise(resolve => { held.push(resolve); });
    }
    return value;
  };
  if (url === '/api/projects/7' && opts?.method === 'PUT') {
    if (holdPut) return new Promise(resolve => { heldPut.push(resolve); });
    return { version: 4, inventory_control: {} };
  }
  if (opts?.method) return { success: true };
  if (url.startsWith('/inventory/allocations')) return answer(serverAllocations);
  if (url === '/projects/options') return [{ id: 5, project_code: 'PRJ-5', title: 'done', status: 'completed' }, { id: 7, project_code: 'PRJ-7', title: 'open', status: 'in_progress' }];
  if (url === '/projects/7') return answer(projectOf(serverProjectTitle));
  if (url === '/settings') return {};
  return [];
});
vi.mock('../../api', () => ({
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));
// the page's materials tab: the project it was given, and a way to hold an unsaved change
vi.mock('../../components/project/ProjectInventoryTab', () => ({
  default: ({ project, onDirtyChange }: { project: { title: string }; onDirtyChange?: (dirty: boolean) => void }) => (
    <div>
      <span data-testid="materials-project">{project.title}</span>
      <button type="button" onClick={() => onDirtyChange?.(true)}>edit</button>
      <button type="button" onClick={() => onDirtyChange?.(false)}>clean</button>
    </div>
  ),
}));

import ProjectInventoryPage from '../../pages/ProjectInventoryPage';
import { ProjectBomAllocationsTab } from '../../components/inventory/ProjectBomAllocationsTab';
import { useProjectInventory } from '../../hooks/useProjectInventory';
import { useBomAllocations } from '../../components/inventory/allocations/useBomAllocations';
import { withAddedWarehouseItem } from '../../hooks/projectInventory/sectionEdits';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Item, ProductionProject, ProjectInventoryControlSectionData, ProjectProductItem } from '../../types';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverAllocations = allocationPage('P-1');
  serverProjectTitle = 'v1';
  holdNext = null;
  held.length = 0;
  holdPut = false;
  heldPut.length = 0;
});

/** the app's read defaults (fresh for five minutes): a screen must read again on its own */
const newClient = appQueryClient;
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const invalidate = (client: QueryClient, queryKey: readonly unknown[]) => act(async () => { await client.invalidateQueries({ queryKey }); });
/** the item list and settings are read and the sections built from them, so an edit is not replaced by that build */
const settled = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));

describe('the allocation tab reads through the shared cache (10.3)', () => {
  it('reads the list again on each opening and never shows the one an earlier visit left in the cache', async () => {
    const client = newClient();
    // an earlier visit's page, its counts (nine allocations) told apart from this opening's
    client.setQueryData(QUERY_KEYS.inventory.allocations({ page: 1, limit: 50, search: '', status: 'all' }), allocationPage('P-OLD', 9), { updatedAt: Date.now() - 60_000 });
    holdNext = '/inventory/allocations';
    render(<ProjectBomAllocationsTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(screen.queryAllByText('P-OLD')).toHaveLength(0);
    expect(screen.queryAllByText(SHOWN.nine)).toHaveLength(0);

    await act(async () => { held[0]?.(allocationPage('P-NEW')); });
    expect((await screen.findAllByText('P-NEW')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('P-OLD')).toHaveLength(0);
  });

  it('follows a stock change made elsewhere while open', async () => {
    const client = newClient();
    render(<ProjectBomAllocationsTab />, { wrapper: wrapperOf(client) });
    expect((await screen.findAllByText('P-۱')).length).toBeGreaterThan(0);
    serverAllocations = allocationPage('P-2');
    await invalidate(client, QUERY_KEYS.inventory.all);
    expect((await screen.findAllByText('P-۲')).length).toBeGreaterThan(0);
  });

  it('a consume refreshes the stock screens and the projects that count the allocation', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    render(<ProjectBomAllocationsTab />, { wrapper: wrapperOf(client) });
    fireEvent.click((await screen.findAllByTitle(SHOWN.consume))[0]);
    await waitFor(() => expect(fetchJson.mock.calls.some(([u, o]) => u === '/inventory/allocations/1/consume' && o?.method === 'POST')).toBe(true));
    const keys = () => invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    await waitFor(() => expect(keys()).toEqual(expect.arrayContaining([
      JSON.stringify(QUERY_KEYS.inventory.all), JSON.stringify(QUERY_KEYS.items.all), JSON.stringify(QUERY_KEYS.projects.all),
    ])));
  });

  it.each(['allocate', 'release'] as const)('a write (%s) refreshes the same screens', async (write) => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useBomAllocations(), { wrapper: wrapperOf(client) });
    await act(async () => {
      if (write === 'allocate') await result.current.allocate({ projectId: 7, recipientPersonnelId: null, itemId: 9, quantity: 1, location: 'main', notes: '' });
      else await result.current.release(allocation('P-1') as never, 'back to stock');
    });
    const keys = invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(expect.arrayContaining([
      JSON.stringify(QUERY_KEYS.inventory.all), JSON.stringify(QUERY_KEYS.items.all), JSON.stringify(QUERY_KEYS.projects.all),
    ]));
  });
});

describe('the materials planning page reads through the shared cache (10.3)', () => {
  const renderPage = (client: QueryClient) => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/project-inventory']}>
        <Routes><Route path="/project-inventory" element={<ProjectInventoryPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const shownTitle = () => screen.queryByTestId('materials-project')?.textContent;

  it('opens the first open project, follows a save elsewhere, and holds the project while the tab has an unsaved change', async () => {
    const client = newClient();
    renderPage(client);
    await waitFor(() => expect(shownTitle()).toBe('v1'));
    expect(fetchJson.mock.calls.some(([u]) => u === '/projects/5')).toBe(false);

    serverProjectTitle = 'v2';
    await invalidate(client, QUERY_KEYS.projects.all);
    await waitFor(() => expect(shownTitle()).toBe('v2'));

    // an unsaved change holds the project on screen; once clean, the project is read again and shown
    fireEvent.click(screen.getByText('edit'));
    serverProjectTitle = 'v3';
    await invalidate(client, QUERY_KEYS.projects.all);
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(shownTitle()).toBe('v2');
    fireEvent.click(screen.getByText('clean'));
    await waitFor(() => expect(shownTitle()).toBe('v3'));
  });

  it('never shows the project an earlier visit left in the cache', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.projects.detail(7), projectOf('cached'), { updatedAt: Date.now() - 60_000 });
    holdNext = '/projects/7';
    renderPage(client);
    await waitFor(() => expect(held).toHaveLength(1));
    expect(shownTitle()).toBeUndefined();
    await act(async () => { held[0]?.(projectOf('fresh')); });
    await waitFor(() => expect(shownTitle()).toBe('fresh'));
  });
});

describe('a materials save keeps an edit made while it was under way (10.3)', () => {
  const project = projectOf('materials') as unknown as ProductionProject;

  it('clears the unsaved mark when nothing was edited during the save', async () => {
    const { result } = renderHook(() => useProjectInventory(project), { wrapper: wrapperOf(newClient()) });
    await settled();
    act(() => { result.current.handleUpdateSectionDescription(0, 'first'); });
    expect(result.current.isDirty).toBe(true);
    await act(async () => { await result.current.handleSaveInventoryControl(); });
    expect(result.current.isDirty).toBe(false);
  });

  it('keeps the unsaved mark, and the edit, when the sections changed while the save was under way', async () => {
    const { result } = renderHook(() => useProjectInventory(project), { wrapper: wrapperOf(newClient()) });
    await settled();
    act(() => { result.current.handleUpdateSectionDescription(0, 'first'); });
    holdPut = true;
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.handleSaveInventoryControl(); });
    await waitFor(() => expect(heldPut).toHaveLength(1));
    act(() => { result.current.handleUpdateSectionDescription(0, 'second'); });

    await act(async () => { heldPut[0]?.({ version: 4, inventory_control: {} }); await saving; });
    expect(result.current.isDirty).toBe(true);
    expect(result.current.sections[0]?.description).toBe('second');
    const sent = JSON.parse(String(fetchJson.mock.calls.find(([, o]) => o?.method === 'PUT')?.[1]?.body)) as { inventory_control: { sections: Array<{ description?: string }> } };
    expect(sent.inventory_control.sections[0]?.description).toBe('first');
  });

  it('keeps the unsaved mark when a manual purchase row changed while the save was under way', async () => {
    const { result } = renderHook(() => useProjectInventory(project), { wrapper: wrapperOf(newClient()) });
    await settled();
    act(() => { result.current.handleUpdateSectionDescription(0, 'first'); });
    holdPut = true;
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.handleSaveInventoryControl(); });
    await waitFor(() => expect(heldPut).toHaveLength(1));
    act(() => { result.current.handleAddManualPurchaseRow(); });
    await act(async () => { heldPut[0]?.({ version: 4, inventory_control: {} }); await saving; });
    expect(result.current.isDirty).toBe(true);
  });
});

describe('a warehouse item added to every product of a section (10.3)', () => {
  it('sizes each order line\'s row from that line, the last line winning under a shared product key, as before', () => {
    const line = (quantity: number) => ({ id: 'prod_50', item_id: 50, quantity }) as unknown as ProjectProductItem;
    const sections = [{ checkType: 'per_item', perItemResults: {} }] as unknown as ProjectInventoryControlSectionData[];
    const glue = { name: 'glue', code: 'RM-9', unit: 'pcs', current_stock: 3 } as Item;
    const added = withAddedWarehouseItem(sections, 0, null, glue, [line(2), line(7)], 'item_1');
    expect(added[0]?.perItemResults?.prod_50?.item_1?.requiredQty).toBe(7);
  });
});

describe('the materials page, tab and allocations make no read of their own (10.3)', () => {
  it.each([
    'pages/ProjectInventoryPage.tsx',
    'components/inventory/ProjectBomAllocationsTab.tsx',
    'components/inventory/allocations/AllocationKpiCards.tsx',
    'components/inventory/allocations/AllocationTable.tsx',
    'components/inventory/allocations/AllocationTraceDialog.tsx',
    'components/inventory/allocations/AllocationReleaseDialog.tsx',
    'components/inventory/allocations/AllocateMaterialDialog.tsx',
    'components/project/ProjectInventoryTab.tsx',
    'components/project/inventory/InventoryHeaderCard.tsx',
    'components/project/inventory/InventoryMainTabs.tsx',
    'hooks/useProjectInventory.ts',
    'hooks/projectInventory/sectionEdits.ts',
    'hooks/projectInventory/useInventoryReservation.ts',
    'hooks/projectInventory/useUnitConversion.ts',
  ])('%s reads only through the shared cache', (file) => {
    expect(ownReads(file)).toEqual([]);
  });

  // read on demand, never shown from a cache: the Excel export reads every allocation of the search when pressed, and
  // the suggested code of a new material is asked when its category is chosen
  it.each([
    'components/inventory/allocations/useBomAllocations.ts',
    'hooks/projectInventory/useMaterialPicker.ts',
  ])('%s makes one read of its own, on demand', (file) => {
    expect(ownReads(file)).toHaveLength(1);
  });
});
