import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fetchJson } from '../../api';
import {
  birthMonthDay, birthdayInYear, daysAwayLabel, monthDayLabel, upcomingBirthday, type BirthdaysAnswer, type ColleagueBirthday,
} from '../../lib/social/birthdays';
import { PRESENCE_ONLINE_MS, presenceStatus, recordPresence, lastSeenOf } from '../../lib/social/presence';
import {
  BELL_ONLY_CATEGORIES, MESSENGER_PREFERENCE_CATEGORIES, NOTIFICATION_CATEGORIES, isBellOnlyCategory,
} from '../../lib/notifications/notificationCategories';
import { ColleagueBirthdaysCard } from '../../components/dashboard/social/ColleagueBirthdaysCard';
import { MyBirthdayBanner } from '../../components/dashboard/social/MyBirthdayBanner';
import { OnlineColleaguesCard } from '../../components/dashboard/social/OnlineColleaguesCard';

vi.mock('../../api', () => ({ fetchJson: vi.fn() }));
const fetchMock = vi.mocked(fetchJson);

beforeEach(() => { fetchMock.mockReset(); });
afterEach(cleanup);

function wrap(children: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const today: ColleagueBirthday = {
  personnelId: 7, name: 'مریم احمدی', avatarUrl: '', label: '۲۶ مهر', daysAway: 0, isToday: true, isMine: false,
  greetings: [
    { id: 1, senderUserId: 3, senderName: 'رضا', senderAvatarUrl: '', reaction: 'cake', message: 'تولدت مبارک', mine: false },
    { id: 2, senderUserId: 4, senderName: 'سارا', senderAvatarUrl: '', reaction: 'cake', message: '', mine: false },
  ],
};
const soon: ColleagueBirthday = {
  personnelId: 8, name: 'علی کریمی', avatarUrl: '', label: '۳ آبان', daysAway: 7, isToday: false, isMine: false, greetings: [],
};

describe('group dashboard birthdays (v10.2 package 9)', () => {
  it('reads the Jalali day and month of a stored ISO birth date, never the year', () => {
    expect(birthMonthDay('2000-10-17')).toEqual({ month: 7, day: 26 });
    expect(birthMonthDay('')).toBeNull();
    expect(birthMonthDay('1379/07/26')).toBeNull();
    expect(birthMonthDay('2001-02-30')).toBeNull();
    expect(monthDayLabel({ month: 7, day: 26 })).toBe('۲۶ مهر');
  });

  it('moves a 30 Esfand birthday to 29 Esfand in a year whose Esfand has 29 days', () => {
    expect(birthdayInYear({ month: 12, day: 30 }, 1403)).toEqual({ month: 12, day: 30 });
    expect(birthdayInYear({ month: 12, day: 30 }, 1404)).toEqual({ month: 12, day: 29 });
    expect(upcomingBirthday('2025-03-20', '2026-03-18')).toEqual({ daysAway: 2, jalaliYear: 1404, monthDay: { month: 12, day: 29 } });
  });

  it('finds birthdays from today to seven days ahead, across the new year', () => {
    expect(upcomingBirthday('2000-10-17', '2026-10-18')?.daysAway).toBe(0);
    expect(upcomingBirthday('1990-10-25', '2026-10-18')?.daysAway).toBe(7);
    expect(upcomingBirthday('1990-10-26', '2026-10-18')).toBeNull();
    expect(upcomingBirthday('2000-10-16', '2026-10-18')).toBeNull();
    expect(upcomingBirthday('2001-03-22', '2027-03-17')).toEqual({ daysAway: 5, jalaliYear: 1406, monthDay: { month: 1, day: 2 } });
    expect([daysAwayLabel(0), daysAwayLabel(1), daysAwayLabel(3)]).toEqual(['امروز', 'فردا', '۳ روز دیگر']);
  });

  it('shows the card with day and month only and counts the reactions', () => {
    render(wrap(<ColleagueBirthdaysCard birthdays={[today, soon]} loading={false} />));
    expect(screen.getByText('مریم احمدی')).toBeTruthy();
    expect(screen.getByText('۲۶ مهر')).toBeTruthy();
    expect(screen.getByText('۷ روز دیگر')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/۱۳[0-9۰-۹]{2}|14\d\d|سال/);
    expect(screen.getAllByTitle('کیک تولد').find(e => e.tagName === 'SPAN')?.textContent).toContain('۲');
    expect(screen.getByText('تولدت مبارک')).toBeTruthy();
    // only today's birthday takes a greeting
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });

  it('saves a reaction at once and shows the answer of the server', async () => {
    const answer: BirthdaysAnswer = {
      myBirthdayToday: false,
      birthdays: [{ ...today, greetings: [...today.greetings, { id: 9, senderUserId: 1, senderName: 'من', senderAvatarUrl: '', reaction: 'party', message: '', mine: true }] }],
    };
    fetchMock.mockResolvedValue(answer);
    render(wrap(<ColleagueBirthdaysCard birthdays={[today]} loading={false} />));
    fireEvent.click(screen.getByRole('button', { name: 'جشن' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/social/birthdays/7/greeting', {
      method: 'PUT', body: JSON.stringify({ reaction: 'party', message: '' }),
    }));
  });

  it('greets the owner only when the answer says it is their birthday', () => {
    const { rerender } = render(wrap(<MyBirthdayBanner answer={{ myBirthdayToday: false, birthdays: [] }} firstName="مریم" />));
    expect(screen.queryByText(/تولدتان مبارک/)).toBeNull();
    rerender(wrap(<MyBirthdayBanner answer={{ myBirthdayToday: true, birthdays: [{ ...today, isMine: true }] }} firstName="مریم" />));
    expect(screen.getByText('مریم عزیز، تولدتان مبارک!')).toBeTruthy();
    expect(screen.getByText(/۲ همکار به شما تبریک گفته‌اند/)).toBeTruthy();
  });
});

describe('group dashboard presence (v10.2 package 9)', () => {
  const now = Date.UTC(2026, 9, 18, 9, 0, 0); // 12:30 in Tehran on 2026-10-18

  it('is online for five minutes after the last request, then «today» on the same business day', () => {
    expect(presenceStatus(undefined, now, '2026-10-18', 'Asia/Tehran')).toBeNull();
    expect(presenceStatus(now - PRESENCE_ONLINE_MS, now, '2026-10-18', 'Asia/Tehran')).toBe('online');
    expect(presenceStatus(now - PRESENCE_ONLINE_MS - 1, now, '2026-10-18', 'Asia/Tehran')).toBe('today');
    // 23:00 Tehran on the day before
    expect(presenceStatus(Date.UTC(2026, 9, 17, 19, 30), now, '2026-10-18', 'Asia/Tehran')).toBeNull();
  });

  it('keeps only a positive user id and the time', () => {
    const seen = new Map<number, number>();
    recordPresence(5, now, seen);
    recordPresence(0, now, seen);
    recordPresence(Number.NaN, now, seen);
    expect([...seen.keys()]).toEqual([5]);
    expect(lastSeenOf(5, seen)).toBe(now);
  });

  it('shows the colleague and the status label, never a page', () => {
    render(wrap(<OnlineColleaguesCard colleagues={[
      { userId: 2, name: 'رضا', avatarUrl: '', status: 'online' },
      { userId: 3, name: 'سارا', avatarUrl: '', status: 'today' },
    ]} loading={false} />));
    expect(screen.getByText('برخط است')).toBeTruthy();
    expect(screen.getByText('امروز آمده')).toBeTruthy();
    expect(screen.getByText('۱ نفر برخط')).toBeTruthy();
  });
});

describe('social notifications stay in the bell (v10.2 package 9)', () => {
  it('is a category of its own that the messenger preferences never offer', () => {
    expect(NOTIFICATION_CATEGORIES).toContain('social');
    expect(BELL_ONLY_CATEGORIES).toEqual(['social']);
    expect(isBellOnlyCategory('social')).toBe(true);
    expect(MESSENGER_PREFERENCE_CATEGORIES).not.toContain('social');
  });
});
