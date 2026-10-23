import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * 10.3 (ARCH review finding 3, part 11 review): finalize sends the sections as they were when the button was pressed, so
 * an edit made while its confirm is open is not sent and stays marked unsaved.
 */
type FetchOpts = { method?: string; body?: string };
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/api/projects/7' && opts?.method === 'PUT') return { version: 4, inventory_control: {} };
  if (url === '/settings') return {};
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const openConfirms: Array<(ok: boolean) => void> = [];
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: () => new Promise<boolean>(resolve => { openConfirms.push(resolve); }) }));

import { useProjectInventory } from '../../hooks/useProjectInventory';
import type { ProductionProject } from '../../types';

const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'materials', status: 'in_progress', quantity: 2, unit: 'pcs', stages: [],
  products: [{ id: 'p1', item_id: 50, quantity: 2 }],
} as unknown as ProductionProject;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('finalize sends the sections of the press (10.3)', () => {
  it('keeps an edit made while the confirm is open unsent and unsaved', async () => {
    const { result } = renderHook(() => useProjectInventory(project), { wrapper });
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    act(() => { result.current.handleUpdateSectionDescription(0, 'first'); });
    let finalizing: Promise<void> = Promise.resolve();
    act(() => { finalizing = result.current.handleFinalizeAndReserveStock(); });
    await waitFor(() => expect(openConfirms).toHaveLength(1));
    act(() => { result.current.handleUpdateSectionDescription(0, 'second'); });
    await act(async () => { openConfirms[0]?.(true); await finalizing; });

    const put = fetchJson.mock.calls.find(([, opts]) => opts?.method === 'PUT');
    const sent = JSON.parse(String(put?.[1]?.body)) as { inventory_control: { sections: Array<{ description?: string }> } };
    expect(sent.inventory_control.sections[0]?.description).toBe('first');
    expect(result.current.isDirty).toBe(true);
  });
});
