import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { ownReads } from './helpers/ownReads';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 16): the project form reads its customer and item pick lists and the stage templates
 * through the shared cache, again on each opening and never while closed; until this opening's answer it offers the lists
 * the page passed in, never what an earlier opening left; a failed list says so once; a customer or item change elsewhere
 * refreshes the open form's lists.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = { customersFailed: 'خطا در دریافت لیست مشتریان', itemsFailed: 'خطا در دریافت لیست اقلام' } as const;

type Opts = { method?: string; signal?: AbortSignal };
const preset = (id: string) => ({ id, title: `template ${id}`, description: '', stages: ['cut'] });
const server = {
  customers: [{ id: 1, name: 'fresh customer' }] as unknown[],
  items: [{ id: 2, name: 'fresh item' }] as unknown[],
  settings: [{ key: 'project_workflow_presets', value: JSON.stringify([preset('necklace'), preset('tile_transfer')]) }] as unknown[],
};
// v11 phase 6.1ch (C13): the form reads at most the cap of each list
const CUSTOMERS_URL = '/customers/options?limit=1001';
const ITEMS_URL = '/items/options?limit=1001';
const reads = { hold: null as string | null, fail: null as string | null, held: [] as Array<(answer: unknown) => void> };
const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  if (opts?.method) return { success: true };
  if (reads.hold === url) { reads.hold = null; return new Promise(resolve => { reads.held.push(resolve); }); }
  if (reads.fail === url) { reads.fail = null; throw new Error('server refused the read'); }
  if (url === CUSTOMERS_URL) return server.customers;
  if (url === ITEMS_URL) return { data: server.items };
  if (url === '/settings') return server.settings;
  return [];
});
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (url: string, opts?: Opts) => fetchJson(url, opts), isAbortError: () => false }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => toastError(m), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { useProjectForm } from '../../components/project-modal/useProjectForm';
import { QUERY_KEYS, settingsKeys } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockClear();
  Object.assign(reads, { hold: null, fail: null, held: [] });
  server.customers = [{ id: 1, name: 'fresh customer' }];
  server.items = [{ id: 2, name: 'fresh item' }];
  server.settings = [{ key: 'project_workflow_presets', value: JSON.stringify([preset('necklace'), preset('tile_transfer')]) }];
});

const PAGE_CUSTOMERS = [{ id: 9, name: 'page customer' }];
const PAGE_ITEMS = [{ id: 8, name: 'page item' }];
/** the app's read defaults (fresh for five minutes): the screen must read again on its own */
const newClient = appQueryClient;
function formOf(client: QueryClient, isOpen = true) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(({ open }: { open: boolean }) => useProjectForm({
    isOpen: open, onClose: vi.fn(), projectToEdit: null, customersList: PAGE_CUSTOMERS, itemsList: PAGE_ITEMS, onSuccess: vi.fn(),
  } as never), { wrapper, initialProps: { open: isOpen } });
}
/** the time an earlier opening read its data */
const earlier = () => ({ updatedAt: Date.now() - 60_000 });
const readsOf = (url: string) => fetchJson.mock.calls.filter(([u, o]) => u === url && !o?.method).length;
const namesOf = (rows: Array<{ name?: string }>) => rows.map(r => r.name);
const LISTS = [CUSTOMERS_URL, ITEMS_URL, '/settings'];

