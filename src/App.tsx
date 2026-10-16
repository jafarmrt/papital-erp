import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { PageLoader } from './components/PageLoader';
import { AppLayout } from './components/layout';
import { AppRoutes } from './components/AppRoutes';
import { ForcedPasswordChange } from './components/auth/ForcedPasswordChange';
import { mustChangePassword } from './lib/auth/passwordReset';
import { SearchRouteReset } from './SearchContext';
import { PermissionsLoadError } from './components/auth/PermissionsLoadError';
import { SessionCheckError } from './components/auth/SessionCheckError';

const LoginPage = lazy(() => import('./pages/LoginPage'));

export default function App() {
  const {
    user,
    loading,
    userPermissions,
    permissionsLoaded,
    permissionsError,
    sessionCheckError,
    refreshUser,
    sessionNotice,
    loadUserPermissions,
    login,
    logout,
    updateUser,
    isProfileModalOpen,
    setIsProfileModalOpen
  } = useAuth();

  // V9 Phase 4.2 (Minimal Responsive): در عرض‌های کمتر از لپ‌تاپ (<1024px)
  // سایدبار به‌صورت پیش‌فرض جمع می‌شود تا محتوا فشرده نشود؛ دکمه باز/بسته همچنان فعال است.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar_collapsed') === 'true';
      return saved || window.innerWidth < 1024;
    }
    return false;
  });

  useEffect(() => {
    const handleViewportChange = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarCollapsed(true);
      }
    };
    handleViewportChange();
    window.addEventListener('resize', handleViewportChange);
    return () => window.removeEventListener('resize', handleViewportChange);
  }, []);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebar_collapsed', String(next));
      }
      return next;
    });
  };

  if (loading) {
    return <PageLoader message="در حال آماده‌سازی و بررسی نشست کاربری..." />;
  }

  // OBS-R1-33: the session could not be checked (network or server error): retry, never the login page
  if (!user && sessionCheckError) {
    return <SessionCheckError message={sessionCheckError} onRetry={refreshUser} />;
  }

  if (!user) {
    return (
      <Suspense fallback={<PageLoader message="در حال آماده‌سازی سامانه..." />}>
        <LoginPage onLogin={login} notice={sessionNotice} />
      </Suspense>
    );
  }

  const toaster = (
    <Toaster 
      position="bottom-right" 
      toastOptions={{ 
        className: 'font-sans text-xs font-medium rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100', 
        duration: 4000,
        style: {
          direction: 'rtl',
          textAlign: 'right',
        },
        success: {
          iconTheme: {
            primary: '#10b981',
            secondary: '#ffffff',
          },
        },
        error: {
          iconTheme: {
            primary: '#ef4444',
            secondary: '#ffffff',
          },
        }
      }} 
    />
  );

  // v9.0.219 (TD-523، ت۵ الف): با رمز موقت مدیر فقط برگه تغییر رمز، بی منو و صفحه
  if (mustChangePassword(user)) {
    return (
      <>
        {toaster}
        <ForcedPasswordChange
          user={user}
          onLogout={logout}
          onUserUpdate={updateUser}
          roleName={userPermissions.roleName}
        />
      </>
    );
  }

  return (
    <Router>
      {/* OBS-R2-91: before the pages, so a page's own filter from the address survives the route change */}
      <SearchRouteReset />
      {toaster}
      {permissionsError && (
        <PermissionsLoadError message={permissionsError} onRetry={() => void loadUserPermissions()} />
      )}
      <AppLayout
        user={user}
        userPermissions={userPermissions}
        onLogout={logout}
        onUserUpdate={updateUser}
        isProfileModalOpen={isProfileModalOpen}
        setIsProfileModalOpen={setIsProfileModalOpen}
        isSidebarCollapsed={isSidebarCollapsed}
        toggleSidebar={toggleSidebar}
      >
        <AppRoutes
          user={user}
          userPermissions={userPermissions}
          permissionsLoaded={permissionsLoaded}
        />
      </AppLayout>
    </Router>
  );
}

