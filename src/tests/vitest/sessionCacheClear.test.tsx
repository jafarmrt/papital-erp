/**
 * v9.0.68 (TD-518, B02-03): ending a session clears the React Query cache. Before, logout and a 401 only emptied the
 * user and permissions, so the next user of the same browser saw the previous user's data (for example the user
 * directory) for up to five minutes without any request to the server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { queryClient as appQueryClient } from '../../lib/queryClient';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { useUsersQuery } from '../../hooks/queries/useUserQueries';
import { setAuthToken, setCsrfToken } from '../../api';

type Call = { url: string; method: string };
let calls: Call[] = [];
let meUser: unknown = null;

function stubServer() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: (init?.method || 'GET').toUpperCase() });
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/auth/me') return reply(200, { authenticated: true, user: meUser, csrfToken: 'c1' });
    if (url === '/api/users/my-permissions') return reply(200, { permissions: [], isAdmin: false });
    if (url === '/api/auth/logout') return reply(200, { success: true });
    if (url === '/api/users') return reply(200, [{ id: 99, username: 'fresh', full_name: 'from-server', role: 'viewer' }]);
    if (url === '/api/expired') return reply(401, { error: 'unauthorized' });
    return reply(404, { error: 'not stubbed' });
  }));
}

const adminDirectory = [
  { id: 1, username: 'admin', full_name: 'مدیر', role: 'admin' },
  { id: 7, username: 'secret', full_name: 'حساب محرمانه', role: 'admin' },
];

async function signedInAsAdmin() {
  meUser = { id: 1, username: 'admin', full_name: 'مدیر', role: 'admin' };
  stubServer();
  let auth: ReturnType<typeof useAuth> | null = null;
  function Grab() { auth = useAuth(); return null; }
  render(<QueryClientProvider client={appQueryClient}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
  await waitFor(() => expect(auth!.user?.username).toBe('admin'));
  appQueryClient.setQueryData(QUERY_KEYS.users.list(), adminDirectory);
  return () => auth!;
}

function UsersConsumer() {
  const q = useUsersQuery();
  return <div data-testid="names">{(q.data as Array<{ username: string }> | undefined)?.map(u => u.username).join(',')}</div>;
}

afterEach(() => {
  cleanup();
  appQueryClient.clear();
  setCsrfToken(null);
  setAuthToken(null);
  vi.unstubAllGlobals();
});

describe('TD-518 session end clears the query cache', () => {
  it('logout empties the cache, so the next user of the browser gets the directory from the server', async () => {
    const auth = await signedInAsAdmin();
    await act(async () => { await auth().logout(); });
    expect(appQueryClient.getQueryData(QUERY_KEYS.users.list())).toBeUndefined();

    meUser = { id: 3, username: 'clerk', full_name: 'کارمند', role: 'viewer' };
    await act(async () => { await auth().login({ id: 3, username: 'clerk', full_name: 'کارمند', role: 'viewer' }); });
    const before = calls.filter(c => c.url === '/api/users').length;
    cleanup();
    render(<QueryClientProvider client={appQueryClient}><UsersConsumer /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('fresh'));
    expect(calls.filter(c => c.url === '/api/users').length - before).toBe(1);
  });

  it('a 401 from the server (session expired or revoked) empties the cache too', async () => {
    await signedInAsAdmin();
    setCsrfToken('c1');
    const { fetchJson } = await import('../../api');
    await act(async () => { await fetchJson('/expired').catch(() => undefined); });
    await waitFor(() => expect(appQueryClient.getQueryData(QUERY_KEYS.users.list())).toBeUndefined());
  });
});
