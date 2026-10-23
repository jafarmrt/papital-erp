import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ownReads } from './helpers/ownReads';

/**
 * 10.3 (ARCH review finding 3, part 12): the sales file drawer and the attachment box read through the shared cache. Each
 * opening reads again and never shows what an earlier opening left in the cache; a sales change refreshes every sales
 * read, the open drawer included; the drawer shows the file as read now; a file sent or removed refreshes the file
 * detail and the activity lists that count files.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  removeOld: 'حذف old.pdf',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
let serverLeadTitle = 'fresh';
const file = (id: string, name: string) => ({ id, name, type: 'application/pdf', size: 10, url: `/${id}`, hasLight: false, lightUrl: null, uploadedBy: 'u', uploadedAt: '2026-10-01' });
let serverFiles = [file('f1', 'old.pdf')];
let holdNext: string | null = null;
let failDetail = false;
const held: Array<(answer: unknown) => void> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (holdNext && url === holdNext && !opts?.method) {
    holdNext = null;
    return new Promise(resolve => { held.push(resolve); });
  }
  if (opts?.method === 'DELETE' && url.includes('/attachments/')) {
    serverFiles = [];
    return { success: true };
  }
  if (opts?.method) return { success: true };
  if (url === '/crm/leads/1' && failDetail) throw new Error('read failed');
  if (url === '/crm/leads/1') return { id: 1, title: serverLeadTitle, stage: 'lead', activities: [{ id: 11, title: 'call' }], attachments: [] };
  if (url === '/crm/leads/1/attachments') return { data: serverFiles };
  if (url.startsWith('/crm/stats')) return {};
  if (url === '/settings') return {};
  return [];
});
vi.mock('../../api', () => ({
  API_URL: '/api',
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));

import { useCRMData } from '../../hooks/useCRMData';
import { CrmAttachmentsPanel } from '../../components/crm/CrmAttachmentsPanel';
import { CRM_LEAD_DETAIL_KEY, crmAttachmentsKey, crmLeadDetailKey } from '../../hooks/queries/useCrmQueries';
import { CRM_ACTIVITY_PAGE_QUERY_KEY } from '../../lib/crm/crmListPages';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { CRMLead } from '../../types';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverLeadTitle = 'fresh';
  serverFiles = [file('f1', 'old.pdf')];
  holdNext = null;
  failDetail = false;
  held.length = 0;
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const detailReads = () => fetchJson.mock.calls.filter(([u, o]) => u === '/crm/leads/1' && !o?.method).length;
const keysOf = (spy: { mock: { calls: Array<[{ queryKey?: unknown }?, ...unknown[]]> } }) => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
const row = { id: 1, title: 'row', stage: 'lead' } as CRMLead;

describe('the sales file drawer reads through the shared cache (10.3)', () => {
  it('reads the file again on each opening, never shows an earlier opening\'s detail, and shows the file as read now', async () => {
    const client = newClient();
    client.setQueryData(crmLeadDetailKey(1), { lead: { ...row, title: 'cached' }, activities: [{ id: 99 }] }, { updatedAt: Date.now() - 60_000 });
    holdNext = '/crm/leads/1';
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper: wrapperOf(client) });
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(result.current.drawerActivities).toEqual([]);
    expect(result.current.selectedLeadDrawer?.title).toBe('row');

    await act(async () => { held[0]?.({ id: 1, title: 'fresh', stage: 'lead', activities: [{ id: 11 }] }); });
    await waitFor(() => expect(result.current.drawerActivities.map(a => a.id)).toEqual([11]));
    expect(result.current.selectedLeadDrawer?.title).toBe('fresh');

    // closed and opened again: read again
    act(() => { result.current.setSelectedLeadDrawer(null); });
    const before = detailReads();
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(detailReads()).toBe(before + 1));
  });

  it('a stage change refreshes every sales read, the open drawer and the dashboard widget included', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper: wrapperOf(client) });
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(result.current.selectedLeadDrawer?.title).toBe('fresh'));
    serverLeadTitle = 'renamed';
    await act(async () => { await result.current.handleStageChange(1, 'qualified'); });
    expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.crm.all));
    await waitFor(() => expect(result.current.selectedLeadDrawer?.title).toBe('renamed'));
  });

  it('says a failed read once', async () => {
    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    toast.error.mockClear();
    failDetail = true;
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }, { withLists: false }), { wrapper: wrapperOf(newClient()) });
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('read failed'));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(toast.error.mock.calls.filter(([m]) => m === 'read failed')).toHaveLength(1);
  });
});

describe('the attachment box reads through the shared cache (10.3)', () => {
  it('shows the files the parent has while it reads, never an earlier opening\'s list', async () => {
    const client = newClient();
    client.setQueryData(crmAttachmentsKey('lead', 1), [file('f9', 'cached.pdf')], { updatedAt: Date.now() - 60_000 });
    holdNext = '/crm/leads/1/attachments';
    const initial = [file('f2', 'parent.pdf')];
    render(<CrmAttachmentsPanel owner="lead" ownerId={1} initial={initial} />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(screen.queryAllByText('cached.pdf')).toHaveLength(0);
    expect(screen.getAllByText('parent.pdf').length).toBeGreaterThan(0);
    await act(async () => { held[0]?.({ data: serverFiles }); });
    expect((await screen.findAllByText('old.pdf')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('parent.pdf')).toHaveLength(0);
  });

  it('a removal updates the list and refreshes the file detail and the activity lists', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    render(<CrmAttachmentsPanel owner="lead" ownerId={1} />, { wrapper: wrapperOf(client) });
    fireEvent.click(await screen.findByLabelText(SHOWN.removeOld));
    await waitFor(() => expect(screen.queryAllByText('old.pdf')).toHaveLength(0));
    expect(keysOf(invalidated)).toEqual(expect.arrayContaining([JSON.stringify(CRM_LEAD_DETAIL_KEY), JSON.stringify(CRM_ACTIVITY_PAGE_QUERY_KEY)]));
  });
});

describe('the sales screens make no read of their own (10.3)', () => {
  it.each([
    'hooks/useCRMData.ts',
    'hooks/useLeadDrawerActivities.ts',
    'components/crm/CRMLeadDrawer.tsx',
    'components/crm/CrmAttachmentsPanel.tsx',
    'components/crm/CustomerDossierDrawer.tsx',
    'pages/CRMPage.tsx',
  ])('%s reads only through the shared cache', (file) => {
    expect(ownReads(file)).toEqual([]);
  });

  // read when a link or a request to edit is followed, to open what it names: an answer for that moment, never shown from a cache
  it.each([
    ['hooks/useCrmDeepLink.ts', 2],
    ['pages/CustomersPage.tsx', 1],
  ] as const)('%s reads on demand only (%i)', (file, count) => {
    expect(ownReads(file)).toHaveLength(count);
  });
});
