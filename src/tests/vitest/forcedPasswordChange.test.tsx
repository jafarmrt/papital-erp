/**
 * v9.0.219 (TD-523, B02-08, owner decision t5 A): a password an administrator set is temporary. Until the user changes
 * it the browser shows only the password form, which closes only through «خروج», and loads no menu or page. Before,
 * the forced form closed with × and «انصراف» and the whole application stayed open behind it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import App from '../../App';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { SearchProvider } from '../../SearchContext';
import { queryClient as appQueryClient } from '../../lib/queryClient';
import { fetchJson, setAuthToken, setCsrfToken } from '../../api';
import UserProfileModal from '../../components/UserProfileModal';
import { PASSWORD_RESET_ALLOWED_PATHS, PASSWORD_RESET_REQUIRED, mustChangePassword } from '../../lib/auth/passwordReset';
import type { User } from '../../types';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { default: toast, toast, Toaster: () => null };
});

type Call = { url: string; method: string };
let calls: Call[] = [];
let meUser: Record<string, unknown> = {};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubServer(profileDelayMs = 0) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    if (url === '/api/auth/me') return reply(200, { authenticated: true, user: meUser, csrfToken: 'c1' });
    if (url === '/api/users/my-permissions') return reply(200, { permissions: ['documents.view'], isAdmin: false, roleName: 'حسابدار' });
    if (url === '/api/auth/logout') return reply(200, { success: true });
    if (url === '/api/users/profile' && method === 'PUT') {
      if (profileDelayMs > 0) await new Promise(r => setTimeout(r, profileDelayMs));
      return reply(200, { success: true, user: { ...meUser, mustResetPassword: false, must_reset_password: false }, csrfToken: 'c2' });
    }
    if (url === '/api/documents') return reply(403, { error: 'رمز موقت', code: PASSWORD_RESET_REQUIRED });
    return reply(200, {});
  }));
}

const temporaryUser = { id: 5, username: 'ali', full_name: 'علی رضایی', role: 'accountant', mustResetPassword: true, must_reset_password: true };

function renderApp() {
  render(
    <QueryClientProvider client={appQueryClient}>
      <AuthProvider>
        <SearchProvider>
          <App />
        </SearchProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const pathOf = (url: string) => url.split('?')[0];
const passwordInputs = () => Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
const passwordFormShown = () => waitFor(() => expect(passwordInputs()).toHaveLength(3));
/**
 * TD-1189: after the change the application loads its shell (lazy chunks) and closes the form; on a busy
 * runner that took longer than `waitFor`'s default 1 s, so the wait follows the real steps with its own limit.
 */
const APP_OPEN_TIMEOUT_MS = 10_000;

async function changePasswordAndOpenApp(profileDelayMs = 0) {
  meUser = temporaryUser;
  stubServer(profileDelayMs);
  renderApp();
  await passwordFormShown();
  const [current, next, confirm] = passwordInputs();
  fireEvent.change(current, { target: { value: 'Tempor4ry!' } });
  fireEvent.change(next, { target: { value: 'N3w-passw0rd' } });
  fireEvent.change(confirm, { target: { value: 'N3w-passw0rd' } });
  fireEvent.submit(next.closest('form')!);
  await waitFor(() => expect(calls.some(c => c.url === '/api/users/profile' && c.method === 'PUT')).toBe(true));
  await waitFor(() => expect(passwordInputs()).toHaveLength(0), { timeout: APP_OPEN_TIMEOUT_MS });
  await waitFor(() => expect(document.querySelector('aside')).not.toBeNull(), { timeout: APP_OPEN_TIMEOUT_MS });
}

afterEach(() => {
  cleanup();
  appQueryClient.clear();
  setCsrfToken(null);
  setAuthToken(null);
  vi.unstubAllGlobals();
});

describe('temporary password (TD-523)', () => {
  it('the forced form has no close button and no cancel; the sign-out button is the only way out', () => {
    const onClose = vi.fn();
    const onLogout = vi.fn();
    render(<UserProfileModal user={temporaryUser as unknown as User} isOpen onClose={onClose} onUserUpdate={() => {}} onLogout={onLogout} />);
    for (const button of screen.getAllByRole('button')) {
      if (button.getAttribute('type') !== 'submit' && button.textContent !== 'خروج') fireEvent.click(button);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'انصراف' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'خروج' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('the application shows only the password form and asks the server for nothing else', async () => {
    meUser = temporaryUser;
    stubServer();
    renderApp();
    await passwordFormShown();
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(calls.map(c => pathOf(c.url)).filter(path => !PASSWORD_RESET_ALLOWED_PATHS.has(path))).toEqual([]);
    expect(document.querySelector('aside')).toBeNull();
    expect(screen.getByText('کلمه عبور شما موقت است')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'خروج' }));
    await waitFor(() => expect(calls.some(c => c.url === '/api/auth/logout' && c.method === 'POST')).toBe(true));
  });

  it('after the password change the application opens', async () => {
    await changePasswordAndOpenApp();
  });

  it('after the password change the application opens even when it takes longer than a second (TD-1189)', async () => {
    await changePasswordAndOpenApp(1500);
  }, 20_000);

  it('a PASSWORD_RESET_REQUIRED answer from the server switches the session to the password form', async () => {
    meUser = { id: 5, username: 'ali', full_name: 'علی رضایی', role: 'accountant' };
    stubServer();
    let auth: ReturnType<typeof useAuth> | null = null;
    function Grab() { auth = useAuth(); return null; }
    render(<QueryClientProvider client={appQueryClient}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
    await waitFor(() => expect(auth!.user?.username).toBe('ali'));
    expect(mustChangePassword(auth!.user)).toBe(false);
    await act(async () => { await fetchJson('/documents').catch(() => undefined); });
    expect(mustChangePassword(auth!.user)).toBe(true);
  });
});
