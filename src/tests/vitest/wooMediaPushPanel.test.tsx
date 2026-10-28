/**
 * v11 phase 6.5 (D-04 part D): «ارسال تصویر شاخص» and «ارسال کالکشن‌ها» of the WooCommerce tab (`WcMediaPushPanel`) and
 * their rules (`src/lib/woocommerce/wcMediaPush.ts`, `imageStep`, `nextTags`, `tagNameKey`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { confirmAction } from '../../components/ConfirmDialogHost';
import { WcMediaPushPanel } from '../../components/settings/WcMediaPushPanel';
import { checkMediaBaseUrl, collectionsKey, type WcCollectionPushView, type WcImagePushView } from '../../lib/woocommerce/wcMediaPush';
import { imageStep } from '../../services/woocommerce/wcImagePush.service';
import { nextTags, tagNameKey } from '../../services/woocommerce/wcCollectionPush.service';

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
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(confirmAction).mockReset(); vi.mocked(toast.error).mockReset(); });
beforeEach(() => { granted.clear(); });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const field = { enabled: false, lastRun: null, failedRuns: 0, nextAttemptAt: null, stopped: [], stoppedTotal: 0 };
const image: WcImagePushView = { ...field, baseUrl: '', secretsReady: true, pending: 3, notRead: 0 };
const collection: WcCollectionPushView = { ...field, pending: 2 };
const sent = () => vi.mocked(fetchJson).mock.calls.map(([url, opts]) => [url, (opts as { body?: string } | undefined)?.body]);

describe('D-04 part D: the shared rules', () => {
  it('takes a public address WordPress downloads from and refuses any other', () => {
    expect(checkMediaBaseUrl(' https://erp.example.com/ ')).toEqual({ url: 'https://erp.example.com' });
    expect(checkMediaBaseUrl('http://erp.example.com:8080/app/')).toEqual({ url: 'http://erp.example.com:8080/app' });
    for (const bad of ['', 'erp.example.com', 'ftp://erp.example.com', 'https://erp.example.com:22', 'https://u:p@erp.example.com', 'https://erp.example.com/?a=1', 'https://erp.example.com/#x']) {
      expect(checkMediaBaseUrl(bad)).toHaveProperty('error');
    }
  });

  it('compares collections without letter case, order, spaces or repeats', () => {
    expect(collectionsKey(['Summer  Sun', 'gold', 'GOLD'])).toBe(collectionsKey(['gold', 'summer sun']));
    expect(collectionsKey([])).toBe('');
    expect(collectionsKey(null)).toBe('');
  });

  it('decision 45: records a product that had a shop image, sends to one without, sends a changed cover only, removes nothing', () => {
    const cover = 'a'.repeat(64);
    expect(imageStep({ siteImageId: null, coverSentSha256: '' }, cover)).toBeNull();
    expect(imageStep({ siteImageId: 501, coverSentSha256: '' }, cover)).toEqual({ record: cover });
    expect(imageStep({ siteImageId: 0, coverSentSha256: '' }, cover)).toEqual({ send: true });
    expect(imageStep({ siteImageId: 0, coverSentSha256: '' }, null)).toEqual({ record: 'none' });
    expect(imageStep({ siteImageId: 9000, coverSentSha256: cover }, cover)).toBeNull();
    expect(imageStep({ siteImageId: 9000, coverSentSha256: cover }, 'b'.repeat(64))).toEqual({ send: true });
    expect(imageStep({ siteImageId: 9000, coverSentSha256: cover }, null)).toEqual({ record: 'none' });
    expect(imageStep({ siteImageId: 9000, coverSentSha256: 'none' }, null)).toBeNull();
    expect(imageStep({ siteImageId: 9000, coverSentSha256: 'none' }, cover)).toEqual({ send: true });
  });

  it('decision 44: only the tags the program added leave, the shop\'s own tags stay', () => {
    // shop tags 80 and 81; the program added 70 before; now it wants 81 and 90
    expect(nextTags([80, 81, 70], [70], [81, 90])).toEqual({ tags: [80, 81, 90], added: [90] });
    // a wanted tag the program had added stays the program's
    expect(nextTags([80, 70], [70], [70])).toEqual({ tags: [80, 70], added: [70] });
    expect(nextTags([80], [], [])).toEqual({ tags: [80], added: [] });
  });

  it('compares a WordPress tag name without its HTML entities, spaces or letter case', () => {
    expect(tagNameKey('Summer &amp; Sun')).toBe(tagNameKey(' summer & sun '));
    expect(tagNameKey('It&#039;s')).toBe("it's");
  });
});

describe('D-04 part D: WcMediaPushPanel', () => {
  it('turns the image push on only with media.manage, a valid address and the confirmation', async () => {
    granted.add('woocommerce.manage');
    const { unmount } = render(<WcMediaPushPanel image={image} collection={collection} canManage />, { wrapper });
    expect(screen.getByText(/مجوز «مدیریت کتابخانه تصاویر» را هم می‌خواهد/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    unmount();

    granted.add('media.manage');
    vi.mocked(fetchJson).mockResolvedValue({ success: true, message: 'روشن شد' });
    vi.mocked(confirmAction).mockResolvedValue(true);
    render(<WcMediaPushPanel image={image} collection={collection} canManage />, { wrapper });
    const section = screen.getByRole('region', { name: 'ارسال تصویر شاخص' });
    const button = section.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(fetchJson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://erp.example.com:22' } });
    expect(screen.getByText(/درگاه/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://erp.example.com/' } });
    fireEvent.click(button);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    expect(vi.mocked(confirmAction).mock.calls[0][0].message).toContain('۳ محصول');
    expect(sent()).toEqual([['/woocommerce/image-push', JSON.stringify({ enabled: true, mediaBaseUrl: 'https://erp.example.com' })]]);
  });

  it('turns either push off with woocommerce.manage alone, and says when the secrets key is missing', async () => {
    granted.add('woocommerce.manage');
    vi.mocked(fetchJson).mockResolvedValue({ success: true });
    render(<WcMediaPushPanel image={{ ...image, enabled: true, baseUrl: 'https://erp.example.com', secretsReady: false }} collection={{ ...collection, enabled: true }} canManage />, { wrapper });
    expect(screen.getByText(/کلید رمزنگاری سرور تنظیم نشده/)).toBeTruthy();
    for (const name of ['ارسال تصویر شاخص', 'ارسال کالکشن‌ها']) {
      fireEvent.click(screen.getByRole('region', { name }).querySelector('button') as HTMLButtonElement);
    }
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(sent()).toEqual([
      ['/woocommerce/image-push', JSON.stringify({ enabled: false })],
      ['/woocommerce/collection-push', JSON.stringify({ enabled: false })],
    ]);
  });

  it('turns the collection push on with products.edit after the confirmation, and a cancel sends nothing', async () => {
    granted.add('woocommerce.manage');
    granted.add('products.edit');
    vi.mocked(fetchJson).mockResolvedValue({ success: true });
    vi.mocked(confirmAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WcMediaPushPanel image={image} collection={collection} canManage />, { wrapper });
    const button = screen.getByRole('region', { name: 'ارسال کالکشن‌ها' }).querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(fetchJson).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual([['/woocommerce/collection-push', JSON.stringify({ enabled: true })]]);
  });

  it('shows no switch to a reader of the tab', () => {
    render(<WcMediaPushPanel image={image} collection={collection} canManage={false} />, { wrapper });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
