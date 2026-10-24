import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ownReads } from './helpers/ownReads';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 12): the sales file drawer and the attachment box read through the shared cache. Each
 * opening reads again and never shows what an earlier opening left in the cache; a sales change refreshes every sales
 * read, the open drawer included; the drawer shows the file as read now; a file sent or removed refreshes the box, the
 * file detail and the activity lists that count files, and a read already on its way never undoes it; a failed refresh
 * keeps the list on screen.
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
let failFiles = false;
let leadGone = false;
const held: Array<(answer: unknown) => void> = [];
const heldSends: Array<(answer: unknown) => void> = [];
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
  if (url === '/crm/leads/1' && leadGone) throw new Error('lead 404');
  if (url === '/crm/leads/1') return { id: 1, title: serverLeadTitle, stage: 'lead', activities: [{ id: 11, title: 'call' }], attachments: [] };
  if (url === '/crm/leads/2') return { id: 2, title: 'second', stage: 'lead', activities: [{ id: 21, title: 'visit' }], attachments: [] };
  if (url === '/crm/leads/1/attachments' && failFiles) throw new Error('list failed');
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
vi.mock('../../lib/media/mediaUpload', async (original) => ({
  ...(await original<object>()),
  sendRawFile: () => new Promise(resolve => { heldSends.push(resolve); }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));

import { useCRMData } from '../../hooks/useCRMData';
import { useLeadDrawerActivities } from '../../hooks/useLeadDrawerActivities';
import { CrmAttachmentsPanel } from '../../components/crm/CrmAttachmentsPanel';
import { CRM_LEAD_DETAIL_KEY, crmAttachmentsKey, crmLeadDetailKey } from '../../hooks/queries/useCrmQueries';
import { CRM_ACTIVITY_PAGE_QUERY_KEY } from '../../lib/crm/crmListPages';
import { CRM_FOLLOWUPS_QUERY_KEY } from '../../lib/crm/crmFollowupsQuery';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { CRMLead } from '../../types';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverLeadTitle = 'fresh';
  serverFiles = [file('f1', 'old.pdf')];
  holdNext = null;
  failDetail = false;
  failFiles = false;
  leadGone = false;
  held.length = 0;
  heldSends.length = 0;
});

