import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PWA_ICON_FILES, PWA_NETWORK_ONLY_PATHS, PWA_PRECACHE_PATTERNS, PWA_STATIC_ASSET_URL, pwaManifest, pwaPluginOptions } from '../../lib/pwa/pwaConfig';
import { markUpdateReady, resetPwaStatusForTests } from '../../lib/pwa/pwaStatus';
import { shouldCheckForUpdate, UPDATE_CHECK_MIN_INTERVAL_MS } from '../../lib/pwa/registerServiceWorker';
import { installMode, isIosDevice, listenForInstallPrompt } from '../../lib/pwa/installPrompt';
import { OFFLINE_BANNER_TEXT, PwaStatusBanners, UPDATE_BANNER_TEXT, UPDATE_BUTTON_TEXT } from '../../components/pwa/PwaStatusBanners';
import { InstallAppButton, INSTALL_BUTTON_TEXT, IOS_GUIDE_TITLE } from '../../components/pwa/InstallAppButton';

// v10.0.16 (D-11, plan MOBILE_WORKSHOP_PLAN.md, owner decision t12-b): the app installs on a phone through vite-plugin-pwa.
// The service worker keeps the app shell only: no /api answer, attachment or uploaded image is ever cached, and a new
// version waits for the user's reload instead of replacing an open page silently.

const ROOT = join(__dirname, '..', '..', '..');

afterEach(() => {
  cleanup();
  resetPwaStatusForTests();
  vi.unstubAllGlobals();
});

describe('installable app manifest and service worker rules (D-11)', () => {
  it('describes a right-to-left Persian standalone app whose icons exist', () => {
    const manifest = pwaManifest();
    expect(manifest).toMatchObject({ lang: 'fa', dir: 'rtl', display: 'standalone', start_url: '/', scope: '/' });
    expect((manifest.icons ?? []).some(icon => icon.purpose === 'maskable')).toBe(true);
    for (const file of Object.values(PWA_ICON_FILES)) expect(existsSync(join(ROOT, 'public', file))).toBe(true);
  });

  it('never answers a server path with the app page', () => {
    const denylist = pwaPluginOptions().workbox?.navigateFallbackDenylist ?? [];
    for (const path of ['/api', '/api/documents/5', '/uploads/a.png', '/health/ready', '/metrics']) {
      expect(denylist.some(rule => rule.test(path))).toBe(true);
    }
    for (const path of ['/', '/approval-inbox', '/audit', '/apiary']) {
      expect(PWA_NETWORK_ONLY_PATHS.some(rule => rule.test(path))).toBe(false);
    }
  });

  it('keeps only hashed build files at run time, never server data', () => {
    const runtime = pwaPluginOptions().workbox?.runtimeCaching ?? [];
    expect(runtime).toHaveLength(1);
    expect(runtime[0].urlPattern).toBe(PWA_STATIC_ASSET_URL);
    for (const url of ['https://erp.example/assets/ProjectsPage-CBRkz9oA.js', 'https://erp.example/assets/index-fYKD6I1m.css', 'https://erp.example/fonts/vazirmatn/Vazirmatn-Bold.woff2']) {
      expect(PWA_STATIC_ASSET_URL.test(url)).toBe(true);
    }
    for (const url of ['https://erp.example/api/items', 'https://erp.example/api/attachments/12', 'https://erp.example/uploads/products/a.png', 'https://erp.example/api/assets/x.js']) {
      expect(PWA_STATIC_ASSET_URL.test(url)).toBe(false);
    }
  });

  it('precaches the shell only, not the heavy Excel and changelog chunks', () => {
    const patterns = pwaPluginOptions().workbox?.globPatterns ?? [];
    expect(patterns).toEqual([...PWA_PRECACHE_PATTERNS]);
    expect(patterns.join(' ')).not.toMatch(/\*\*|excel|changelog|uploads|api/);
    expect(pwaPluginOptions().registerType).toBe('prompt');
  });

  it('gives the page a theme colour and an iPhone home-screen icon', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain(`href="/${PWA_ICON_FILES.appleTouch180}"`);
  });

  it('checks for a new version on return to the app at most every half hour', () => {
    expect(shouldCheckForUpdate(0, UPDATE_CHECK_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCheckForUpdate(0, UPDATE_CHECK_MIN_INTERVAL_MS)).toBe(true);
  });
});

describe('offline and new-version banners (D-11, decision t10-a)', () => {
  it('shows the offline banner while the phone has no connection', () => {
    render(<PwaStatusBanners />);
    expect(screen.queryByText(OFFLINE_BANNER_TEXT)).toBeNull();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText(OFFLINE_BANNER_TEXT)).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByText(OFFLINE_BANNER_TEXT)).toBeNull();
  });

  it('replaces the open version only when the user presses reload', async () => {
    const apply = vi.fn();
    render(<PwaStatusBanners />);
    expect(screen.queryByText(UPDATE_BANNER_TEXT)).toBeNull();
    act(() => markUpdateReady(apply));
    expect(screen.getByText(UPDATE_BANNER_TEXT)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText(UPDATE_BUTTON_TEXT)); });
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('install button (D-11)', () => {
  it('recognises an iPhone and an iPad that reports itself as a Mac', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5)).toBe(false);
  });

  it('opens the iPhone home-screen guide, since iPhones have no install prompt', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButton />);
    fireEvent.click(screen.getByText(INSTALL_BUTTON_TEXT));
    expect(screen.getByText(IOS_GUIDE_TITLE)).toBeTruthy();
  });

  it('shows the browser install prompt on Android and hides the button afterwards', async () => {
    listenForInstallPrompt();
    expect(installMode()).toBe('none');
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    render(<InstallAppButton />);
    await act(async () => { fireEvent.click(screen.getByText(INSTALL_BUTTON_TEXT)); });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(INSTALL_BUTTON_TEXT)).toBeNull();
  });
});
