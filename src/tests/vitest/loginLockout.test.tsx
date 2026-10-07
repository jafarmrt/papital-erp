/**
 * v9.0.220 (TD-539, B02-24): the login page knows a lockout only from the answer's `locked` and `remainingMinutes`, counts
 * down the real minutes in Persian digits and says the sign-in is closed for this user name from this device. Before, it
 * read the minutes out of the message with `\d` (a Persian «۱۵» fell back to a made-up 15), showed «(Lockout)», a fixed
 * «۵ تلاش» and a Latin 04:00, and the general request limiter's 429 started a fake 15-minute lock too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '../../pages/LoginPage';
import { setAuthToken, setCsrfToken } from '../../api';
import {
  addressLockoutMessage, formatLockoutCountdown, loginLockoutMinutes, minutesUntil, usernameLockoutMessage,
} from '../../lib/auth/loginLockout';

let loginReply: { status: number; body: unknown } = { status: 200, body: {} };

function stubServer() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url === '/api/check-setup' ? { isSetup: true } : url === '/api/login' ? loginReply.body : {};
    const status = url === '/api/login' ? loginReply.status : 200;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}

async function submitLogin() {
  stubServer();
  render(<LoginPage onLogin={() => {}} />);
  const username = await screen.findByPlaceholderText('نام کاربری');
  fireEvent.change(username, { target: { value: 'ali' } });
  fireEvent.change(screen.getByPlaceholderText('کلمه عبور'), { target: { value: 'wrong-pass' } });
  fireEvent.submit(username.closest('form')!);
  await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u) === '/api/login')).toBe(true));
  return username as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  setCsrfToken(null);
  setAuthToken(null);
  vi.unstubAllGlobals();
});

describe('login lockout panel (TD-539)', () => {
  it('builds the messages and the countdown in Persian digits', () => {
    expect(usernameLockoutMessage(4)).toContain('ورود با این نام کاربری از این دستگاه');
    expect(usernameLockoutMessage(4)).toContain('۴ دقیقه');
    expect(addressLockoutMessage(15)).toContain('۱۵ دقیقه');
    for (const text of [usernameLockoutMessage(30), addressLockoutMessage(12)]) expect(text).not.toMatch(/[0-9]/);
    expect(formatLockoutCountdown(240)).toBe('۰۴:۰۰');
    expect(formatLockoutCountdown(61)).toBe('۰۱:۰۱');
    expect(loginLockoutMinutes({ locked: true, remainingMinutes: 4 })).toBe(4);
    expect(loginLockoutMinutes({ error: 'تعداد درخواست‌های شما بیش از حد مجاز است.' })).toBeNull();
    expect(minutesUntil(new Date(10 * 60_000 + 1), 0)).toBe(11);
  });

  it('counts down the minutes the server sent, in Persian digits, without «(Lockout)» or a fixed five', async () => {
    loginReply = { status: 429, body: { error: usernameLockoutMessage(4), locked: true, remainingMinutes: 4 } };
    const username = await submitLogin();
    await waitFor(() => expect(username.disabled).toBe(true));
    const text = document.body.textContent ?? '';
    expect(text).toContain('۰۴:۰۰');
    expect(text).toContain('از این دستگاه');
    expect(text).not.toContain('04:00');
    expect(text).not.toContain('Lockout');
    expect(text).not.toContain('۵ تلاش');
    expect(text).not.toContain('حساب قفل است');
  });

  it('a lock whose message has Persian digits still counts its own minutes', async () => {
    loginReply = { status: 429, body: { error: addressLockoutMessage(12), locked: true, remainingMinutes: 12 } };
    const username = await submitLogin();
    await waitFor(() => expect(username.disabled).toBe(true));
    expect(document.body.textContent).toContain('۱۲:۰۰');
  });

  it('a 429 of the general request limiter is an error, not a lock', async () => {
    loginReply = { status: 429, body: { error: 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند لحظه صبر کنید.' } };
    const username = await submitLogin();
    await screen.findByText('تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً چند لحظه صبر کنید.');
    expect(username.disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(/[0-9۰-۹]{2}:[0-9۰-۹]{2}/);
  });
});
