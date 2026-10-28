/**
 * 10.2 package 6 (D-04 part C): the price push, SKU rename and nightly re-read of the WooCommerce tab (`WcShopSyncPanel`)
 * and their shared rules (`src/lib/woocommerce/wcShopSync.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { fetchJson } from '../../api';
import { confirmAction } from '../../components/ConfirmDialogHost';
import { WcShopSyncPanel } from '../../components/settings/WcShopSyncPanel';
import {
  businessDayHour, isVariableParentType, nightlyDue, PRICE_PUSH_ENABLE_CONFIRM, sameSitePrice, siteCurrencyLabel, sitePriceOf, sitePricePlaces,
  SKU_RENAME_ENABLE_CONFIRM, WC_NIGHTLY_MAX_ATTEMPTS, WC_NIGHTLY_RETRY_MINUTES, WC_PRICE_SKIP_LABELS, type WcShopSyncView,
} from '../../lib/woocommerce/wcShopSync';
import { runSyncSteps } from '../../lib/woocommerce/wcSyncSteps';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn() }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: string[]) => keys.some(k => granted.has(k)),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(confirmAction).mockReset(); });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const ALL_KEYS = ['woocommerce.manage', 'products.edit_price', 'products.change_code'];
beforeEach(() => { granted.clear(); ALL_KEYS.forEach(k => granted.add(k)); });

const PRICE_LIST = 'فروشگاه';
const money = (currency: string, decimals = 2) => ({ currency, decimals });
const DOLLAR_ITEM = 'گردنبند دلاری';
const DRIFT_ITEM = 'گوشواره ناهمخوان';
const field = { enabled: false, lastRun: null, failedRuns: 0, nextAttemptAt: null, stopped: [], stoppedTotal: 0 };
const view: WcShopSyncView = {
  priceList: '',
  priceListMissing: false,
  priceLists: [PRICE_LIST, 'عمده'],
  siteCurrency: 'IRT',
  siteDecimals: 0,
  price: { ...field, skipped: [{ itemId: 4, code: 'PR-4', name: DOLLAR_ITEM, reason: 'currency_mismatch' }], skippedTotal: 1 },
  sku: { ...field, pending: 2 },
  image: { ...field, baseUrl: '', secretsReady: true, pending: 0, notRead: 0 },
  collection: { ...field, pending: 0 },
  lastNightly: { at: '2026-10-18T00:30:00.000Z', status: 'ok', error: '', summary: {} },
  // review N-4: the nightly reading compared prices in the shop currency of that night, not the last one read
  differencesCurrency: 'IRHT',
  differences: [
    { itemId: 7, code: 'PR-7', name: DRIFT_ITEM, kind: 'stock', site: '9', program: '5', unit: 'جفت' },
    { itemId: 8, code: 'PR-8', name: DRIFT_ITEM, kind: 'price', site: '120000', program: '125000' },
  ],
  differencesTotal: 2,
};

describe('D-04 part C: the shop price and the nightly rules', () => {
  it('sends a rial price in the shop unit and refuses another currency or a price that is not exact there', () => {
    expect(sitePriceOf('1250000', 'IRR', money('IRT', 0))).toEqual({ value: '125000' });
    expect(sitePriceOf('1250000', 'IRR', money('IRR', 0))).toEqual({ value: '1250000' });
    expect(sitePriceOf('25000000', null, money('IRHT', 0))).toEqual({ value: '2500' });
    expect(sitePriceOf('10', 'USD', money('IRT'))).toEqual({ skip: 'currency_mismatch' });
    expect(sitePriceOf('12.35', 'usd', money('USD'))).toEqual({ value: '12.35' });
    expect(sitePriceOf('1250000', 'IRR', money('USD'))).toEqual({ skip: 'currency_mismatch' });
    expect(sitePriceOf('0', 'IRR', money('IRT'))).toEqual({ skip: 'not_positive' });
    expect(sitePriceOf('', 'IRR', money('IRT'))).toEqual({ skip: 'no_price' });
    expect(sitePriceOf('abc', 'IRR', money('IRT'))).toEqual({ skip: 'no_price' });
  });

  it('review M-B: a rial, toman or foreign price is never rounded, a price that is not exact is left out', () => {
    expect(sitePriceOf('15005', 'IRR', money('IRT', 0))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('1234567', 'IRR', money('IRT', 0))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('5', 'IRR', money('IRT', 0))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('1.005', 'USD', money('USD', 2))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('12.345', 'USD', money('USD', 2))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('1250.5', 'IRR', money('IRR', 0))).toEqual({ skip: 'inexact_unit' });
    // a shop that charges decimals takes them exactly
    expect(sitePriceOf('15005', 'IRR', money('IRT', 1))).toEqual({ value: '1500.5' });
    // a price longer than the arithmetic's precision is never cut
    expect(sitePriceOf('1234567890123456789012345678901234', 'IRR', money('IRR', 0))).toEqual({ skip: 'inexact_unit' });
  });

  it('reviews H-1 / M-A: a thousand-unit price is exact at the shop decimals, never rounded to a whole thousand', () => {
    expect(sitePriceOf('15000', 'IRR', money('IRHT', 1))).toEqual({ value: '1.5' });
    expect(sitePriceOf('15000', 'IRR', money('IRHT', 0))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('20000', 'IRR', money('IRHT', 0))).toEqual({ value: '2' });
    expect(sitePriceOf('125000', 'IRR', money('IRHT'))).toEqual({ value: '12.5' });
    expect(sitePriceOf('4000', 'IRR', money('IRHT'))).toEqual({ value: '0.4' });
    expect(sitePriceOf('15000', 'IRR', money('IRHR', 0))).toEqual({ value: '15' });
    expect(sitePriceOf('1500', 'IRR', money('IRHR', 1))).toEqual({ value: '1.5' });
    expect(sitePriceOf('1500', 'IRR', money('IRHR', 0))).toEqual({ skip: 'inexact_unit' });
    expect(sitePriceOf('12345.67', 'IRR', money('IRHT', 4))).toEqual({ skip: 'inexact_unit' });
    // at most four decimals, whatever the shop allows
    expect(sitePricePlaces(6)).toBe(4);
    expect(sitePriceOf('12345', 'IRR', money('IRHT', 6))).toEqual({ value: '1.2345' });
    expect(sitePriceOf('12345.6', 'IRR', money('IRHT', 6))).toEqual({ skip: 'inexact_unit' });
    expect(WC_PRICE_SKIP_LABELS.inexact_unit).toMatch(/تعداد اعشار سایت/);
    // review nit N-2: the price left in the shop is not touched, and the shop may show it rounded to its own decimals
    expect(WC_PRICE_SKIP_LABELS.inexact_unit).toMatch(/دست نمی‌خورد.*گرد/);
  });

  it('review N-1: a very large price is written in plain digits, never in exponent notation', () => {
    expect(sitePriceOf(`12${'0'.repeat(33)}`, 'IRR', money('IRHT'))).toEqual({ value: `12${'0'.repeat(29)}` });
  });

  it('review N-4: a variable product of any kind is a parent whose prices are on its variations', () => {
    expect(isVariableParentType('variable')).toBe(true);
    expect(isVariableParentType('variable-subscription')).toBe(true);
    expect(isVariableParentType('simple')).toBe(false);
    expect(isVariableParentType('variation')).toBe(false);
  });

  it('review M-4 / N-1 / N-3: the questions name what turning a send on changes at once', () => {
    expect(SKU_RENAME_ENABLE_CONFIRM(3)).toMatch(/کد ۳ محصول در سایت هنوز کد پیشین/);
    expect(SKU_RENAME_ENABLE_CONFIRM(0)).not.toMatch(/هنوز کد پیشین/);
    expect(PRICE_PUSH_ENABLE_CONFIRM(PRICE_LIST)).toMatch(/ارز آن/);
    // review M-B: no rounding is promised any more
    expect(PRICE_PUSH_ENABLE_CONFIRM(PRICE_LIST)).toMatch(/گرد نمی‌شود/);
    // review N-5: the pending products change over several runs, from the next minute on
    expect(SKU_RENAME_ENABLE_CONFIRM(3)).toMatch(/از دقیقه بعد/);
    expect(PRICE_PUSH_ENABLE_CONFIRM(PRICE_LIST)).toMatch(/با دست عوض شود/);
  });

  it('review N-13: a failing worker step never keeps the next one from running', async () => {
    const ran: string[] = [];
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await runSyncSteps([
      { name: 'one', run: async () => { ran.push('one'); throw new Error('boom'); } },
      { name: 'two', run: async () => { ran.push('two'); return { state: 'failed' }; } },
      { name: 'three', run: async () => { ran.push('three'); return { state: 'pushed', result: { syncedCount: 2, failedCount: 0 } }; } },
    ], log);
    expect(ran).toEqual(['one', 'two', 'three']);
    expect(log.error).toHaveBeenCalledWith('[WooCommerce one] Run failed: Error');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('[WooCommerce three] 2 product(s) updated, 0 failed');
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
    expect(screen.getAllByText(DRIFT_ITEM)).toHaveLength(2);
    expect(screen.getByText(/واحد پول سایت: تومان، اعشار سایت: ۰/)).toBeTruthy();
    // review N-2: the drift numbers carry their unit
    expect(screen.getByText(/موجودی در سایت ۹ جفت/)).toBeTruthy();
    expect(screen.getByText(/قیمت عادی در سایت ۱۲۰٬۰۰۰ هزار تومان/)).toBeTruthy();
  });

  it('reviews M-3 / N-2: choosing a list needs the price key and turning the SKU rename on the code-change key, and the tab says so', () => {
    granted.clear();
    granted.add('woocommerce.manage');
    render(<WcShopSyncPanel view={view} canManage />, { wrapper });
    const select = screen.getByLabelText(/ارسال خودکار قیمت از فهرست/) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual(['']);
    expect(screen.queryByRole('button', { name: 'روشن کردن' })).toBeNull();
    expect(screen.getByText(/برگزیدن فهرست قیمت مجوز «ویرایش قیمت‌ها» را هم می‌خواهد/)).toBeTruthy();
    expect(screen.getByText(/روشن کردن تغییر خودکار کد مجوز «تغییر کد کالا» را هم می‌خواهد/)).toBeTruthy();
  });

  it('review N-3: the shop key alone turns either send off', async () => {
    granted.clear();
    granted.add('woocommerce.manage');
    vi.mocked(fetchJson).mockResolvedValue({ success: true, priceList: '' });
    const on = { ...view, priceList: PRICE_LIST, sku: { ...view.sku, enabled: true } };
    render(<WcShopSyncPanel view={on} canManage />, { wrapper });
    const select = screen.getByLabelText(/ارسال خودکار قیمت از فهرست/) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).map(o => o.value)).toEqual(['', PRICE_LIST]);
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/price-list')).toHaveLength(1));
    const [, options] = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/woocommerce/price-list') ?? [];
    expect(JSON.parse(String((options as RequestInit).body))).toEqual({ priceList: '' });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'خاموش کردن' })).toBeTruthy();
    expect(screen.queryByText(/مجوز «تغییر کد کالا»/)).toBeNull();
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
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: SKU_RENAME_ENABLE_CONFIRM(2) }));
    const [, options] = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/woocommerce/sku-rename') ?? [];
    expect(JSON.parse(String((options as RequestInit).body))).toEqual({ enabled: true });
  });
});
