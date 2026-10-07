import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types';
import { fetchJson, setAuthToken, setCsrfToken } from '../api';
import { queryClient } from '../lib/queryClient';
import { userHoldsPermission } from '../lib/permissions/userHoldsPermission';
import { isSystemAdminViewer } from '../lib/permissions/pageAccess';

export interface UserPermissions {
  permissions: string[];
  isAdmin: boolean;
  roleName?: string;
}

export interface LoginCredentials {
  username: string;
  password?: string;
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  userPermissions: UserPermissions;
  permissionsLoaded: boolean;
  isProfileModalOpen: boolean;
  setIsProfileModalOpen: (open: boolean) => void;
  login: (userOrCredentials: User | LoginCredentials, token?: string) => Promise<any>;
  logout: () => Promise<void>;
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

  const loadUserPermissions = useCallback(async (signal?: AbortSignal) => {
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
    } finally {
      setPermissionsLoaded(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchJson('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      setCsrfToken(null);
      setAuthToken(null);
      // v9.0.74 (TD-518): داده کاربر قبلی در کش نمی‌ماند تا کاربر بعدی همین مرورگر آن را بی درخواست به سرور نبیند
      queryClient.clear();
      setUser(null);
      setUserPermissions({ permissions: [], isAdmin: false });
      setPermissionsLoaded(false);
    }
  }, []);

  const refreshUser = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchJson<{ authenticated?: boolean; user?: User; token?: string }>('/auth/me', { signal });
      if (res?.authenticated && res?.user) {
        setUser(res.user);
        if (res.token) setAuthToken(res.token);
        await loadUserPermissions(signal);
      } else {
        await logout();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setUser(null);
      setUserPermissions({ permissions: [], isAdmin: false });
    } finally {
      setLoading(false);
    }
  }, [loadUserPermissions, logout]);

  const login = useCallback(async (userOrCredentials: User | LoginCredentials, token?: string): Promise<any> => {
    if ('username' in userOrCredentials && ('password' in userOrCredentials || !('role' in userOrCredentials))) {
      const res = await fetchJson('/login', {
        method: 'POST',
        body: JSON.stringify(userOrCredentials)
      });
      if (res?.success && res?.user) {
        if (res.token) setAuthToken(res.token);
        setUser(res.user);
        await loadUserPermissions();
      }
      return res;
    } else {
      const u = userOrCredentials as User;
      if (token) setAuthToken(token);
      setUser(u);
      await loadUserPermissions();
      return { success: true, user: u };
    }
  }, [loadUserPermissions]);

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      queryClient.clear();
      setUser(null);
      setUserPermissions({ permissions: [], isAdmin: false });
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
  }, []);

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
 * v9.0.291 (TD-795): آیا کاربر جاری یکی از این مجوزها را دارد (گارد «یکی کافی است» سرور، مانند ویجت گردش کار)؛ همان
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
