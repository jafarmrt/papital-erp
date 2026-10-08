/**
 * v9.0.391 (TD-725, B15-23 / FE-11): the notification bell reads a server time as UTC and prints its relative time with
 * Persian digits (`notificationRelativeTime` in `src/lib/notifications/relativeTime.ts`). On v9.0.390 a zone-less server
 * time was read as the browser's own wall clock, so in a Tehran browser a notification made 30 seconds ago said
 * «3 ساعت پیش», with a Latin digit.
 */
process.env.TZ = 'Asia/Tehran';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationBell from '../../components/NotificationBell';
import { notificationRelativeTime } from '../../lib/notifications/relativeTime';

const notifState = { list: [] as unknown[] };
vi.mock('../../hooks/queries', () => ({
  useUnreadNotificationsCountQuery: () => ({ data: 1 }),
  useNotificationsQuery: () => ({ data: notifState.list, isLoading: false }),
  useMarkNotificationReadMutation: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsReadMutation: () => ({ mutate: vi.fn() }),
  useDeleteNotificationMutation: () => ({ mutate: vi.fn() }),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const NOW = new Date('2026-10-06T10:00:30Z');

describe('TD-725 notification relative time', () => {
  it('reads a zone-less server time as UTC and a Z time the same way, with Persian digits', () => {
    expect(new Date('2026-10-06T00:00:00').getTimezoneOffset()).toBe(-210);
    expect(notificationRelativeTime('2026-10-06 10:00:00', NOW)).toBe('همین الان');
    expect(notificationRelativeTime('2026-10-06T10:00:00Z', NOW)).toBe('همین الان');
    expect(notificationRelativeTime('2026-10-06 09:55:00', NOW)).toBe('۵ دقیقه پیش');
    expect(notificationRelativeTime('2026-10-06 07:00:00', NOW)).toBe('۳ ساعت پیش');
    expect(notificationRelativeTime('2026-10-04 10:00:00', NOW)).toBe('۲ روز پیش');
    expect(notificationRelativeTime('', NOW)).toBe('');
    expect(notificationRelativeTime('not a date', NOW)).toBe('');
  });

  it('the bell shows a notification made 30 seconds ago as just now', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    notifState.list = [{ id: 1, type: 'mention', title: 'اشاره تازه', message: 'متن', link: '', is_read: 0, created_at: '2026-10-06 10:00:00' }];
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(screen.getByTitle('اعلان‌ها و منشن‌ها'));
    expect(screen.getByText('همین الان')).toBeTruthy();
    expect(screen.queryByText(/ساعت پیش/)).toBeNull();
  });
});
