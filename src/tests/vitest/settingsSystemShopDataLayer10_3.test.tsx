import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, FormEvent } from 'react';
import {
  earlier, fetchJson, keysOf, newClient, reads, resetServer, server, wrapperOf, type FetchOpts,
} from './helpers/settingsServer';

/**
 * 10.3 (ARCH review finding 3, part 13): the system tab, the missing constraints card and the WooCommerce tab read
 * through the shared cache, never what an earlier opening left; the shop writes of the settings page refresh what they
 * change.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  envLoading: 'در حال دریافت وضعیت محیط...',
  envFailed: 'وضعیت محیط از سرور دریافت نشد؛ زبانه را دوباره باز کنید.',
  productionMode: /حالت اجرا: تولید/,
  flagSet: 'تنظیم‌شده',
  flagNotSet: 'تنظیم‌نشده',
  constraintsChecking: 'در حال بررسی...',
  constraintsFailed: 'بررسی قیدها انجام نشد؛ دوباره تلاش کنید.',
  constraintsAllThere: 'همه قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها برقرارند.',
  buildConstraints: 'ساختن قیدهای جاافتاده',
  refreshOrders: 'به‌روزرسانی جدول',
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
vi.mock('../../components/settings/WcCatalogPanel', () => ({ WcCatalogPanel: () => null }));

import { SystemConfigTab } from '../../components/settings/SystemConfigTab';
import { ConditionalConstraintsCard } from '../../components/settings/ConditionalConstraintsCard';
import { WooCommerceTab } from '../../components/settings/WooCommerceTab';
import { CONDITIONAL_CONSTRAINTS_KEY, SYSTEM_ENV_KEY } from '../../hooks/queries/useSystemQueries';
import { WC_CATALOG_KEY, WC_ORDERS_KEY } from '../../hooks/queries/useWooCatalogQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { useSettings } from '../../hooks/useSettings';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  resetServer();
});

const readyConstraint = { name: 'fk_ready', kind: 'foreign_key', table: 't', migration: '0001', label: 'ready constraint', state: 'ready', blockers: 0 };
const ORDER_LOGS = '/woocommerce/order-logs';
const orderLog = (id: number, wcOrderId: number) => ({ id, wcOrderId, status: 'completed', buyerName: 'buyer' });
const noop = () => undefined;
const shopProps = {
  wcStoreUrl: '', setWcStoreUrl: noop, wcConsumerKey: '', setWcConsumerKey: noop, wcConsumerSecret: '', setWcConsumerSecret: noop,
  wcWebhookSecret: '', setWcWebhookSecret: noop, wcShopWarehouse: '', setWcShopWarehouse: noop, warehouses: [],
  handleSaveSettings: noop, isSaving: false, handleTestWcConnection: noop, isTestingWc: false, manualOrderId: '', setManualOrderId: noop,
  isSyncingManualOrder: false, handleSyncManualOrder: noop, handleSyncAllStocks: noop, isSyncingAllStocks: false,
} as ComponentProps<typeof WooCommerceTab>;

describe('the system tab reads through the shared cache (10.3)', () => {
  it('never shows the state an earlier opening left while it reads again', async () => {
    const client = newClient();
    client.setQueryData(SYSTEM_ENV_KEY, { db: 'set', nodeEnv: 'production', nodeVersion: 'v-cached', flags: {} }, earlier());
    reads.holdNext = '/system/env';
    render(<SystemConfigTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('v-cached')).toBeNull();
    expect(screen.getByText(SHOWN.envLoading)).toBeTruthy();
    await act(async () => { reads.held[0]?.(server.env); });
    expect(await screen.findByText('v24')).toBeTruthy();
    expect(screen.getByText(SHOWN.productionMode)).toBeTruthy();
  });

  it('a failed read says so instead of showing a mode and flag states it never read', async () => {
    reads.failNext = '/system/env';
    render(<SystemConfigTab />, { wrapper: wrapperOf(newClient()) });
    expect((await screen.findByRole('alert')).textContent).toBe(SHOWN.envFailed);
    expect(screen.queryByText(SHOWN.productionMode)).toBeNull();
    expect(screen.queryByText(SHOWN.flagSet)).toBeNull();
    expect(screen.queryByText(SHOWN.flagNotSet)).toBeNull();
  });
});

describe('the missing constraints card reads through the shared cache (10.3)', () => {
  it('never shows the list an earlier opening left', async () => {
    const client = newClient();
    client.setQueryData(CONDITIONAL_CONSTRAINTS_KEY, { missing: [{ ...readyConstraint, label: 'cached constraint', state: 'blocked' }] }, earlier());
    reads.holdNext = '/system/conditional-constraints';
    render(<ConditionalConstraintsCard />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('cached constraint')).toBeNull();
    expect(screen.getByText(SHOWN.constraintsChecking)).toBeTruthy();
  });

  it('a failed read says so instead of «all constraints are there»', async () => {
    reads.failNext = '/system/conditional-constraints';
    render(<ConditionalConstraintsCard />, { wrapper: wrapperOf(newClient()) });
    expect((await screen.findByRole('alert')).textContent).toBe(SHOWN.constraintsFailed);
    expect(screen.queryByText(SHOWN.constraintsAllThere)).toBeNull();
  });

  it('building the constraints reads the list again', async () => {
    server.constraints = [readyConstraint];
    render(<ConditionalConstraintsCard />, { wrapper: wrapperOf(newClient()) });
    expect(await screen.findByText('ready constraint')).toBeTruthy();
    fireEvent.click(screen.getByText(SHOWN.buildConstraints));
    expect(await screen.findByText(SHOWN.constraintsAllThere)).toBeTruthy();
  });
});

describe('the WooCommerce tab reads its order lists through the shared cache (10.3)', () => {
  it('never shows the order log an earlier opening left while it reads again', async () => {
    const client = newClient();
    client.setQueryData([...WC_ORDERS_KEY, 'logs'], [orderLog(1, 501)], earlier());
    reads.holdNext = ORDER_LOGS;
    render(<WooCommerceTab {...shopProps} />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('#۵۰۱')).toBeNull();
    await act(async () => { reads.held[0]?.([orderLog(2, 502)]); });
    expect(await screen.findByText('#۵۰۲')).toBeTruthy();
  });

  it('its refresh button reads the order lists again', async () => {
    const client = newClient();
    render(<WooCommerceTab {...shopProps} />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => u === ORDER_LOGS)).toBe(true));
    server.orderLogs = [orderLog(3, 503)];
    fireEvent.click(screen.getByText(SHOWN.refreshOrders));
    expect(await screen.findByText('#۵۰۳')).toBeTruthy();
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