describe('the project form reads its lists through the shared cache (10.3)', () => {
  it('reads its lists again on each opening, and never while closed', async () => {
    const { result, rerender } = formOf(newClient(), false);
    await new Promise(resolve => setTimeout(resolve, 20));
    for (const url of LISTS) expect(readsOf(url)).toBe(0);
    rerender({ open: true });
    await waitFor(() => expect(namesOf(result.current.activeCustomersList)).toEqual(['fresh customer']));
    rerender({ open: false });
    reads.hold = CUSTOMERS_URL;
    rerender({ open: true });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    // the first opening's list waits for this opening's answer
    expect(namesOf(result.current.activeCustomersList)).toEqual(['page customer']);
    await act(async () => { reads.held[0]?.([{ id: 3, name: 'later customer' }]); });
    await waitFor(() => expect(namesOf(result.current.activeCustomersList)).toEqual(['later customer']));
    for (const url of LISTS) expect(readsOf(url)).toBe(2);
  });

  it.each([
    ['items', ITEMS_URL, () => { server.items = [{ id: 3, name: 'later item' }]; }, { data: [{ id: 3, name: 'later item' }] }],
    ['templates', '/settings', () => { server.settings = [{ key: 'project_workflow_presets', value: JSON.stringify([preset('earring')]) }]; }, null],
  ] as const)('the first opening\'s %s wait for this opening\'s answer', async (name, url, change, answer) => {
    const { result, rerender } = formOf(newClient());
    await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['necklace']));
    await waitFor(() => expect(namesOf(result.current.activeItemsList)).toEqual(['fresh item']));
    rerender({ open: false });
    change();
    reads.hold = url;
    rerender({ open: true });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    if (name === 'items') expect(namesOf(result.current.activeItemsList)).toEqual(['page item']);
    else expect(result.current.availablePresets).toEqual([]);
    await act(async () => { reads.held[0]?.(answer ?? server.settings); });
    if (name === 'items') await waitFor(() => expect(namesOf(result.current.activeItemsList)).toEqual(['later item']));
    else await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['earring']));
  });

  it('offers the page\'s lists, never an earlier opening\'s, until this opening\'s answer', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.customers.options({ all: true }), [{ id: 4, name: 'stale customer' }], earlier());
    client.setQueryData([...QUERY_KEYS.items.all, 'options', 'project-form'], [{ id: 5, name: 'stale item' }], earlier());
    reads.hold = CUSTOMERS_URL;
    const { result } = formOf(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    await waitFor(() => expect(namesOf(result.current.activeItemsList)).toEqual(['fresh item']));
    expect(namesOf(result.current.activeCustomersList)).toEqual(['page customer']);
    await act(async () => { reads.held[0]?.(server.customers); });
    await waitFor(() => expect(namesOf(result.current.activeCustomersList)).toEqual(['fresh customer']));
  });

  it.each([
    ['customers', CUSTOMERS_URL, SHOWN.customersFailed, 'activeCustomersList', 'page customer'],
    ['items', ITEMS_URL, SHOWN.itemsFailed, 'activeItemsList', 'page item'],
  ] as const)('a failed %s list says so once and keeps the page\'s list', async (_name, url, message, list, pageName) => {
    reads.fail = url;
    const { result } = formOf(newClient());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(namesOf(result.current[list])).toEqual([pageName]);
  });

  it('an empty list from the server keeps the page\'s list, as before', async () => {
    server.customers = [];
    server.items = [];
    const { result } = formOf(newClient());
    await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['necklace']));
    await waitFor(() => expect(readsOf(CUSTOMERS_URL)).toBe(1));
    expect(readsOf(ITEMS_URL)).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(namesOf(result.current.activeCustomersList)).toEqual(['page customer']);
    expect(namesOf(result.current.activeItemsList)).toEqual(['page item']);
  });

  it('a customer or item change elsewhere refreshes the open form\'s lists', async () => {
    const client = newClient();
    const { result } = formOf(client);
    await waitFor(() => expect(namesOf(result.current.activeItemsList)).toEqual(['fresh item']));
    server.customers = [{ id: 6, name: 'new customer' }];
    server.items = [{ id: 7, name: 'new item' }];
    await act(async () => {
      await client.invalidateQueries({ queryKey: QUERY_KEYS.customers.all });
      await client.invalidateQueries({ queryKey: QUERY_KEYS.items.all });
    });
    await waitFor(() => expect(namesOf(result.current.activeCustomersList)).toEqual(['new customer']));
    expect(namesOf(result.current.activeItemsList)).toEqual(['new item']);
  });
});

describe('the project form\'s stage templates (10.3)', () => {
  it('offers the templates of the settings, read on this opening, without the legacy ones', async () => {
    const client = newClient();
    client.setQueryData(settingsKeys.all, [{ key: 'project_workflow_presets', value: JSON.stringify([preset('stale')]) }], earlier());
    reads.hold = '/settings';
    const { result } = formOf(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(result.current.availablePresets).toEqual([]);
    await act(async () => { reads.held[0]?.(server.settings); });
    await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['necklace']));
  });

  it.each([
    ['a failed settings read', () => { reads.fail = '/settings'; }],
    ['a setting that is not JSON', () => { server.settings = [{ key: 'project_workflow_presets', value: '{broken' }]; }],
    ['no setting', () => { server.settings = []; }],
    ['a setting that is JSON but not a list', () => { server.settings = [{ key: 'project_workflow_presets', value: '{"necklace":1}' }]; }],
  ])('%s offers no template', async (_name, arrange) => {
    arrange();
    const { result } = formOf(newClient());
    await waitFor(() => expect(readsOf('/settings')).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(result.current.availablePresets).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a template list with an entry that is not a template offers the others', async () => {
    server.settings = [{ key: 'project_workflow_presets', value: JSON.stringify([null, preset('necklace'), 3]) }];
    const { result } = formOf(newClient());
    await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['necklace']));
  });

  it('a settings save refreshes the templates of the open form', async () => {
    const client = newClient();
    const { result } = formOf(client);
    await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['necklace']));
    server.settings = [{ key: 'project_workflow_presets', value: JSON.stringify([preset('earring')]) }];
    await act(async () => { await client.invalidateQueries({ queryKey: settingsKeys.all }); });
    await waitFor(() => expect(result.current.availablePresets.map(p => p.id)).toEqual(['earring']));
  });

  it('the project form makes no read of its own', () => {
    expect(ownReads('components/project-modal/useProjectForm.ts')).toEqual([]);
  });
});
