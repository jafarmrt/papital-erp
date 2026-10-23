import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';
import { ownReads } from './helpers/ownReads';

/**
 * 10.3 (ARCH review finding 3, part 10): the progress tab, its phone list and the delivery tab read the progress matrix
 * through the shared cache. Each opening reads it again and never shows what an earlier visit left in the cache; a save
 * elsewhere refreshes an open tab, the unsent ticks staying on top; after «ثبت» the ticks stay until the saved matrix is
 * read (and stay unsent if that read fails); and the delivery «تکمیل‌شده» box follows the matrix as it is now. A delivery
 * refreshes the stock screens as any stock document does.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  stageOne: 'برش',
  stageTwo: 'مونتاژ',
  cell: (stage: string, done: boolean) => `${stage} — ${done ? 'تمام' : 'ناتمام'} (کلیک: تغییر تمام/ناتمام)`,
  saveOne: 'ثبت ۱ تغییر در سامانه',
  markCompleted: 'تغییر وضعیت پروژه به تکمیل‌شده',
  deliver: 'ورود به انبار',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type Done = readonly [boolean, boolean];
const STAGES = [SHOWN.stageOne, SHOWN.stageTwo];
/** the progress matrix of one product over two stages, each stage ticked or not */
const matrixOf = (done: Done) => {
  const completed = done.filter(Boolean).length;
  return {
    stages: STAGES.map((title, i) => ({ stage_order: i + 1, title })),
    products: [{
      item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد', applicable_stage_orders: [1, 2], excluded_stage_orders: [],
      progress: STAGES.map((title, i) => ({ stage_order: i + 1, stage_title: title, status: done[i] ? 'completed' : 'pending', updated_at: '', updated_by_name: '' })),
      completed_count: completed, applicable_count: 2, progress_percent: completed * 50,
    }],
    summary: {
      total_skus: 1, total_quantity: 5, weighted_progress_percent: completed * 50, fully_completed_skus: completed === 2 ? 1 : 0,
      total_matrix_cells: 2, completed_matrix_cells: completed, all_matrix_completed: completed === 2,
      per_stage_counts: STAGES.map((title, i) => ({ stage_order: i + 1, title, completed_count: done[i] ? 1 : 0, applicable_skus: 1, progress_percent: done[i] ? 100 : 0 })),
    },
  };
};
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه پیشرفت', status: 'in_progress', quantity: 5, unit: 'عدد', progress_percent: 0,
  start_date: '2026-08-23', end_date: '2026-09-22',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', customer_code: '', quantity: 5, unit: 'عدد', needs_assembly: false }],
  stages: STAGES.map((title, i) => ({ id: 11 + i, project_id: 7, stage_order: i + 1, title, status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [] })),
};
let serverMatrix = matrixOf([false, false]);
/** the next matrix read waits for the test; with `holdEveryMatrix`, every read does */
let holdNextMatrix = false;
let holdEveryMatrix = false;
const heldMatrix: Array<{ resolve: (answer: unknown) => void; reject: (err: unknown) => void }> = [];
const puts: Array<{ items: Array<{ stage_order: number; status: string }> }> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7/product-progress' && opts?.method === 'PUT') {
    const put = JSON.parse(opts.body ?? '{}') as (typeof puts)[number];
    puts.push(put);
    // the server keeps the ticks it was sent
    const done = serverMatrix.products[0].progress.map(c => c.status === 'completed');
    for (const tick of put.items) done[tick.stage_order - 1] = tick.status === 'completed';
    serverMatrix = matrixOf([done[0], done[1]]);
    return { success: true, applied: put.items.length };
  }
  if (url === '/projects/7/product-progress') {
    if (holdNextMatrix || holdEveryMatrix) {
      holdNextMatrix = false;
      return new Promise((resolve, reject) => { heldMatrix.push({ resolve, reject }); });
    }
    return serverMatrix;
  }
  if (url === '/projects/7/add-to-inventory') return { success: true, addedCount: 1, refNumber: 31 };
  if (url === '/projects/7') return project;
  if (url === '/projects/7/steps') return { requisitions: {}, allocations: {}, delivery: {} };
  if (url === '/projects/7/delivery-cost') return { projectId: 7, costVisible: false, wipBalance: null, products: [] };
  if (url === '/warehouses') return [{ id: 1, code: 'WH1', name: 'انبار آزمون' }];
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
vi.mock('../../components/project/ProjectInventoryTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectScheduleTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => null }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));

import ProjectDetailPage from '../../pages/ProjectDetailPage';
import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import ProjectProductProgressTab from '../../components/project/ProjectProductProgressTab';
import toast from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { productProgressKey } from '../../hooks/queries/useProjectWorkspaceQueries';
import type { ProductionProject } from '../../types';

function setPhoneScreen(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_WIDTH_QUERY,
    media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverMatrix = matrixOf([false, false]);
  holdNextMatrix = false;
  holdEveryMatrix = false;
  heldMatrix.length = 0;
  puts.length = 0;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderPage = (client: QueryClient, path = '/projects/7/progress') => render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/projects/:projectId/:tab?" element={<ProjectDetailPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const matrixReads = () => fetchJson.mock.calls.filter(([u, o]) => u === '/projects/7/product-progress' && !o?.method).length;
/** a save elsewhere (a stock document, a workshop approval) invalidates the project and what hangs under it */
const savedElsewhere = (client: QueryClient) => act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.projects.all }); });
const cell = (stage: string, done: boolean) => screen.queryByTitle(SHOWN.cell(stage, done));

