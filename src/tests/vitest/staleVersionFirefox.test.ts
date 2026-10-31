/**
 * v11 (owner report 9 Aban 1405): the app showed a blank white page in Firefox until Ctrl+Shift+R. A tab or service
 * worker still on the old version asked for chunks the server no longer has; the server answered with the app page
 * and the plain reload went back to the same old service worker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBuildFilePath } from '../../lib/system/buildFilePath';
import { reloadWithNewestServiceWorker } from '../../lib/system/chunkReload';
import { PWA_STATIC_ASSET_URL } from '../../lib/pwa/pwaConfig';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

afterEach(() => {
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  vi.useRealTimers();
});

function fakeContainer(registration: unknown) {
  const listeners: Record<string, () => void> = {};
  const container = {
    getRegistration: vi.fn(async () => registration),
    addEventListener: vi.fn((type: string, cb: () => void) => { listeners[type] = cb; }),
    fire: (type: string) => listeners[type]?.(),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return container;
}

describe('a missing build file is a 404, never the app page', () => {
  it('build files under assets, fonts and pwa, and file extensions, are build file paths', () => {
    expect(isBuildFilePath('/assets/SalesReportTab-MPVtWXBt.js')).toBe(true);
    expect(isBuildFilePath('/assets/index-abc.css')).toBe(true);
    expect(isBuildFilePath('/fonts/vazirmatn/Vazirmatn-Bold.woff2')).toBe(true);
    expect(isBuildFilePath('/pwa/pwa-192x192.png')).toBe(true);
    expect(isBuildFilePath('/workbox-35e397ac.js')).toBe(true);
    expect(isBuildFilePath('/manifest.webmanifest')).toBe(true);
  });

  it('app pages still get the app page', () => {
    for (const p of ['/', '/invoices/create', '/accounting/vouchers', '/reports/sales', '/parties/12']) {
      expect(isBuildFilePath(p)).toBe(false);
    }
  });

  it('every URL the service worker caches cache-first is a build file path', () => {
    for (const p of ['/assets/a-1.js', '/assets/b-2.css', '/fonts/x.woff2']) {
      expect(PWA_STATIC_ASSET_URL.test(`https://erp.example${p}`)).toBe(true);
      expect(isBuildFilePath(p)).toBe(true);
    }
  });
});

describe('the reload after a chunk error asks for the newest service worker first', () => {
  it('a waiting worker is told to take over, and the page reloads after it does', async () => {
    const postMessage = vi.fn();
    const registration = { update: vi.fn(async () => undefined), waiting: { postMessage } };
    const container = fakeContainer(registration);
    const reload = vi.fn();
    const done = reloadWithNewestServiceWorker(reload);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
    expect(registration.update).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    container.fire('controllerchange');
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('no waiting worker: a plain reload', async () => {
    fakeContainer({ update: vi.fn(async () => undefined), waiting: null });
    const reload = vi.fn();
    await reloadWithNewestServiceWorker(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a failed update check or no service worker support still reloads', async () => {
    fakeContainer({ update: vi.fn(async () => { throw new Error('offline'); }), waiting: null });
    const reload = vi.fn();
    await reloadWithNewestServiceWorker(reload);
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    const reload2 = vi.fn();
    await reloadWithNewestServiceWorker(reload2);
    expect(reload2).toHaveBeenCalledTimes(1);
  });

  it('a worker that never takes over does not hold the reload', async () => {
    vi.useFakeTimers();
    fakeContainer({ update: vi.fn(async () => undefined), waiting: { postMessage: vi.fn() } });
    const reload = vi.fn();
    const done = reloadWithNewestServiceWorker(reload);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
