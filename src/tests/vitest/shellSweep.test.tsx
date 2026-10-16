/**
 * Closing sweep, app shell (part 1): global search and page filter, error boundaries, logo compression, the display
 * time zone and the confirmation window. Each test is red on v10.1.53.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import GlobalHeaderSearch from '../../components/GlobalHeaderSearch';
import { SearchProvider, SearchRouteReset, useSearch } from '../../SearchContext';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { SectionErrorBoundary } from '../../components/common/SectionErrorBoundary';
import { compressTo300KB } from '../../utils/imageCompression';
import { TimezoneProvider, useDisplayTimezone } from '../../components/providers/TimezoneProvider';
import { formatPersianDateTime, setDisplayTimezone, toPersianDigits } from '../../utils';
import ConfirmModal from '../../components/ConfirmModal';

const api = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve({ items: [], customers: [], documents: [], projects: [] }));
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => api(...args) }));

const NEW_VERSION_TITLE = 'به‌روزرسانی نسخه جدید سامانه';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setDisplayTimezone('Asia/Tehran');
});

const globalSearchCalls = () => api.mock.calls.filter(call => String(call[0]).startsWith('/global-search'));

function PageFilter() {
  const { searchQuery, setSearchQuery } = useSearch();
  return <input aria-label="page filter" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />;
}

function GoTo({ path }: { path: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => void navigate(path)}>{`go ${path}`}</button>;
}

describe('OBS-R2-91 global search and the page filter are separate', () => {
  it('obs_r2_91_page_filter: typing in a page filter sends no global search, and a route change clears the filter', async () => {
    api.mockImplementation(() => Promise.resolve({ items: [], customers: [], documents: [], projects: [] }));
    render(
      <SearchProvider>
        <MemoryRouter initialEntries={['/products']}>
          <SearchRouteReset />
          <GlobalHeaderSearch />
          <PageFilter />
          <GoTo path="/customers" />
        </MemoryRouter>
      </SearchProvider>,
    );
    const filter = screen.getByLabelText('page filter') as HTMLInputElement;
    fireEvent.change(filter, { target: { value: 'N-0042' } });
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(globalSearchCalls()).toHaveLength(0);
    expect((screen.getByPlaceholderText(/Ctrl\+K/) as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByText('go /customers'));
    await waitFor(() => expect((screen.getByLabelText('page filter') as HTMLInputElement).value).toBe(''));
  });
});

function Thrower({ error }: { error: Error | null }) {
  if (error) throw error;
  return <p>page body</p>;
}

describe('OBS-R2-92 error boundaries', () => {
  it('obs_r2_92_hook_error_is_not_a_new_version: «Invalid hook call» and a plain «Failed to fetch» are ordinary errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ErrorBoundary><Thrower error={new Error('Invalid hook call. Hooks can only be called inside of the body of a function component.')} /></ErrorBoundary>);
    expect(screen.queryByText(NEW_VERSION_TITLE)).toBeNull();
    cleanup();
    render(<SectionErrorBoundary><Thrower error={new TypeError('Failed to fetch')} /></SectionErrorBoundary>);
    expect(screen.queryByText(NEW_VERSION_TITLE)).toBeNull();
    cleanup();
    render(<SectionErrorBoundary><Thrower error={new TypeError('Failed to fetch dynamically imported module: /assets/Page-1.js')} /></SectionErrorBoundary>);
    expect(screen.getByText(NEW_VERSION_TITLE)).toBeTruthy();
  });

  it('obs_r2_92_root_reset_on_route: the root boundary clears its error when the reset key (the route) changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Harness() {
      const [path, setPath] = useState('/a');
      return (
        <>
          <button type="button" onClick={() => setPath('/b')}>move</button>
          <ErrorBoundary resetKey={path}><Thrower error={path === '/a' ? new Error('page crashed') : null} /></ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.queryByText('page body')).toBeNull();
    fireEvent.click(screen.getByText('move'));
    expect(screen.getByText('page body')).toBeTruthy();
  });
});

class LoadedImage {
  width = 4;
  height = 4;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { setTimeout(() => this.onload?.(), 0); }
}

function stubCanvas(alpha: number) {
  const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  pixels[3] = alpha;
  const ctx = { drawImage: () => undefined, getImageData: () => ({ data: pixels }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((type?: string) => `data:${type ?? 'image/png'};base64,AAAA`);
}

describe('OBS-R2-95 logo compression keeps transparency', () => {
  it('obs_r2_95_transparent_png: a transparent PNG keeps an alpha format, an opaque photo becomes JPEG', async () => {
    vi.stubGlobal('Image', LoadedImage);
    const toDataUrl = stubCanvas(0);
    const logo = await compressTo300KB(new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }));
    expect(logo.startsWith('data:image/webp') || logo.startsWith('data:image/png')).toBe(true);
    expect(toDataUrl.mock.calls.some(call => call[0] === 'image/jpeg')).toBe(false);

    vi.restoreAllMocks();
    stubCanvas(255);
    const photo = await compressTo300KB(new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' }));
    expect(photo.startsWith('data:image/jpeg')).toBe(true);
    vi.unstubAllGlobals();
  });
});

const INSTANT = '2026-10-16T02:00:00Z';
const NEW_YORK_TIME = toPersianDigits('22:00:00');

function SettingsClock() {
  return <span data-testid="clock">{formatPersianDateTime(INSTANT)}</span>;
}

function ZoneReader() {
  return <span data-testid="zone">{useDisplayTimezone()}</span>;
}

describe('OBS-R2-106 the display time zone reaches components rendered before it loaded', () => {
  it('obs_r2_106_timezone_rerender: pages render in the configured zone and zone readers re-render on a change', async () => {
    let answer: (rows: unknown) => void = () => undefined;
    api.mockImplementation((url: unknown) => (String(url).startsWith('/settings')
      ? new Promise(resolve => { answer = resolve; })
      : Promise.resolve([])));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><TimezoneProvider><SettingsClock /><ZoneReader /></TimezoneProvider></QueryClientProvider>);
    await act(async () => { answer([{ key: 'display_timezone', value: 'America/New_York' }]); });
    await waitFor(() => expect(screen.getByTestId('clock').textContent).toContain(NEW_YORK_TIME));
    act(() => { setDisplayTimezone('UTC'); });
    expect(screen.getByTestId('zone').textContent).toBe('UTC');
  });
});

describe('OBS-R1-34 the confirmation window runs its action once', () => {
  it('obs_r1_34_confirm_once: a second click sends nothing, Esc does not close while running, a failure keeps it open', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve, reject) => { finish = ok => (ok ? resolve() : reject(new Error('refused'))); }));
    const onCancel = vi.fn();
    render(<ConfirmModal isOpen message="delete?" onConfirm={onConfirm} onCancel={onCancel} confirmText="yes" cancelText="no" />);
    const confirm = screen.getByText('yes').closest('button') as HTMLButtonElement;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => { finish(false); });
    expect((screen.getByText('yes').closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
