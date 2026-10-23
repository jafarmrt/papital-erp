import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

/**
 * 10.3 (ARCH review finding 3, part 11 review): the materials planning page picks a project without trapping Back, holds
 * the project while the materials tab is saving (busy, not dirty), and reads the project again after the tab's save.
 */
type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
let serverProjectTitle = 'v1';
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/options') return [{ id: 7, project_code: 'PRJ-7', title: 'open', status: 'in_progress' }];
  if (url === '/projects/7') return { id: 7, version: 3, project_code: 'PRJ-7', title: serverProjectTitle, status: 'in_progress', products: [] };
  return [];
});
vi.mock('../../api', () => ({
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: () => false,
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));
// a materials tab that reports a save the way the real one does: busy only (dirty is false while saving), then its update
vi.mock('../../components/project/ProjectInventoryTab', () => ({
  default: ({ project, onBusyChange, onDirtyChange, onUpdate }: {
    project: { title: string }; onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void; onUpdate?: () => unknown;
  }) => (
    <div>
      <span data-testid="materials-project">{project.title}</span>
      <button type="button" onClick={() => { onDirtyChange?.(false); onBusyChange?.(true); }}>saving</button>
      <button type="button" onClick={() => { onBusyChange?.(false); }}>done</button>
      <button type="button" onClick={() => { void onUpdate?.(); }}>saved</button>
    </div>
  ),
}));

import ProjectInventoryPage from '../../pages/ProjectInventoryPage';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverProjectTitle = 'v1';
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const shownTitle = () => screen.queryByTestId('materials-project')?.textContent;
const pause = () => act(() => new Promise(resolve => setTimeout(resolve, 30)));
const renderAt = (client: QueryClient, entries: string[]) => {
  const router = createMemoryRouter([
    { path: '/home', element: <div>home</div> },
    { path: '/project-inventory', element: <ProjectInventoryPage /> },
  ], { initialEntries: entries, initialIndex: entries.length - 1 });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
};

describe('the materials planning page (10.3)', () => {
  it('picks the first open project without trapping Back on the page', async () => {
    const router = renderAt(newClient(), ['/home', '/project-inventory']);
    await waitFor(() => expect(shownTitle()).toBe('v1'));
    await act(async () => { await router.navigate(-1); });
    await pause();
    expect(router.state.location.pathname).toBe('/home');
  });

  it('holds the project while the tab is saving, then shows the newer one', async () => {
    const client = newClient();
    renderAt(client, ['/project-inventory?projectId=7']);
    await waitFor(() => expect(shownTitle()).toBe('v1'));
    fireEvent.click(screen.getByText('saving'));
    serverProjectTitle = 'v2';
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.projects.all }); });
    await pause();
    expect(shownTitle()).toBe('v1');
    fireEvent.click(screen.getByText('done'));
    await waitFor(() => expect(shownTitle()).toBe('v2'));
  });

  it('reads the project again after the tab saved it', async () => {
    renderAt(newClient(), ['/project-inventory?projectId=7']);
    await waitFor(() => expect(shownTitle()).toBe('v1'));
    const reads = () => fetchJson.mock.calls.filter(([u]) => u === '/projects/7').length;
    const before = reads();
    serverProjectTitle = 'v2';
    fireEvent.click(screen.getByText('saved'));
    await waitFor(() => expect(shownTitle()).toBe('v2'));
    expect(reads()).toBe(before + 1);
  });
});
