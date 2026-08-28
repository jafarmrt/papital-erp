import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types';
import { fetchJson, setAuthToken, setCsrfToken } from '../api';

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
        if (res.user.mustResetPassword || (res.user as any).must_reset_password) {
          setIsProfileModalOpen(true);
        }
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
        if (res.user.mustResetPassword || res.user.must_reset_password) {
          setIsProfileModalOpen(true);
        }
      }
      return res;
    } else {
      const u = userOrCredentials as User;
      if (token) setAuthToken(token);
      setUser(u);
      await loadUserPermissions();
      if (u.mustResetPassword || (u as any).must_reset_password) {
        setIsProfileModalOpen(true);
      }
      return { success: true, user: u };
    }
  }, [loadUserPermissions]);

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setUserPermissions({ permissions: [], isAdmin: false });
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshUser(controller.signal);
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