describe('the progress tab reads the matrix through the shared cache (10.3)', () => {
  it('reads the matrix again on each opening and never shows the one an earlier visit left in the cache', async () => {
    setPhoneScreen(false);
    const client = newClient();
    // an earlier visit's matrix (a minute old, so never one of this opening even within the same millisecond)
    client.setQueryData(productProgressKey(7), matrixOf([true, true]), { updatedAt: Date.now() - 60_000 });
    holdNextMatrix = true;
    renderPage(client);
    await waitFor(() => expect(heldMatrix).toHaveLength(1));
    expect(cell(SHOWN.stageOne, true)).toBeNull();
    expect(cell(SHOWN.stageTwo, true)).toBeNull();

    await act(async () => { heldMatrix[0]?.resolve(matrixOf([true, false])); });
    expect(await screen.findByTitle(SHOWN.cell(SHOWN.stageOne, true))).toBeTruthy();
    expect(cell(SHOWN.stageTwo, false)).toBeTruthy();
    expect(cell(SHOWN.stageTwo, true)).toBeNull();
  });

  it('follows a matrix changed elsewhere while open, and the unsent ticks stay on top', async () => {
    setPhoneScreen(false);
    const client = newClient();
    renderPage(client);
    fireEvent.click(await screen.findByTitle(SHOWN.cell(SHOWN.stageTwo, false)));
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
    const before = matrixReads();

    serverMatrix = matrixOf([true, false]);
    await savedElsewhere(client);
    await waitFor(() => expect(cell(SHOWN.stageOne, true)).toBeTruthy());
    expect(matrixReads()).toBeGreaterThan(before);
    // the unsent tick of stage two is still there, still to be sent
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
    expect(screen.getByText(SHOWN.saveOne)).toBeTruthy();
  });

  it('keeps the ticks after the save until the matrix they were saved into is read', async () => {
    setPhoneScreen(false);
    const client = newClient();
    renderPage(client);
    fireEvent.click(await screen.findByTitle(SHOWN.cell(SHOWN.stageTwo, false)));
    holdEveryMatrix = true;
    fireEvent.click(screen.getByText(SHOWN.saveOne));
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(heldMatrix.length).toBeGreaterThan(0));
    // the saved matrix is not read yet: the tick never flips back meanwhile
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
    expect(cell(SHOWN.stageTwo, false)).toBeNull();

    holdEveryMatrix = false;
    await act(async () => { for (const read of heldMatrix) read.resolve(serverMatrix); });
    await waitFor(() => expect(screen.queryByText(SHOWN.saveOne)).toBeNull());
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
    expect(puts).toEqual([{ items: [{ item_id: 50, stage_order: 2, status: 'completed' }] }]);
  });

  it('a read that started before the save answered never clears the ticks onto the older matrix', async () => {
    setPhoneScreen(false);
    const client = newClient();
    // a page that refreshes nothing after the save: the hook reads its own matrix again
    render(<QueryClientProvider client={client}><ProjectProductProgressTab projectId={7} onUpdate={() => undefined} /></QueryClientProvider>);
    fireEvent.click(await screen.findByTitle(SHOWN.cell(SHOWN.stageTwo, false)));
    // a read under way when the save answers, holding the matrix from before the save
    holdEveryMatrix = true;
    await act(async () => { void client.refetchQueries({ queryKey: productProgressKey(7) }); });
    await waitFor(() => expect(heldMatrix).toHaveLength(1));
    fireEvent.click(screen.getByText(SHOWN.saveOne));
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(heldMatrix).toHaveLength(2));

    await act(async () => { heldMatrix[0]?.resolve(matrixOf([false, false])); });
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();

    holdEveryMatrix = false;
    await act(async () => { heldMatrix[1]?.resolve(serverMatrix); });
    await waitFor(() => expect(screen.queryByText(SHOWN.saveOne)).toBeNull());
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
  });

  it('keeps the ticks unsent when the read after the save fails, and sends them again', async () => {
    setPhoneScreen(false);
    const client = newClient();
    renderPage(client);
    fireEvent.click(await screen.findByTitle(SHOWN.cell(SHOWN.stageTwo, false)));
    holdEveryMatrix = true;
    fireEvent.click(screen.getByText(SHOWN.saveOne));
    await waitFor(() => expect(puts).toHaveLength(1));
    await waitFor(() => expect(heldMatrix.length).toBeGreaterThan(0));
    holdEveryMatrix = false;
    await act(async () => { for (const read of heldMatrix) read.reject(new Error('offline')); });

    // the tick stays, still marked to send, and «ثبت» sends it again
    const again = await screen.findByText(SHOWN.saveOne);
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    fireEvent.click(again);
    await waitFor(() => expect(puts).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(SHOWN.saveOne)).toBeNull());
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
  });

  it('reads the matrix again on each opening of the phone list too', async () => {
    setPhoneScreen(true);
    const client = newClient();
    // an incomplete product, so the list's default «ناتمام» filter would show it
    client.setQueryData(productProgressKey(7), matrixOf([false, true]), { updatedAt: Date.now() - 60_000 });
    holdNextMatrix = true;
    renderPage(client);
    await waitFor(() => expect(heldMatrix).toHaveLength(1));
    expect(screen.queryByRole('checkbox', { name: `${SHOWN.stageOne} برای گردنبند` })).toBeNull();

    await act(async () => { heldMatrix[0]?.resolve(matrixOf([true, false])); });
    const stage = await screen.findByRole('checkbox', { name: `${SHOWN.stageOne} برای گردنبند` });
    expect(stage.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: `${SHOWN.stageTwo} برای گردنبند` }).getAttribute('aria-checked')).toBe('false');
  });
});

