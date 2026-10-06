import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useExecuteTaskMutation,
  useExecuteTransitionMutation,
  useSaveWorkflowDefinitionMutation,
  useUpdateCanvasPositionsMutation,
  useWorkflowDefinitionDetailQuery,
} from '../../hooks/queries/useWorkflowQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';

// Caches refreshed after a workflow approval or a design change (package 14, PR د)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
afterEach(() => { cleanup(); fetchJson.mockReset(); });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
  client.setQueryData(QUERY_KEYS.documents.list({}), [{ id: 9, status: 'proforma' }]);
  client.setQueryData(QUERY_KEYS.procurement.all, [{ id: 3, status: 'pending' }]);
  client.setQueryData(QUERY_KEYS.accounting.vouchers({}), [{ id: 4, status: 'draft' }]);
  client.setQueryData(QUERY_KEYS.inventory.reservedItems(), [{ id: 5 }]);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;

describe('TD-469 an approval refreshes the domain lists it may change', () => {
  it('task execution invalidates documents, procurement, accounting and inventory', async () => {
    fetchJson.mockResolvedValue({ success: true, data: { task: { status: 'approved' } } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useExecuteTaskMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ taskId: 1, action: 'approve' }); });
    await waitFor(() => expect(invalidated(client, QUERY_KEYS.documents.list({}))).toBe(true));
    expect(invalidated(client, QUERY_KEYS.procurement.all)).toBe(true);
    expect(invalidated(client, QUERY_KEYS.accounting.vouchers({}))).toBe(true);
    expect(invalidated(client, QUERY_KEYS.inventory.reservedItems())).toBe(true);
  });

  it('a direct transition from the stepper does the same', async () => {
    fetchJson.mockResolvedValue({ success: true, data: {} });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useExecuteTransitionMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ instanceId: 5, transitionId: 21, entityType: 'document', entityId: 9 }); });
    await waitFor(() => expect(invalidated(client, QUERY_KEYS.documents.list({}))).toBe(true));
    expect(invalidated(client, QUERY_KEYS.accounting.vouchers({}))).toBe(true);
  });
});

describe('TD-469 a design change refreshes the opened definition', () => {
  // the designer keeps the detail query mounted: an invalidation refetches it
  async function mountDetail(wrapper: ReturnType<typeof setup>['wrapper']) {
    fetchJson.mockResolvedValue({ id: 1, states: [] });
    const { result } = renderHook(() => useWorkflowDefinitionDetailQuery(1), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  }
  const detailReads = () => fetchJson.mock.calls.filter((c) => c[0] === '/workflow/definitions/1').length;

  it('saving the design refetches the definition detail', async () => {
    const { wrapper } = setup();
    await mountDetail(wrapper);
    expect(detailReads()).toBe(1);
    const { result } = renderHook(() => useSaveWorkflowDefinitionMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 1, title: 't', code: 'C', entityType: 'document' }); });
    await waitFor(() => expect(detailReads()).toBe(2));
  });

  it('saving step positions refetches the definition detail', async () => {
    const { wrapper } = setup();
    await mountDetail(wrapper);
    const { result } = renderHook(() => useUpdateCanvasPositionsMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ definitionId: 1, positions: [{ id: 10, positionX: 5, positionY: 6 }] }); });
    await waitFor(() => expect(detailReads()).toBe(2));
  });
});
