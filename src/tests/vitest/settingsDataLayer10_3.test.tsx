import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FormEvent, ReactNode } from 'react';
import { ownReads } from './helpers/ownReads';

/**
 * 10.3 (ARCH review finding 3, part 13): the settings screens read through the shared cache. Each opening reads again and
 * never shows what an earlier opening left; a form follows a newer read until the user edits it and is filled again
 * after its own save; a write refreshes every screen that shows what it changed.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  employeeInsurance: 'درصد بیمه سهم کارگر',
  saveRates: /^ذخیره نرخ‌های سال/,
  saveEidi: /ذخیره روش عیدی سال/,
  eidiPercent: 'درصد عیدی از کارکرد و حقوق ثابت هر فیش',
  year: 'سال جلالی',
  deleteTask: 'حذف',
  saveMappings: 'ذخیره تنظیمات',
  customizationOn: 'سفارشی‌سازی روشن',
  customizationOff: 'سفارشی‌سازی خاموش — استفاده از کدینگ پیش‌فرض',
  envFailed: 'وضعیت محیط از سرور دریافت نشد؛ زبانه را دوباره باز کنید.',
  productionMode: /حالت اجرا: تولید/,
  flagSet: 'تنظیم‌شده',
  flagNotSet: 'تنظیم‌نشده',
  constraintsChecking: 'در حال بررسی...',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type Rates = { jalaliYear: number; employeeInsurancePercent: string; employerInsurancePercent: string; insuranceWageCap: string; taxBrackets: Array<{ from: string; to: string | null; rate: string }>; deductInsuranceFromTax: boolean; version: number };
const ratesRow = (jalaliYear: number, employee: string, version = 1): Rates => ({
  jalaliYear, employeeInsurancePercent: employee, employerInsurancePercent: '23', insuranceWageCap: '0',
  taxBrackets: [{ from: '0', to: null, rate: '10' }], deductInsuranceFromTax: false, version,
});
const server = {
  rates: [] as Rates[],
  eidi: [] as unknown[],
  tasks: [{ id: 1, code: 'T1', title: 'cutting', category: 'wood', defaultRate: 10, unit: 'piece' }],
  mappings: { raw_materials: '1401', disabled: [] as string[], accountsCount: 3 } as Record<string, unknown>,
  env: { db: 'set', nodeEnv: 'production', nodeVersion: 'v24', flags: { JWT_SECRET: 'set' } } as unknown,
  failEnv: false,
};
const resetServer = () => {
  server.rates = [];
  server.eidi = [];
  server.tasks = [{ id: 1, code: 'T1', title: 'cutting', category: 'wood', defaultRate: 10, unit: 'piece' }];
  server.mappings = { raw_materials: '1401', disabled: [], accountsCount: 3 };
  server.env = { db: 'set', nodeEnv: 'production', nodeVersion: 'v24', flags: { JWT_SECRET: 'set' } };
  server.failEnv = false;
};
let holdNext: string | null = null;
const held: Array<(answer: unknown) => void> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (holdNext && url === holdNext && !opts?.method) {
    holdNext = null;
    return new Promise(resolve => { held.push(resolve); });
  }
  if (opts?.method) return { success: true };
  if (url === '/piecework/statutory-rates') return { data: server.rates };
  if (url === '/piecework/eidi-rates') return { data: server.eidi };
  if (url.startsWith('/piecework/tasks')) return server.tasks;
  if (url === '/piecework/categories') return [{ id: 1, name: 'wood' }];
  if (url === '/accounting/mappings') return server.mappings;
  if (url === '/system/env') {
    if (server.failEnv) throw new Error('env failed');
    return server.env;
  }
  if (url === '/system/conditional-constraints') return { missing: [] };
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
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { useSeededForm } from '../../hooks/useSeededForm';
import { PayrollStatutoryRatesTab } from '../../components/settings/PayrollStatutoryRatesTab';
import { PayrollEidiRatesSection } from '../../components/settings/PayrollEidiRatesSection';
import { TaskTitlesSettingsTab } from '../../components/settings/TaskTitlesSettingsTab';
import { AccountingSettingsTab } from '../../components/settings/AccountingSettingsTab';
import { SystemConfigTab } from '../../components/settings/SystemConfigTab';
import { ConditionalConstraintsCard } from '../../components/settings/ConditionalConstraintsCard';
import { CONDITIONAL_CONSTRAINTS_KEY, SYSTEM_ENV_KEY } from '../../hooks/queries/useSystemQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { useSettings } from '../../hooks/useSettings';
import { WC_CATALOG_KEY, WC_ORDERS_KEY } from '../../hooks/queries/useWooCatalogQueries';
import { getTodayJalaliDate } from '../../utils';
import { toLatinDigits } from '../../lib/numericInput';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  resetServer();
  holdNext = null;
  held.length = 0;
});

const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const invalidate = (client: QueryClient, queryKey: readonly unknown[]) => act(async () => { await client.invalidateQueries({ queryKey }); });
const keysOf = (spy: { mock: { calls: Array<[{ queryKey?: unknown }?, ...unknown[]]> } }) => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
const earlier = { updatedAt: Date.now() - 60_000 };
const putsTo = (prefix: string) => fetchJson.mock.calls.filter(([u, o]) => u.startsWith(prefix) && o?.method === 'PUT');
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('a settings form filled from a shared read (10.3)', () => {
  const fill = (source: { value: string } | undefined) => source?.value ?? '';

  it('follows each newer read until edited, keeps the edit on a newer read, and refill fills it from the read as it is now', () => {
    const { result, rerender } = renderHook(({ source }: { source?: { value: string } }) => useSeededForm(source, fill), { initialProps: {} });
    expect(result.current.form).toBe('');
    rerender({ source: { value: 'a' } });
    expect(result.current.form).toBe('a');
    rerender({ source: { value: 'b' } });
    expect(result.current.form).toBe('b');

    act(() => { result.current.edit('typed'); });
    expect(result.current.edited).toBe(true);
    const newer = { value: 'c' };
    rerender({ source: newer });
    expect(result.current.form).toBe('typed');

    act(() => { result.current.refill(); });
    expect(result.current.form).toBe('c');
    expect(result.current.edited).toBe(false);
    rerender({ source: { value: 'd' } });
    expect(result.current.form).toBe('d');
  });

  it('an edit made from the form as it is (a function) builds on it', () => {
    const { result } = renderHook(() => useSeededForm({ value: 'a' }, fill));
    act(() => { result.current.edit(prev => `${prev}b`); });
    act(() => { result.current.edit(prev => `${prev}c`); });
    expect(result.current.form).toBe('abc');
  });
});

describe('the payroll rates read through the shared cache (10.3)', () => {
  it('never shows the rates an earlier opening left while it reads them again', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.piecework.statutoryRates(), [ratesRow(thisYear, '9')], earlier);
    server.rates = [ratesRow(thisYear, '7')];
    holdNext = '/piecework/statutory-rates';
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(field(SHOWN.employeeInsurance).value).toBe('');
    await act(async () => { held[0]?.({ data: server.rates }); });
    await waitFor(() => expect(field(SHOWN.employeeInsurance).value).toBe('7'));
  });

  it('follows a save made elsewhere until the user edits, then keeps what the user typed', async () => {
    const client = newClient();
    server.rates = [ratesRow(thisYear, '7')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(field(SHOWN.employeeInsurance).value).toBe('7'));
    server.rates = [ratesRow(thisYear, '8', 2)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    await waitFor(() => expect(field(SHOWN.employeeInsurance).value).toBe('8'));

    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    server.rates = [ratesRow(thisYear, '5', 3)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    expect(field(SHOWN.employeeInsurance).value).toBe('6');
  });

  it('a save refreshes every payroll read and fills the form from the saved row, its new version included', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    server.rates = [ratesRow(thisYear, '7')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(field(SHOWN.employeeInsurance).value).toBe('7'));
    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    server.rates = [ratesRow(thisYear, '6.5', 2)];
    fireEvent.click(screen.getByText(SHOWN.saveRates));
    await waitFor(() => expect(field(SHOWN.employeeInsurance).value).toBe('6.5'));
    expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.piecework.all));
    expect(JSON.parse(String(putsTo('/piecework/statutory-rates/')[0]?.[1]?.body)).version).toBe(1);

    fireEvent.click(screen.getByText(SHOWN.saveRates));
    await waitFor(() => expect(putsTo('/piecework/statutory-rates/')).toHaveLength(2));
    expect(JSON.parse(String(putsTo('/piecework/statutory-rates/')[1]?.[1]?.body)).version).toBe(2);
  });

  it('picking another year fills the form from that year, an edit of the first year set aside', async () => {
    server.rates = [ratesRow(thisYear, '7'), ratesRow(thisYear - 1, '4')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(field(SHOWN.employeeInsurance).value).toBe('7'));
    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    fireEvent.change(screen.getAllByLabelText(SHOWN.year)[0] as HTMLSelectElement, { target: { value: String(thisYear - 1) } });
    expect(field(SHOWN.employeeInsurance).value).toBe('4');
  });

  it('the eidi section follows a newer read and its save refreshes every payroll read', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const eidi = (percent: string, version = 1) => ({ jalaliYear: thisYear, method: 'percent_of_work', percent, yearlyCap: '5000000', laborDays: '0', laborCapDays: '0', minDailyWage: '0', fixedAmount: '0', version });
    server.eidi = [eidi('15')];
    render(<PayrollEidiRatesSection />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(field(SHOWN.eidiPercent).value).toBe('15'));
    server.eidi = [eidi('12', 2)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    await waitFor(() => expect(field(SHOWN.eidiPercent).value).toBe('12'));
    invalidated.mockClear();
    fireEvent.click(screen.getByRole('button', { name: SHOWN.saveEidi }));
    await waitFor(() => expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.piecework.all)));
  });
});

describe('the piecework titles tab reads through the payroll cache (10.3)', () => {
  it('shows a title change made elsewhere, and a removal here refreshes every payroll read', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    render(<TaskTitlesSettingsTab />, { wrapper: wrapperOf(client) });
    expect(await screen.findByText('cutting')).toBeTruthy();
    server.tasks = [{ id: 1, code: 'T1', title: 'sanding', category: 'wood', defaultRate: 10, unit: 'piece' }];
    await invalidate(client, QUERY_KEYS.piecework.all);
    expect(await screen.findByText('sanding')).toBeTruthy();

    invalidated.mockClear();
    fireEvent.click(screen.getByTitle(SHOWN.deleteTask));
    await waitFor(() => expect(fetchJson.mock.calls.some(([u, o]) => u === '/piecework/tasks/1' && o?.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.piecework.all)));
  });
});

describe('the accounting settings tab reads through the shared cache (10.3)', () => {
  it('keeps the user\'s change on a newer read and is filled again after its save', async () => {
    const client = newClient();
    render(<AccountingSettingsTab currentUser={{ role: 'admin' }} />, { wrapper: wrapperOf(client) });
    const firstSwitch = async () => (await screen.findAllByTitle(new RegExp(`${SHOWN.customizationOn}|${SHOWN.customizationOff}`)))[0] as HTMLElement;
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOn);
    fireEvent.click(await firstSwitch());
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOff);

    await invalidate(client, QUERY_KEYS.accounting.all);
    expect((await firstSwitch()).title).toBe(SHOWN.customizationOff);

    // the form is filled again from the mappings as the server holds them after the save (here it refused the switch)
    fireEvent.click(screen.getByText(SHOWN.saveMappings));
    await waitFor(() => expect(fetchJson.mock.calls.some(([u, o]) => u === '/accounting/mappings' && o?.method === 'POST')).toBe(true));
    const sent = JSON.parse(String(fetchJson.mock.calls.find(([u, o]) => u === '/accounting/mappings' && o?.method === 'POST')?.[1]?.body)) as { disabled: string[] };
    expect(sent.disabled).toHaveLength(1);
    await waitFor(async () => expect((await firstSwitch()).title).toBe(SHOWN.customizationOn));
  });
});

describe('the system tab reads through the shared cache (10.3)', () => {
  it('never shows the state an earlier opening left while it reads again', async () => {
    const client = newClient();
    client.setQueryData(SYSTEM_ENV_KEY, { db: 'set', nodeEnv: 'production', nodeVersion: 'v-cached', flags: {} }, earlier);
    holdNext = '/system/env';
    render(<SystemConfigTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(screen.queryByText('v-cached')).toBeNull();
    await act(async () => { held[0]?.(server.env); });
    expect(await screen.findByText('v24')).toBeTruthy();
    expect(screen.getByText(SHOWN.productionMode)).toBeTruthy();
  });

  it('a failed read says so instead of showing a mode and flag states it never read', async () => {
    server.failEnv = true;
    render(<SystemConfigTab />, { wrapper: wrapperOf(newClient()) });
    expect((await screen.findByRole('alert')).textContent).toBe(SHOWN.envFailed);
    expect(screen.queryByText(SHOWN.productionMode)).toBeNull();
    expect(screen.queryByText(SHOWN.flagSet)).toBeNull();
    expect(screen.queryByText(SHOWN.flagNotSet)).toBeNull();
  });

  it('the missing constraints card never shows the list an earlier opening left', async () => {
    const client = newClient();
    client.setQueryData(CONDITIONAL_CONSTRAINTS_KEY, { missing: [{ name: 'fk_cached', label: 'cached constraint', state: 'blocked' }] }, earlier);
    holdNext = '/system/conditional-constraints';
    render(<ConditionalConstraintsCard />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(screen.queryByText('cached constraint')).toBeNull();
    expect(screen.getByText(SHOWN.constraintsChecking)).toBeTruthy();
  });
});

describe('the shop writes of the settings page refresh what they change (10.3)', () => {
  it('an order fetched by hand refreshes the order lists and every screen a sales invoice changes', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSettings(), { wrapper: wrapperOf(client) });
    act(() => { result.current.setManualOrderId('77'); });
    await act(async () => { await result.current.handleSyncManualOrder({ preventDefault: () => undefined } as FormEvent); });
    await waitFor(() => expect(keysOf(invalidated)).toEqual(expect.arrayContaining(
      [WC_ORDERS_KEY, QUERY_KEYS.documents.all, QUERY_KEYS.items.all, QUERY_KEYS.inventory.all, QUERY_KEYS.accounting.all].map(k => JSON.stringify(k)),
    )));
  });

  it('a stock push refreshes the catalog panel (last push, failing links)', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSettings(), { wrapper: wrapperOf(client) });
    await act(async () => { await result.current.handleSyncAllStocks(); });
    expect(keysOf(invalidated)).toContain(JSON.stringify(WC_CATALOG_KEY));
  });
});

describe('the settings screens make no read of their own (10.3)', () => {
  it.each([
    'components/settings/PayrollStatutoryRatesTab.tsx',
    'components/settings/PayrollEidiRatesSection.tsx',
    'components/settings/TaskTitlesSettingsTab.tsx',
    'components/settings/WorkflowPresetsTab.tsx',
    'components/settings/AccountingSettingsTab.tsx',
    'components/settings/SystemConfigTab.tsx',
    'components/settings/ConditionalConstraintsCard.tsx',
    'components/settings/WooCommerceTab.tsx',
    'components/settings/AutoActionsSubTab.tsx',
    'hooks/useSettings.ts',
    'pages/SettingsPage.tsx',
  ])('%s reads only through the shared cache', (file) => {
    expect(ownReads(file)).toEqual([]);
  });
});