const renderDelivery = (client: QueryClient) =>
  render(<QueryClientProvider client={client}><ProjectStockEntryTab project={project as unknown as ProductionProject} onUpdate={() => undefined} /></QueryClientProvider>);
const box = () => screen.getByLabelText(SHOWN.markCompleted) as HTMLInputElement;

describe('the delivery "set completed" box follows the matrix as it is now (10.3)', () => {
  it('never opens from the matrix an earlier visit left in the cache', async () => {
    const client = newClient();
    client.setQueryData(productProgressKey(7), matrixOf([true, true]), { updatedAt: Date.now() - 60_000 });
    holdNextMatrix = true;
    renderDelivery(client);
    await waitFor(() => expect(heldMatrix).toHaveLength(1));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(box().disabled).toBe(true);

    await act(async () => { heldMatrix[0]?.resolve(matrixOf([true, true])); });
    await waitFor(() => expect(box().disabled).toBe(false));
  });

  it('opens once the matrix is completed elsewhere and drops its tick when a newer read says it is not', async () => {
    const client = newClient();
    renderDelivery(client);
    await waitFor(() => expect(matrixReads()).toBe(1));
    await waitFor(() => expect(box().disabled).toBe(true));

    serverMatrix = matrixOf([true, true]);
    await savedElsewhere(client);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    expect(box().checked).toBe(true);

    serverMatrix = matrixOf([true, false]);
    await savedElsewhere(client);
    await waitFor(() => expect(box().disabled).toBe(true));
    expect(box().checked).toBe(false);
  });

  it('reads the matrix again when the box is ticked, so a cell unticked in another browser unticks it', async () => {
    serverMatrix = matrixOf([true, true]);
    const client = newClient();
    renderDelivery(client);
    await waitFor(() => expect(box().disabled).toBe(false));
    const before = matrixReads();

    // another browser unticks a cell; nothing in this one says so
    serverMatrix = matrixOf([true, false]);
    fireEvent.click(box());
    await waitFor(() => expect(matrixReads()).toBe(before + 1));
    await waitFor(() => expect(box().checked).toBe(false));
    expect(box().disabled).toBe(true);
  });
});

describe('a delivery refreshes the stock screens (10.3)', () => {
  it('invalidates the items, documents, kardex and accounting reads as a stock document does', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderDelivery(client);
    const deliver = await screen.findByRole('button', { name: SHOWN.deliver });
    await waitFor(() => expect((deliver as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(deliver);
    const keys = () => invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    await waitFor(() => expect(keys()).toEqual(expect.arrayContaining([
      JSON.stringify(QUERY_KEYS.items.all), JSON.stringify(QUERY_KEYS.documents.all),
      JSON.stringify(QUERY_KEYS.transactions.all), JSON.stringify(QUERY_KEYS.accounting.all),
    ])));
  });
});

describe('the progress and delivery tabs make no read of their own (10.3)', () => {
  it.each([
    'components/project/ProjectProductProgressTab.tsx',
    'components/project/phone/ProjectPhoneProgress.tsx',
    'components/project/progress/ProgressMatrixToolbar.tsx',
    'components/project/progress/ProgressSummary.tsx',
    'hooks/useProductProgressTicks.ts',
    'components/project/ProjectStockEntryTab.tsx',
    'components/project/delivery/useProjectDelivery.ts',
    'components/project/delivery/useDeliveryCompletion.ts',
    'components/project/delivery/DeliveryHeader.tsx',
    'components/project/delivery/DeliveryProductRow.tsx',
  ])('%s reads only through the shared cache', (file) => {
    expect(ownReads(file)).toEqual([]);
  });
});
