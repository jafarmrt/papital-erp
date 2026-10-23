import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import {
  earlier, fetchJson, invalidate, keysOf, newClient, reads, resetServer, sentBody, server, settle, wrapperOf, writesTo, type FetchOpts,
} from './helpers/settingsServer';

/**
 * 10.3 (ARCH review finding 3, part 13): the piecework titles tab, the workflow presets tab and the accounting settings
 * tab read through the shared cache: never what an earlier opening left, a failure said once and at once, every write
 * refreshing what it changed, and the accounting form saved only once read and kept as saved when the refresh fails.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  loadingTitles: 'در حال بارگذاری اطلاعات...',
  newTitle: 'افزودن عنوان کاری جدید',
  titlePlaceholder: 'مثلا: ساخت کاشی 20*20',
  saveTitle: 'ثبت عنوان کاری',
  editTitle: 'ویرایش',
  deleteTitle: 'حذف',
  newCategory: 'افزودن دسته‌بندی جدید',
  categoryPlaceholder: 'مثلا: بسته‌بندی، روتوش، کاشی...',
  saveCategory: 'ثبت دسته‌بندی',
  deleteCategory: 'حذف دسته‌بندی',
  category: (name: string) => `دسته‌بندی: ${name}`,
  saveMappings: 'ذخیره تنظیمات',
  loadingMappings: 'در حال بارگذاری...',
  customizationOn: 'سفارشی‌سازی روشن',
  customizationOff: 'سفارشی‌سازی خاموش — استفاده از کدینگ پیش‌فرض',
  seed: 'همگام‌سازی کدینگ پیش‌فرض',
  chartActive: /درخت حساب‌ها فعال است/,
} as const;

vi.mock('../../api', async () => {
  const { fetchJson: answer } = await import('./helpers/settingsServer');
  return { API_URL: '/api', fetchJson: (url: string, opts?: FetchOpts) => answer(url, opts), isAbortError: () => false };
});
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { toast } from 'react-hot-toast';
import { TaskTitlesSettingsTab } from '../../components/settings/TaskTitlesSettingsTab';
import { WorkflowPresetsTab } from '../../components/settings/WorkflowPresetsTab';
import { AccountingSettingsTab } from '../../components/settings/AccountingSettingsTab';
import { ACCOUNTING_MAPPINGS_KEY } from '../../hooks/accounting/useAccountsQueries';
import { ACCOUNT_MAPPING_CONCEPTS } from '../../lib/accounting/accountMappingConcepts';
import { newWorkflowPreset } from '../../lib/settings/workflowPresetDraft';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  vi.mocked(toast.error).mockClear();
  resetServer();
});

const TASKS = '/piecework/tasks?status=active';
const MAPPINGS = '/accounting/mappings';
const pieceworkAll = JSON.stringify(QUERY_KEYS.piecework.all);
const said = (times: number) => waitFor(() => expect(toast.error).toHaveBeenCalledTimes(times));
const firstSwitch = async () => (await screen.findAllByTitle(new RegExp(`${SHOWN.customizationOn}|${SHOWN.customizationOff}`)))[0] as HTMLElement;
const firstConcept = ACCOUNT_MAPPING_CONCEPTS[0]?.key as string;
const renderAccounting = (client: QueryClient) => render(<AccountingSettingsTab currentUser={{ role: 'admin' }} />, { wrapper: wrapperOf(client) });

describe('the piecework titles tab reads through the payroll cache (10.3)', () => {
  it('never shows the titles an earlier opening left while it reads them again', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.piecework.tasks('active'), [{ id: 1, code: 'T1', title: 'stale title', category: 'wood', defaultRate: 10, unit: 'piece' }], earlier());
    reads.holdNext = TASKS;
    render(<TaskTitlesSettingsTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale title')).toBeNull();
    expect(screen.getByText(SHOWN.loadingTitles)).toBeTruthy();
    await act(async () => { reads.held[0]?.(server.tasks); });
    expect(await screen.findByText('cutting')).toBeTruthy();
  });

  it('waits for the categories too before it shows the titles', async () => {
    reads.holdNext = '/piecework/categories';
    render(<TaskTitlesSettingsTab />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    await settle();
    expect(screen.getByText(SHOWN.loadingTitles)).toBeTruthy();
    expect(screen.queryByText('cutting')).toBeNull();
    await act(async () => { reads.held[0]?.(server.categories); });
    expect(await screen.findByText('cutting')).toBeTruthy();
  });

  it('says a failed read at once, without retrying first, and once', async () => {
    reads.failNext = TASKS;
    render(<TaskTitlesSettingsTab />, { wrapper: wrapperOf(new QueryClient()) });
    await said(1);
    await settle();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('shows a title change made elsewhere, and a removal here refreshes every payroll read', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    render(<TaskTitlesSettingsTab />, { wrapper: wrapperOf(client) });
    expect(await screen.findByText('cutting')).toBeTruthy();
    server.tasks = [{ id: 1, code: 'T1', title: 'sanding', category: 'wood', defaultRate: 10, unit: 'piece' }];
    await invalidate(client, QUERY_KEYS.piecework.all);
    expect(await screen.findByText('sanding')).toBeTruthy();

    invalidated.mockClear();
    fireEvent.click(screen.getByTitle(SHOWN.deleteTitle));
    await waitFor(() => expect(writesTo('/piecework/tasks/1', 'DELETE')).toHaveLength(1));
    await waitFor(() => expect(keysOf(invalidated)).toContain(pieceworkAll));
  });

  it('a new title, an edited title, a saved category and a removed category each refresh every payroll read', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    render(<TaskTitlesSettingsTab />, { wrapper: wrapperOf(client) });
    expect(await screen.findByText('cutting')).toBeTruthy();
    const refreshedAfter = async (url: string, method: string, act: () => void) => {
      invalidated.mockClear();
      act();
      await waitFor(() => expect(writesTo(url, method)).toHaveLength(1));
      await waitFor(() => expect(keysOf(invalidated)).toContain(pieceworkAll));
    };

    await refreshedAfter('/piecework/tasks', 'POST', () => {
      fireEvent.click(screen.getByText(SHOWN.newTitle));
      fireEvent.change(screen.getByPlaceholderText(SHOWN.titlePlaceholder), { target: { value: 'gluing' } });
      fireEvent.click(screen.getByText(SHOWN.saveTitle));
    });
    await refreshedAfter('/piecework/tasks/1', 'PUT', () => {
      fireEvent.click(screen.getByTitle(SHOWN.editTitle));
      fireEvent.click(screen.getByText(SHOWN.saveTitle));
    });
    await refreshedAfter('/piecework/categories', 'POST', () => {
      fireEvent.click(screen.getByText(SHOWN.newCategory));
      fireEvent.change(screen.getByPlaceholderText(SHOWN.categoryPlaceholder), { target: { value: 'paint' } });
      fireEvent.click(screen.getByText(SHOWN.saveCategory));
    });
    await refreshedAfter('/piecework/categories/1', 'DELETE', () => fireEvent.click(screen.getByTitle(SHOWN.deleteCategory)));
  });
});

describe('the workflow presets tab reads the titles through the payroll cache (10.3)', () => {
  const preset = {
    ...newWorkflowPreset('p1', 1),
    stages: [{ title: 'stage', isOptionalPerProduct: false, defaultTasks: [{ taskId: 1, taskTitle: 'cutting', unit: 'piece', defaultRate: 10 }] }],
  };
  const renderPresets = (client: QueryClient) => render(
    <WorkflowPresetsTab workflowPresets={[preset]} setWorkflowPresets={() => undefined} isSaving={false} onSave={() => undefined} />,
    { wrapper: wrapperOf(client) },
  );

  it('never shows the titles an earlier opening left while it reads them again', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.piecework.tasks('active'), [{ id: 1, code: 'T1', title: 'cutting', category: 'stale', defaultRate: 10, unit: 'piece' }], earlier());
    reads.holdNext = TASKS;
    renderPresets(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText(SHOWN.category('stale'))).toBeNull();
    await act(async () => { reads.held[0]?.(server.tasks); });
    expect(await screen.findByText(SHOWN.category('wood'))).toBeTruthy();
  });

  it('says a failed read at once and once', async () => {
    reads.failNext = TASKS;
    renderPresets(new QueryClient());
    await said(1);
    await settle();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('the accounting settings tab reads through the shared cache (10.3)', () => {
  it('never fills the form from the mappings an earlier opening left, and saves nothing until its read answers', async () => {
    const client = newClient();
    client.setQueryData(ACCOUNTING_MAPPINGS_KEY, { mappings: {}, disabled: [firstConcept], accountsCount: 3 }, earlier());
    reads.holdNext = MAPPINGS;
    renderAccounting(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.getByText(SHOWN.loadingMappings)).toBeTruthy();
    expect(screen.queryAllByTitle(SHOWN.customizationOff)).toHaveLength(0);
    expect(screen.getByText(SHOWN.saveMappings).closest('button')?.disabled).toBe(true);
    await act(async () => { reads.held[0]?.(server.mappings); });
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOn);
  });

  it('keeps the user\'s change on a newer read, saves it, and follows newer reads again after the save', async () => {
    const client = newClient();
    renderAccounting(client);
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOn);
    fireEvent.click(await firstSwitch());
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOff);
    await invalidate(client, QUERY_KEYS.accounting.all);
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOff);

    fireEvent.click(screen.getByText(SHOWN.saveMappings));
    await waitFor(() => expect(writesTo(MAPPINGS, 'POST')).toHaveLength(1));
    expect(sentBody(MAPPINGS, 'POST', 0).disabled).toEqual([firstConcept]);
    await settle();
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOff);
    // someone else turns it back on: the form, no longer edited, shows it
    server.mappings = { ...server.mappings, disabled: [] };
    await invalidate(client, QUERY_KEYS.accounting.all);
    await waitFor(async () => expect((await firstSwitch()).title).toBe(SHOWN.customizationOn));
  });

  it('a save whose refresh fails keeps the saved mappings, and the next save sends them', async () => {
    renderAccounting(newClient());
    fireEvent.click(await firstSwitch());
    reads.failNext = MAPPINGS;
    fireEvent.click(screen.getByText(SHOWN.saveMappings));
    await waitFor(() => expect(reads.failNext).toBeNull());
    await settle();
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOff);
    fireEvent.click(screen.getByText(SHOWN.saveMappings));
    await waitFor(() => expect(writesTo(MAPPINGS, 'POST')).toHaveLength(2));
    expect(sentBody(MAPPINGS, 'POST', 1).disabled).toEqual([firstConcept]);
  });

  it('a failed first read is said once and its empty form cannot be saved', async () => {
    reads.failNext = MAPPINGS;
    renderAccounting(newClient());
    await said(1);
    expect(screen.getByText(SHOWN.saveMappings).closest('button')?.disabled).toBe(true);
    await settle();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('a seeded chart shows at once: the tab reads its mappings and the chart again', async () => {
    server.mappings = { ...server.mappings, accountsCount: 0 };
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderAccounting(client);
    fireEvent.click(await screen.findByText(SHOWN.seed));
    await waitFor(() => expect(writesTo('/accounting/accounts/seed-default', 'POST')).toHaveLength(1));
    expect(await screen.findByText(SHOWN.chartActive)).toBeTruthy();
    expect(keysOf(invalidated)).toEqual(expect.arrayContaining([ACCOUNTING_MAPPINGS_KEY, QUERY_KEYS.accounting.accounts()].map(k => JSON.stringify(k))));
  });
});
