import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';
import { ownReads } from './helpers/ownReads';
import { SHOWN, matrixOf, project, type FetchOpts } from './helpers/progressMatrix';

/**
 * 10.3 (ARCH review finding 3, part 10): the progress tab, its phone list and the delivery tab read the progress matrix
 * through the shared cache. Each opening reads it again and never shows what an earlier visit left in the cache; a save
 * elsewhere refreshes an open tab, the unsent ticks staying on top; after «ثبت» the ticks stay until the saved matrix is
 * read (and stay shown as saved if that read fails). The delivery tab is in projectDeliveryDataLayer10_3.test.tsx.
 */
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
import ProjectProductProgressTab from '../../components/project/ProjectProductProgressTab';
import toast from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { productProgressKey } from '../../hooks/queries/useProjectWorkspaceQueries';

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

  it('shows the saved ticks when the read after the save fails, never offering them again, until a read succeeds', async () => {
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

    // the saved tick stays on screen, but nothing is left to send
    await waitFor(() => expect(screen.queryByText(SHOWN.saveOne)).toBeNull());
    expect(cell(SHOWN.stageTwo, true)).toBeTruthy();
    expect(vi.mocked(toast.error)).toHaveBeenCalled();

    // the tab says the matrix on screen is an older read, with another try; another browser unticks the cell, and the
    // read that succeeds is what the tab shows
    const notice = await screen.findByText(content => content.startsWith(SHOWN.staleNotice));
    serverMatrix = matrixOf([false, false]);
    fireEvent.click(within(notice.parentElement as HTMLElement).getByRole('button', { name: SHOWN.retry }));
    await waitFor(() => expect(cell(SHOWN.stageTwo, false)).toBeTruthy());
    expect(screen.queryByText(content => content.startsWith(SHOWN.staleNotice))).toBeNull();
    expect(puts).toHaveLength(1);
  });

  it('keeps the ticks of two saves whose reads both failed', async () => {
    setPhoneScreen(false);
    const client = newClient();
    renderPage(client);
    const saveFailingRead = async (stage: string) => {
      fireEvent.click(await screen.findByTitle(SHOWN.cell(stage, false)));
      holdEveryMatrix = true;
      fireEvent.click(screen.getByText(SHOWN.saveOne));
      await waitFor(() => expect(heldMatrix.length).toBeGreaterThan(0));
      holdEveryMatrix = false;
      await act(async () => { for (const read of heldMatrix.splice(0)) read.reject(new Error('offline')); });
      await waitFor(() => expect(screen.queryByText(SHOWN.saveOne)).toBeNull());
    };
    await saveFailingRead(SHOWN.stageTwo);
    await saveFailingRead(SHOWN.stageOne);

    // the server holds both; neither flips back on screen
    expect(puts).toHaveLength(2);
    expect(cell(SHOWN.stageOne, true)).toBeTruthy();
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

describe('the progress and delivery tabs make no read of their own (10.3)', () => {
  it.each([
    'components/project/ProjectProductProgressTab.tsx',
    'components/project/phone/ProjectPhoneProgress.tsx',
    'components/project/progress/ProgressMatrixToolbar.tsx',
    'components/project/progress/ProgressSummary.tsx',
    'components/project/progress/StaleProgressNotice.tsx',
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
