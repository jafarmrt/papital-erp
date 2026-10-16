/**
 * Closing sweep, app shell (part 2): unsaved settings, the session in AuthContext, the system operations tab and the
 * users and audit log queries. Each test is red on v10.1.53.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { settingsKeys } from '../../lib/queryKeys';
import {
  AuthProvider, LOGOUT_NOT_CONFIRMED_MESSAGE, PERMISSIONS_LOAD_FAILED_MESSAGE, SESSION_CHECK_FAILED_MESSAGE, SESSION_EXPIRED_MESSAGE, useAuth,
} from '../../contexts/AuthContext';
import { INTEGRITY_UNKNOWN, SystemOperationsTab } from '../../components/settings/SystemOperationsTab';
import { usePermissionCatalogQuery, useRolesQuery, useUsersQuery } from '../../hooks/queries/useUserQueries';
import {
  useActivityLogFilterOptionsQuery, useActivityLogsQuery, useAuditLogIntegrityQuery,
} from '../../hooks/queries/useActivityLogQueries';
import { UserFormModal } from '../../components/users/UserFormModal';

const api = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve([]));
const tokenSet = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => api(...args),
  setAuthToken: (...args: unknown[]) => tokenSet(...args),
  setCsrfToken: () => undefined,
  ApiError: class ApiError extends Error { status = 500; },
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast, default: toast, Toaster: () => null };
});

afterEach(cleanup);

function clientWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('OBS-R2-94 a settings refetch keeps unsaved fields', () => {
  it('obs_r2_94_unsaved_settings: an edited field keeps its value, an untouched one follows the server', async () => {
    api.mockImplementation((url: unknown) => Promise.resolve(String(url) === '/settings'
      ? [{ key: 'company_name', value: 'Papital' }, { key: 'company_phone', value: '021' }]
      : []));
    const { client, wrapper } = clientWrapper();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.companyName).toBe('Papital'));

    act(() => { result.current.setCompanyName('Papital (draft)'); });
    act(() => {
      client.setQueryData(settingsKeys.all, [{ key: 'company_name', value: 'Other admin' }, { key: 'company_phone', value: '0912' }]);
    });
    await waitFor(() => expect(result.current.companyPhone).toBe('0912'));
    expect(result.current.companyName).toBe('Papital (draft)');
  });
});

const ADMIN = { id: 1, username: 'admin', full_name: 'admin', role: 'admin' };

async function signedIn(permissions: () => Promise<unknown>) {
  api.mockImplementation((url: unknown, init?: unknown) => {
    const path = String(url);
    if (path === '/auth/me') return Promise.resolve({ authenticated: true, user: ADMIN });
    if (path === '/users/my-permissions') return permissions();
    if (path === '/auth/logout' && (init as { method?: string } | undefined)?.method === 'POST') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve([]);
  });
  let auth: ReturnType<typeof useAuth> | null = null;
  function Grab() { auth = useAuth(); return null; }
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
  await waitFor(() => expect(auth!.permissionsLoaded).toBe(true));
  return () => auth!;
}

describe('OBS-R1-33 session errors in AuthContext', () => {
  it('obs_r1_33_session_errors: a permissions failure is shown, a 401 resets with a notice, a failed logout still clears', async () => {
    const auth = await signedIn(() => Promise.reject(new Error('server down')));
    expect(auth().permissionsError).toBe(PERMISSIONS_LOAD_FAILED_MESSAGE);

    act(() => { window.dispatchEvent(new CustomEvent('auth:unauthorized')); });
    await waitFor(() => expect(auth().user).toBeNull());
    expect(auth().permissionsLoaded).toBe(false);
    expect(auth().sessionNotice).toBe(SESSION_EXPIRED_MESSAGE);

    await act(async () => { await auth().login(ADMIN, 'token'); });
    expect(auth().user?.username).toBe('admin');
    expect(auth().sessionNotice).toBeNull();
    await act(async () => { await auth().logout(); });
    expect(auth().user).toBeNull();
    expect(auth().sessionNotice).toBe(LOGOUT_NOT_CONFIRMED_MESSAGE);
  });
});

describe('OBS-R1-33 session check at start', () => {
  async function startWith(me: () => Promise<unknown>) {
    tokenSet.mockClear();
    api.mockImplementation((url: unknown) => {
      const path = String(url);
      if (path === '/auth/me') return me();
      if (path === '/users/my-permissions') return Promise.resolve({ permissions: [], isAdmin: true });
      return Promise.resolve([]);
    });
    let auth: ReturnType<typeof useAuth> | null = null;
    function Grab() { auth = useAuth(); return null; }
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
    await waitFor(() => expect(auth!.loading).toBe(false));
    return () => auth!;
  }

  it('obs_r1_33_network_error_keeps_session: a network or server error keeps the token and asks to retry; a retry signs in', async () => {
    let fail = true;
    const auth = await startWith(() => (fail ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ authenticated: true, user: ADMIN })));
    expect(auth().sessionCheckError).toBe(SESSION_CHECK_FAILED_MESSAGE);
    expect(tokenSet).not.toHaveBeenCalledWith(null);
    fail = false;
    await act(async () => { await auth().refreshUser(); });
    expect(auth().user?.username).toBe('admin');
    expect(auth().sessionCheckError).toBeNull();
  });

  it('obs_r1_33_unauthorized_resets: a 401 at start clears the session and shows no retry page', async () => {
    const auth = await startWith(() => Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 })));
    expect(auth().sessionCheckError).toBeNull();
    expect(auth().user).toBeNull();
    expect(tokenSet).toHaveBeenCalledWith(null);
  });
});

describe('OBS-R1-36 system operations tab', () => {
  it('obs_r1_36_integrity_error_and_purge_mutation: a failed check shows «unknown», the purge is a mutation', async () => {
    api.mockImplementation((url: unknown) => {
      const path = String(url);
      if (path === '/activity-logs/integrity') return Promise.reject(new Error('integrity read failed'));
      if (path === '/activity-logs/purge') return Promise.resolve({ success: true, message: 'ok' });
      return Promise.resolve({});
    });
    const { client, wrapper } = clientWrapper();
    render(<SystemOperationsTab onOpenClearModal={() => undefined} />, { wrapper });
    await waitFor(() => expect(screen.getAllByText(INTEGRITY_UNKNOWN).length).toBeGreaterThan(0));
    expect(screen.getByText(/integrity read failed/)).toBeTruthy();

    const purgeButtons = screen.getAllByRole('button').filter(b => b.querySelector('svg.lucide-trash2, svg.lucide-trash-2'));
    fireEvent.click(purgeButtons[0]);
    const dialog = await screen.findByRole('dialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).pop() as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(api.mock.calls.some(call => call[0] === '/activity-logs/purge')).toBe(true));
    expect(client.getMutationCache().getAll()).toHaveLength(1);
  });
});

function Readers() {
  useUsersQuery();
  useRolesQuery();
  usePermissionCatalogQuery();
  useActivityLogsQuery({ page: 1 });
  useActivityLogFilterOptionsQuery();
  useAuditLogIntegrityQuery();
  return null;
}

describe('OBS-R1-38 users and audit log queries and writes', () => {
  it('obs_r1_38_signal_and_mutations: every read passes an abort signal and a user save is a mutation', async () => {
    api.mockImplementation(() => Promise.resolve([]));
    const { client, wrapper } = clientWrapper();
    render(<Readers />, { wrapper });
    const reads = ['/users', '/roles', '/permissions', '/activity-logs/filters', '/activity-logs/integrity'];
    await waitFor(() => expect(reads.every(path => api.mock.calls.some(call => call[0] === path))).toBe(true));
    await waitFor(() => expect(api.mock.calls.some(call => String(call[0]).startsWith('/activity-logs?'))).toBe(true));
    for (const call of api.mock.calls) {
      expect((call[1] as { signal?: unknown } | undefined)?.signal).toBeInstanceOf(AbortSignal);
    }
    cleanup();

    api.mockClear();
    const onSuccess = vi.fn();
    const { container } = render(
      <UserFormModal isOpen onClose={() => undefined} onSuccess={onSuccess} rolesList={[]}
        editingUser={{ id: 5, username: 'u5', full_name: 'user five', role: 'admin' } as never} />,
      { wrapper },
    );
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.mock.calls.some(call => call[0] === '/users/5' && (call[1] as { method?: string }).method === 'PUT')).toBe(true);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
  });
});
