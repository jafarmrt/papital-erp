import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { User } from '../types';
import { ApiError, fetchJson, setAuthToken, setCsrfToken } from '../api';
import { queryClient } from '../lib/queryClient';
import { userHoldsPermission } from '../lib/permissions/userHoldsPermission';
import { isSystemAdminViewer, type ViewerAccess } from '../lib/permissions/pageAccess';

export interface UserPermissions {
  permissions: string[];
  isAdmin: boolean;
  roleName?: string;
}

/** OBS-R1-33: what the user is told when the session ends or cannot be read (shown by `App` and the login page) */
export const SESSION_EXPIRED_MESSAGE = 'نشست شما پایان یافته است؛ دوباره وارد شوید.';
export const LOGOUT_NOT_CONFIRMED_MESSAGE = 'خروج در کارساز تأیید نشد؛ برای اطمینان پنجره مرورگر را ببندید.';
export const SESSION_CHECK_FAILED_MESSAGE = 'نشست شما بررسی نشد، چون اتصال یا کارساز در دسترس نیست. دوباره تلاش کنید.';
export const PERMISSIONS_LOAD_FAILED_MESSAGE = 'مجوزهای کاربر خوانده نشد؛ برخی بخش‌ها نشان داده نمی‌شوند. دوباره تلاش کنید.';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  userPermissions: UserPermissions;
  permissionsLoaded: boolean;
  isProfileModalOpen: boolean;
  setIsProfileModalOpen: (open: boolean) => void;
  /** the login and setup pages call it with the user and token the server answered */
  login: (user: User, token?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** OBS-R1-33: why the permissions could not be read (null when they were) */
  permissionsError: string | null;
  sessionCheckError: string | null;
  /** OBS-R1-33: a notice for the login page: the session expired or the logout was not confirmed */
  sessionNotice: string | null;
  updateUser: (updatedUser: User) => void;
  refreshUser: () => Promise<void>;
  loadUserPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [userPermissions, setUserPermissions] = useState<UserPermissions>({
    permissions: [],
    isAdmin: false
  });
  const [permissionsLoaded, setPermissionsLoaded] = useState<boolean>(false);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  /** OBS-R1-33: everything of the previous session leaves the browser (cache, user, permissions, open windows) */
  const resetSessionState = useCallback(() => {
    setCsrfToken(null);
    setAuthToken(null);
    // v9.0.74 (TD-518): داده کاربر قبلی در کش نمی‌ماند تا کاربر بعدی همین مرورگر آن را بی درخواست به سرور نبیند
    queryClient.clear();
    setUser(null);
    setUserPermissions({ permissions: [], isAdmin: false });
    setPermissionsLoaded(false);
    setPermissionsError(null);
    setSessionCheckError(null);
    setIsProfileModalOpen(false);
  }, []);

  const loadUserPermissions = useCallback(async (signal?: AbortSignal) => {
    setPermissionsError(null);
    try {
      const res = await fetchJson<{ permissions: string[]; isAdmin: boolean; roleName?: string }>('/users/my-permissions', { signal });
      if (res && res.permissions) {
        setUserPermissions({
          permissions: res.permissions,
          isAdmin: !!res.isAdmin,
          roleName: res.roleName
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load user permissions:', err);
      // OBS-R1-33: a failure is shown, never read as «no permissions»
      setPermissionsError(PERMISSIONS_LOAD_FAILED_MESSAGE);
    } finally {
      setPermissionsLoaded(true);
    }
  }, []);

  const logout = useCallback(async () => {
    let notice: string | null = null;
    try {
      await fetchJson('/auth/logout', { method: 'POST' });
    } catch (err) {
      // OBS-R1-33: the local session is cleared anyway; the user is told the server did not confirm it (a 401 means
      // the server session had already ended)
      if (!(err instanceof ApiError && err.status === 401)) notice = LOGOUT_NOT_CONFIRMED_MESSAGE;
    } finally {
      resetSessionState();
      setSessionNotice(notice);
    }
  }, [resetSessionState]);

  const refreshUser = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchJson<{ authenticated?: boolean; user?: User; token?: string }>('/auth/me', { signal });
      // the error page stays up while a retry runs and goes only with the answer
      setSessionCheckError(null);
      if (res?.authenticated && res?.user) {
        setUser(res.user);
        if (res.token) setAuthToken(res.token);
        await loadUserPermissions(signal);
      } else {
        await logout();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // OBS-R1-33: only a 401 ends the session; a network or server error (common on a workshop phone) keeps the token
      // and cache and shows «تلاش دوباره» instead of the login page
      if (err?.status === 401) resetSessionState();
      else setSessionCheckError(SESSION_CHECK_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [loadUserPermissions, logout, resetSessionState]);

  // OBS-R1-33: the login and setup pages post the credentials themselves; the old credentials branch here was never used
  const login = useCallback(async (loggedInUser: User, token?: string): Promise<void> => {
    if (token) setAuthToken(token);
    setSessionNotice(null);
    setUser(loggedInUser);
    await loadUserPermissions();
  }, [loadUserPermissions]);

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  useEffect(() => {
    // OBS-R1-33: a 401 during a session resets everything and tells the user why they are on the login page
    const handleUnauthorized = () => {
      const hadSession = userRef.current !== null;
      resetSessionState();
      if (hadSession) setSessionNotice(SESSION_EXPIRED_MESSAGE);
    };
    // v9.0.219 (TD-523): سرور رمز را موقت دانست؛ `App` به جای برنامه فقط برگه تغییر رمز را نشان می‌دهد
    const handlePasswordResetRequired = () => {
      setUser(current => (current ? { ...current, mustResetPassword: true, must_reset_password: true } : current));
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:password-reset-required', handlePasswordResetRequired);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('auth:password-reset-required', handlePasswordResetRequired);
    };
  }, [resetSessionState]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshUser(controller.signal);
    return () => controller.abort();
  }, [refreshUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        userPermissions,
        permissionsLoaded,
        permissionsError,
        sessionCheckError,
        sessionNotice,
        isProfileModalOpen,
        setIsProfileModalOpen,
        login,
        logout,
        updateUser,
        refreshUser,
        loadUserPermissions
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * v8.0.118 (TD-409): آیا کاربر جاری مجوز داده‌شده را دارد (مدیر همیشه)؛ بیرون از AuthProvider (مثلاً آزمون مؤلفه) false.
 * فقط برای نمایش است؛ سرور همان مجوز را خودش می‌سنجد.
 */
export function useHasPermission(permission: string): boolean {
  const ctx = useContext(AuthContext);
  return userHoldsPermission(ctx?.userPermissions, permission);
}

/**
 * v9.0.340 (TD-795): آیا کاربر جاری یکی از این مجوزها را دارد (گارد «یکی کافی است» سرور، مانند ویجت گردش کار)؛ همان
 * قاعده `useHasPermission` و بیرون از AuthProvider false.
 */
export function useHasAnyPermission(permissions: readonly string[]): boolean {
  const ctx = useContext(AuthContext);
  return permissions.some(permission => userHoldsPermission(ctx?.userPermissions, permission));
}

/**
 * v9.0.228 (TD-567، B03-25): آیا کاربر جاری مدیر سیستم است (همان گارد `requireSystemAdmin`)؛ بیرون از AuthProvider false.
 * فقط برای نمایش دکمه‌های نگهداری سیستم است؛ سرور خودش می‌سنجد.
 */
export function useIsSystemAdmin(): boolean {
  const ctx = useContext(AuthContext);
  if (!ctx) return false;
  return isSystemAdminViewer({ isAdmin: ctx.userPermissions.isAdmin, role: ctx.user?.role });
}

/** TD-1157: the current user's access for `canOpenPage`; outside AuthProvider null (opens nothing but public pages) */
export function useViewerAccess(): ViewerAccess | null {
  const ctx = useContext(AuthContext);
  if (!ctx) return null;
  return { permissions: ctx.userPermissions.permissions, isAdmin: ctx.userPermissions.isAdmin, role: ctx.user?.role };
}

/** TD-1231: the current user's id and admin flag for maker-checker hints; outside AuthProvider or before login null */
export function useViewerIdentity(): { id: number; isAdmin: boolean } | null {
  const ctx = useContext(AuthContext);
  const id = Number(ctx?.user?.id);
  if (!ctx || !Number.isInteger(id) || id <= 0) return null;
  return { id, isAdmin: isSystemAdminViewer({ isAdmin: ctx.userPermissions.isAdmin, role: ctx.user?.role }) };
}
