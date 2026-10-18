/**
 * 10.2 package 8 (D-07, TD-1295): the profile lists the devices the user is signed in on, marks this one and closes one
 * other device or all of them; the users page closes the devices of another user. A device is named from its user-agent
 * with a few plain patterns. Before v10.2.x there was no device list: the only way out was «خروج از همهٔ دستگاه‌ها».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fetchJson } from '../../api';
import { UserSessionsPanel } from '../../components/users/UserSessionsPanel';
import { deviceLabelOf, UNKNOWN_DEVICE_LABEL } from '../../lib/auth/deviceLabel';

vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const sessions = [
  { id: 1, deviceLabel: 'رایانه ویندوز، کروم', ipAddress: '10.0.0.1', signedInAt: '2026-10-18T06:00:00Z', lastSeenAt: '2026-10-18T07:00:00Z', expiresAt: null, isCurrent: true },
  { id: 2, deviceLabel: 'گوشی اندروید، کروم', ipAddress: '10.0.0.2', signedInAt: '2026-10-17T06:00:00Z', lastSeenAt: '2026-10-17T07:00:00Z', expiresAt: null, isCurrent: false },
];

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockServer() {
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    if ((opts?.method || 'GET') === 'GET') return { sessions };
    return { success: true, closedCount: 1 };
  });
}

describe('device_sessions_panel_td_1295', () => {
  it('names a device from its user-agent without a library', () => {
    expect(deviceLabelOf('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('گوشی اندروید، کروم');
    expect(deviceLabelOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toBe('آیفون، سافاری');
    expect(deviceLabelOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('رایانه ویندوز، اج');
    expect(deviceLabelOf('')).toBe(UNKNOWN_DEVICE_LABEL);
  });

  it('the profile marks this device, closes another one and closes the others with one button', async () => {
    mockServer();
    render(wrap(<UserSessionsPanel />));
    expect(await screen.findByText('همین دستگاه')).toBeTruthy();
    const closeButtons = screen.getAllByText('بستن');
    expect(closeButtons).toHaveLength(1);
    fireEvent.click(closeButtons[0]);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/auth/sessions/2', { method: 'DELETE' }));
    fireEvent.click(screen.getByText('بستن همهٔ دستگاه‌های دیگر'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/auth/sessions/close-others', { method: 'POST' }));
  });

  it('the users page reads and closes the devices of the chosen user', async () => {
    mockServer();
    render(wrap(<UserSessionsPanel userId={7} userName="رضا" />));
    await screen.findByText('گوشی اندروید، کروم');
    expect(fetchJson).toHaveBeenCalledWith('/users/7/sessions');
    fireEvent.click(screen.getByText('خروج از همهٔ دستگاه‌ها'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/users/7/sessions/close-all', { method: 'POST' }));
  });
});
