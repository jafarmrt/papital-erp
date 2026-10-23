import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FetchOpts = { method?: string; signal?: AbortSignal };
type Route = (url: string) => unknown;
let route: Route = () => [];
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => route(url));
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));

import { useProjectInventory } from '../../hooks/useProjectInventory';
import { useProjectDeliveryCost, useProjectIssuedMaterials, useProjectMaterialAvailability } from '../../hooks/useProjectMaterialReports';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { QUERY_KEYS, settingsKeys } from '../../lib/queryKeys';
import type { ProductionProject, ProjectInventoryControlSectionData } from '../../types';

// v10.2 package 11 part 5e (TD-1364, OBS-R2-102): the project materials tab reads through React Query. Each test but the
// last is red on the tab that loaded its item list, categories, settings and reports into its own state.

afterEach(() => { cleanup(); vi.clearAllMocks(); route = () => []; });

const GLUE = { id: 3, code: 'G-1', name: 'glue', unit: 'pcs', current_stock: 8, type: 'raw_material' };
const PROJECT = { id: 7, version: 1, title: 'materials', status: 'planned', products: [] } as unknown as ProductionProject;

let issuedRead = 0;
let availabilityRead = 0;
let costRead = 0;
const reportRoute: Route = url => {
  if (url.startsWith('/items/options')) return { data: [GLUE] };
  if (url === '/api/categories') return [{ id: 1, name: 'glue', type: 'raw_material', prefix: 'GL' }];
  if (url === '/api/settings') return [];
  if (url.startsWith('/projects/7/material-availability')) {
    availabilityRead += 1;
    return { projectId: 7, items: [{ itemId: 3, stock: 8, reservedByOthers: 0, issuedToProject: availabilityRead, freeForProject: 8 }] };
  }
  if (url === '/projects/7/issued-materials') {
    issuedRead += 1;
    return { projectId: 7, costVisible: false, rows: [], total: issuedRead, totalCost: null };
  }
  if (url === '/projects/7/delivery-cost') {
    costRead += 1;
    return { projectId: 7, costVisible: true, wipBalance: 1000 * costRead, products: [{ itemId: 3, plannedQty: 2, deliveredQty: 0, weightedAverageCost: 10 }] };
  }
  return [];
};

function newClient() {
  // the app's freshness window (src/lib/queryClient.ts), so a test sees what a cached screen would
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
}
function wrapperOf(client: QueryClient) {
  return function Provider({ children }: { children: ReactNode }) {
    const [c] = useState(client);
    return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
  };
}
const callsOf = (url: string) => fetchJson.mock.calls.filter(c => String(c[0]).startsWith(url)).length;

describe('project_inventory_one_data_layer_td_1364', () => {
  it('reads no item list, categories or settings the other screens have just read', async () => {
    route = reportRoute;
    const client = newClient();
    client.setQueryData([...QUERY_KEYS.items.all, 'options', 'project-workspace'], [GLUE]);
    client.setQueryData(QUERY_KEYS.categories.list(), [{ id: 1, name: 'glue', type: 'raw_material', prefix: 'GL' }]);
    client.setQueryData(settingsKeys.all, []);
    const { result } = renderHook(() => useProjectInventory(PROJECT), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.availability.status).toBe('ready'));
    expect(result.current.allCategories.map(c => c.name)).toEqual(['glue']);
    expect(callsOf('/items/options')).toBe(0);
    expect(callsOf('/api/categories')).toBe(0);
    expect(callsOf('/api/settings')).toBe(0);
  });

  it('a document change reads the free stock, the issued materials and the delivery cost of an open tab again', async () => {
    issuedRead = 0; availabilityRead = 0; costRead = 0;
    route = reportRoute;
    const client = newClient();
    const { result } = renderHook(() => ({
      availability: useProjectMaterialAvailability(7, [3], 'loaded', 1),
      issued: useProjectIssuedMaterials(7, 1),
      cost: useProjectDeliveryCost(7, true, 1),
    }), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.issued.data?.total).toBe(1));
    await waitFor(() => expect(result.current.availability.report?.items[0].issuedToProject).toBe(1));
    await waitFor(() => expect(result.current.cost.data?.wipBalance).toBe(1000));
    // a remittance recorded on the stock page
    await act(async () => { await invalidatePreset(client, 'documentChange'); });
    await waitFor(() => expect(result.current.issued.data?.total).toBe(2));
    await waitFor(() => expect(result.current.availability.report?.items[0].issuedToProject).toBe(2));
    await waitFor(() => expect(result.current.cost.data?.wipBalance).toBe(2000));
  });

  it('the figures on screen stay while they are read again', async () => {
    issuedRead = 0;
    let release: () => void = () => undefined;
    route = url => {
      if (url === '/projects/7/issued-materials' && issuedRead >= 1) {
        return new Promise(resolve => { release = () => resolve(reportRoute(url)); });
      }
      return reportRoute(url);
    };
    const client = newClient();
    const { result } = renderHook(() => useProjectIssuedMaterials(7, 1), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.data?.total).toBe(1));
    await act(async () => { void invalidatePreset(client, 'documentChange'); });
    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.data?.total).toBe(1);
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.data?.total).toBe(2));
  });

  it('a later read of the item list keeps the sections the user changed', async () => {
    route = reportRoute;
    const client = newClient();
    const { result } = renderHook(() => useProjectInventory(PROJECT), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.availability.status).toBe('ready'));
    const edited = [{ id: 'mine', title: 'mine', checkType: 'global', globalItems: [] }] as unknown as ProjectInventoryControlSectionData[];
    act(() => { result.current.setSections(edited); });
    const before = callsOf('/items/options');
    route = url => (url.startsWith('/items/options') ? { data: [{ ...GLUE, current_stock: 1 }] } : reportRoute(url));
    await act(async () => { await invalidatePreset(client, 'documentChange'); });
    await waitFor(() => expect(callsOf('/items/options')).toBe(before + 1));
    await waitFor(() => expect(result.current.warehouseItems[0]?.current_stock).toBe(1));
    expect(result.current.sections).toBe(edited);
  });
});
