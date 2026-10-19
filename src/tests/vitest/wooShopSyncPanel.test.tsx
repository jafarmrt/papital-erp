/**
 * 10.2 package 6 (D-04 part C): the price push, SKU rename and nightly re-read of the WooCommerce tab (`WcShopSyncPanel`)
 * and their shared rules (`src/lib/woocommerce/wcShopSync.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { fetchJson } from '../../api';
import { confirmAction } from '../../components/ConfirmDialogHost';
import { WcShopSyncPanel } from '../../components/settings/WcShopSyncPanel';
import {
  businessDayHour, nightlyDue, PRICE_PUSH_ENABLE_CONFIRM, sameSitePrice, siteCurrencyLabel, sitePriceOf, SKU_RENAME_ENABLE_CONFIRM,
  WC_NIGHTLY_MAX_ATTEMPTS, WC_NIGHTLY_RETRY_MINUTES, type WcShopSyncView,
} from '../../lib/woocommerce/wcShopSync';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(confirmAction).mockReset(); });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const PRICE_LIST = 'فروشگاه';
const DOLLAR_ITEM = 'گردنبند دلاری';
const DRIFT_ITEM = 'گوشواره ناهمخوان';
const field = { enabled: false, lastRun: null, failedRuns: 0, nextAttemptAt: null, stopped: [], stoppedTotal: 0 };
const view: WcShopSyncView = {
  priceList: '',
  priceListMissing: false,
  priceLists: [PRICE_LIST, 'عمده'],
  siteCurrency: 'IRT',
  price: { ...field, skipped: [{ itemId: 4, code: 'PR-4', name: DOLLAR_ITEM, reason: 'currency_mismatch' }], skippedTotal: 1 },
  sku: { ...field, pending: 2 },
  lastNightly: { at: '2026-10-18T00:30:00.000Z', status: 'ok', error: '', summary: {} },
  differences: [{ itemId: 7, code: 'PR-7', name: DRIFT_ITEM, kind: 'stock', site: '9', program: '5' }],
  differencesTotal: 1,
};

describe('D-04 part C: the shop price and the nightly rules', () => {
  it('sends a rial price in the shop unit and refuses another currency or a price that rounds to nothing', () => {
    expect(sitePriceOf('1250000', 'IRR', 'IRT')).toEqual({ value: '125000' });
    expect(sitePriceOf('1234567', 'IRR', 'IRT')).toEqual({ value: '123457' });
    expect(sitePriceOf('1250000', 'IRR', 'IRR')).toEqual({ value: '1250000' });
    expect(sitePriceOf('25000000', null, 'IRHT')).toEqual({ value: '2500' });
    expect(sitePriceOf('10', 'USD', 'IRT')).toEqual({ skip: 'currency_mismatch' });
    expect(sitePriceOf('12.345', 'usd', 'USD')).toEqual({ value: '12.35' });
    expect(sitePriceOf('1250000', 'IRR', 'USD')).toEqual({ skip: 'currency_mismatch' });
    expect(sitePriceOf('4', 'IRR', 'IRT')).toEqual({ skip: 'not_positive' });
    expect(sitePriceOf('', 'IRR', 'IRT')).toEqual({ skip: 'no_price' });
    expect(sitePriceOf('abc', 'IRR', 'IRT')).toEqual({ skip: 'no_price' });
  });

  it('compares the shop price as a number, and an empty shop price differs', () => {
    expect(sameSitePrice('125000.00', '125000')).toBe(true);
    expect(sameSitePrice('', '125000')).toBe(false);
    expect(sameSitePrice(null, '125000')).toBe(false);
  });

  it('runs the nightly reading from its hour, once a day, a failed one at most three times 30 minutes apart', () => {
    const none = { succeeded: false, failed: 0, lastFailedAt: null };
    const now = Date.UTC(2026, 9, 18, 4, 0);
    expect(nightlyDue(2, none, now)).toBe(false);
    expect(nightlyDue(3, none, now)).toBe(true);
    expect(nightlyDue(4, { ...none, succeeded: true }, now)).toBe(false);
    expect(nightlyDue(4, { succeeded: false, failed: 1, lastFailedAt: now - 10 * 60_000 }, now)).toBe(false);
    expect(nightlyDue(4, { succeeded: false, failed: 1, lastFailedAt: now - WC_NIGHTLY_RETRY_MINUTES * 60_000 }, now)).toBe(true);
    expect(nightlyDue(4, { succeeded: false, failed: WC_NIGHTLY_MAX_ATTEMPTS, lastFailedAt: 0 }, now)).toBe(false);
  });

  it('takes the business day and hour in the display time zone', () => {
    expect(businessDayHour(new Date('2026-10-17T23:45:00Z'), 'Asia/Tehran')).toEqual({ day: '2026-10-18', hour: 3 });
    expect(businessDayHour(new Date('2026-10-17T23:45:00Z'), 'UTC')).toEqual({ day: '2026-10-17', hour: 23 });
  });

  it('names the shop currency in Persian', () => {
    expect(siteCurrencyLabel('IRT')).toBe('تومان');
    expect(siteCurrencyLabel('irr')).toBe('ریال');
    expect(siteCurrencyLabel('IRHT')).toBe('هزار تومان');
  });
});

describe('D-04 part C: the price, SKU and nightly panel', () => {
  it('a reader sees the state, the products left out and the differences, and changes nothing', () => {
    render(<WcShopSyncPanel view={view} canManage={false} />, { wrapper });
    expect((screen.getByLabelText(/ارسال خودکار قیمت از فهرست/) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'روشن کردن' })).toBeNull();
    expect(screen.getByText(DOLLAR_ITEM)).toBeTruthy();
    expect(screen.getByText(DRIFT_ITEM)).toBeTruthy();
    expect(screen.getByText(/واحد پول سایت: تومان/)).toBeTruthy();
  });

  it('choosing a price list asks first and sends the title; a declined question sends nothing', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ success: true, priceList: PRICE_LIST });
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    render(<WcShopSyncPanel view={view} canManage />, { wrapper });
    const select = screen.getByLabelText(/ارسال خودکار قیمت از فهرست/);
    fireEvent.change(select, { target: { value: PRICE_LIST } });
    await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: PRICE_PUSH_ENABLE_CONFIRM(PRICE_LIST) })));
    expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/price-list')).toHaveLength(0);

    vi.mocked(confirmAction).mockResolvedValueOnce(true);
    fireEvent.change(select, { target: { value: PRICE_LIST } });
    await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/price-list')).toHaveLength(1));
    const [, options] = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/woocommerce/price-list') ?? [];
    expect(JSON.parse(String((options as RequestInit).body))).toEqual({ priceList: PRICE_LIST });
  });

  it('turning the SKU rename on asks first and sends the target state', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ success: true, enabled: true });
    vi.mocked(confirmAction).mockResolvedValueOnce(true);
    render(<WcShopSyncPanel view={view} canManage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'روشن کردن' }));
    await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/sku-rename')).toHaveLength(1));
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: SKU_RENAME_ENABLE_CONFIRM }));
    const [, options] = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/woocommerce/sku-rename') ?? [];
    expect(JSON.parse(String((options as RequestInit).body))).toEqual({ enabled: true });
  });
});