/** the app's read defaults (fresh for five minutes): a screen must read again on its own */
const newClient = appQueryClient;
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const detailReads = () => fetchJson.mock.calls.filter(([u, o]) => u === '/crm/leads/1' && !o?.method).length;
const keysOf = (spy: { mock: { calls: Array<[{ queryKey?: unknown }?, ...unknown[]]> } }) => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
const row = { id: 1, title: 'row', stage: 'lead' } as CRMLead;
const listReads = () => fetchJson.mock.calls.filter(([u, o]) => u === '/crm/leads/1/attachments' && !o?.method).length;
const pdf = (name: string) => new File([name], name, { type: 'application/pdf' });
const pick = (container: HTMLElement, picked: File[]) => {
  fireEvent.change(container.querySelector('input[type=file]') as HTMLInputElement, { target: { files: picked } });
};
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));

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

    // 10.3 package 7: shown again while it is open (a notification naming it): read again
    await settle();
    const shown = detailReads();
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(detailReads()).toBe(shown + 1));
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
    const { result, rerender } = renderHook(() => useCRMData({ id: 1, username: 'u' }, { withLists: false }), { wrapper: wrapperOf(newClient()) });
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('read failed'));
    rerender();
    rerender();
    await settle();
    expect(toast.error.mock.calls.filter(([m]) => m === 'read failed')).toHaveLength(1);
  });

  it('showing another file without closing is a new opening: coming back never shows the first reading', async () => {
    const client = newClient();
    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useLeadDrawerActivities(id), { wrapper: wrapperOf(client), initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.drawerActivities.map(a => a.id)).toEqual([11]));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.drawerActivities.map(a => a.id)).toEqual([21]));
    holdNext = '/crm/leads/1';
    rerender({ id: 1 });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(result.current.drawerActivities).toEqual([]);
    expect(result.current.drawerLead).toBeNull();
    await act(async () => { held[0]?.({ id: 1, title: 'again', stage: 'lead', activities: [{ id: 12 }] }); });
    await waitFor(() => expect(result.current.drawerActivities.map(a => a.id)).toEqual([12]));
  });

  it('deleting the open file closes the drawer without reading the deleted file again', async () => {
    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    toast.error.mockClear();
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper: wrapperOf(newClient()) });
    act(() => { result.current.openLeadDrawer(row); });
    await waitFor(() => expect(result.current.selectedLeadDrawer?.title).toBe('fresh'));
    const before = detailReads();
    leadGone = true;
    await act(async () => { await result.current.handleDeleteLead(1); });
    await settle();
    expect(result.current.selectedLeadDrawer).toBeNull();
    expect(detailReads()).toBe(before);
    expect(toast.error).not.toHaveBeenCalled();
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
    expect(keysOf(invalidated)).toEqual(expect.arrayContaining([crmAttachmentsKey('lead', 1), CRM_LEAD_DETAIL_KEY, CRM_ACTIVITY_PAGE_QUERY_KEY, CRM_FOLLOWUPS_QUERY_KEY].map(k => JSON.stringify(k))));
  });

  it('a file sent shows in the list and refreshes the box, the file detail, the activity lists and the follow-ups', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { container } = render(<CrmAttachmentsPanel owner="lead" ownerId={1} />, { wrapper: wrapperOf(client) });
    expect((await screen.findAllByText('old.pdf')).length).toBeGreaterThan(0);
    pick(container, [pdf('a.pdf')]);
    await waitFor(() => expect(heldSends).toHaveLength(1));
    serverFiles = [...serverFiles, file('f2', 'a.pdf')];
    await act(async () => { heldSends[0]?.({ data: file('f2', 'a.pdf') }); });
    expect((await screen.findAllByText('a.pdf')).length).toBeGreaterThan(0);
    expect(keysOf(invalidated)).toEqual(expect.arrayContaining([crmAttachmentsKey('lead', 1), CRM_LEAD_DETAIL_KEY, CRM_ACTIVITY_PAGE_QUERY_KEY, CRM_FOLLOWUPS_QUERY_KEY].map(k => JSON.stringify(k))));
  });

  it('a list read on its way during a send never takes back a file sent after the server read it', async () => {
    const client = newClient();
    const { container } = render(<CrmAttachmentsPanel owner="lead" ownerId={1} />, { wrapper: wrapperOf(client) });
    expect((await screen.findAllByText('old.pdf')).length).toBeGreaterThan(0);
    pick(container, [pdf('a.pdf'), pdf('b.pdf')]);
    await waitFor(() => expect(heldSends).toHaveLength(1));
    // another sales write refreshes every sales read; the server reads the list before a.pdf is stored, the answer comes late
    holdNext = '/crm/leads/1/attachments';
    await act(async () => { void client.invalidateQueries({ queryKey: QUERY_KEYS.crm.all }); });
    await waitFor(() => expect(held).toHaveLength(1));
    serverFiles = [file('f1', 'old.pdf'), file('f2', 'a.pdf')];
    await act(async () => { heldSends[0]?.({ data: file('f2', 'a.pdf') }); });
    await waitFor(() => expect(heldSends).toHaveLength(2));
    await act(async () => { held[0]?.({ data: [file('f1', 'old.pdf')] }); });
    await settle();
    expect(screen.queryAllByText('a.pdf').length).toBeGreaterThan(0);

    serverFiles = [...serverFiles, file('f3', 'b.pdf')];
    await act(async () => { heldSends[1]?.({ data: file('f3', 'b.pdf') }); });
    await settle();
    expect(screen.queryAllByText('a.pdf').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('b.pdf').length).toBeGreaterThan(0);
  });

  it('a failed first read says so', async () => {
    failFiles = true;
    render(<CrmAttachmentsPanel owner="lead" ownerId={1} />, { wrapper: wrapperOf(newClient()) });
    expect((await screen.findByRole('alert')).textContent).toBe('list failed');
  });

  it('a file the list already holds when its send answers is shown once', async () => {
    const client = newClient();
    const { container } = render(<CrmAttachmentsPanel owner="lead" ownerId={1} />, { wrapper: wrapperOf(client) });
    expect((await screen.findAllByText('old.pdf')).length).toBeGreaterThan(0);
    pick(container, [pdf('a.pdf')]);
    await waitFor(() => expect(heldSends).toHaveLength(1));
    // the server stored the file and a list read answered before the send's own answer
    serverFiles = [file('f1', 'old.pdf'), file('f2', 'a.pdf')];
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.crm.all }); });
    expect((await screen.findAllByText('a.pdf')).length).toBeGreaterThan(0);
    const shown = screen.getAllByText('a.pdf').length;
    holdNext = '/crm/leads/1/attachments';
    await act(async () => { heldSends[0]?.({ data: file('f2', 'a.pdf') }); });
    expect(screen.getAllByText('a.pdf')).toHaveLength(shown);
  });

  it('a failed refresh keeps the list on screen and says so', async () => {
    const client = newClient();
    render(<CrmAttachmentsPanel owner="lead" ownerId={1} />, { wrapper: wrapperOf(client) });
    expect((await screen.findAllByText('old.pdf')).length).toBeGreaterThan(0);
    failFiles = true;
    const before = listReads();
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.crm.all }); });
    expect(listReads()).toBe(before + 1);
    expect((await screen.findByRole('alert')).textContent).toBe('list failed');
    expect(screen.getAllByText('old.pdf').length).toBeGreaterThan(0);
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
