import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SHOWN, matrixOf, project, type FetchOpts } from './helpers/progressMatrix';

/**
 * 10.3 (ARCH review finding 3, part 10): the delivery tab's «تکمیل‌شده» box follows the progress matrix as it is now: never
 * the one an earlier visit left in the cache, read again when the box is ticked or a delivery asking for it is refused.
 * A delivery refreshes the stock screens as any stock document does.
 */
let serverMatrix = matrixOf([false, false]);
/** the next matrix read waits for the test */
let holdNextMatrix = false;
const heldMatrix: Array<{ resolve: (answer: unknown) => void }> = [];
/** the server refuses the next delivery (the matrix it checks is not complete) */
let refuseDelivery = false;
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7/product-progress') {
    if (holdNextMatrix) {
      holdNextMatrix = false;
      return new Promise(resolve => { heldMatrix.push({ resolve }); });
    }
    return serverMatrix;
  }
  if (url === '/projects/7/add-to-inventory') {
    if (refuseDelivery) throw new Error('matrix not complete');
    return { success: true, addedCount: 1, refNumber: 31 };
  }
  if (url === '/projects/7/delivery-cost') return { projectId: 7, costVisible: false, wipBalance: null, products: [] };
  if (url === '/warehouses') return [{ id: 1, code: 'WH1', name: 'انبار آزمون' }];
  return opts?.method ? {} : [];
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

import ProjectStockEntryTab from '../../components/project/ProjectStockEntryTab';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { productProgressKey } from '../../hooks/queries/useProjectWorkspaceQueries';
import type { ProductionProject } from '../../types';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverMatrix = matrixOf([false, false]);
  holdNextMatrix = false;
  heldMatrix.length = 0;
  refuseDelivery = false;
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const matrixReads = () => fetchJson.mock.calls.filter(([u, o]) => u === '/projects/7/product-progress' && !o?.method).length;
/** a save elsewhere (a stock document, a workshop approval) invalidates the project and what hangs under it */
const savedElsewhere = (client: QueryClient) => act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.projects.all }); });
const deliverButton = async () => {
  const deliver = await screen.findByRole('button', { name: SHOWN.deliver }) as HTMLButtonElement;
  await waitFor(() => expect(deliver.disabled).toBe(false));
  return deliver;
};

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

  it('reads the matrix again when a delivery asking for it is refused, so the box unticks', async () => {
    serverMatrix = matrixOf([true, true]);
    const client = newClient();
    renderDelivery(client);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    await waitFor(() => expect(fetchJson.mock.calls.filter(([u]) => u === '/projects/7/product-progress').length).toBe(2));
    expect(box().checked).toBe(true);

    // another browser unticks a cell; the server refuses the delivery that asks for «تکمیل‌شده»
    serverMatrix = matrixOf([true, false]);
    refuseDelivery = true;
    const before = matrixReads();
    fireEvent.click(await deliverButton());
    await waitFor(() => expect(matrixReads()).toBe(before + 1));
    await waitFor(() => expect(box().checked).toBe(false));
  });
});

describe('a delivery refreshes the stock screens (10.3)', () => {
  it('invalidates the items, documents, kardex and accounting reads as a stock document does', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderDelivery(client);
    fireEvent.click(await deliverButton());
    const keys = () => invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    await waitFor(() => expect(keys()).toEqual(expect.arrayContaining([
      JSON.stringify(QUERY_KEYS.items.all), JSON.stringify(QUERY_KEYS.documents.all),
      JSON.stringify(QUERY_KEYS.transactions.all), JSON.stringify(QUERY_KEYS.accounting.all),
    ])));
  });
});
