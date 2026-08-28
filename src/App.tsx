import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { PageLoader } from './components/PageLoader';
import { AppLayout } from './components/layout';
import { AppRoutes } from './components/AppRoutes';

const LoginPage = lazy(() => import('./pages/LoginPage'));

export default function App() {
  const {
    user,
    loading,
    userPermissions,
    permissionsLoaded,
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

  if (!user) {
    return (
      <Suspense fallback={<PageLoader message="در حال آماده‌سازی سامانه..." />}>
        <LoginPage onLogin={login} />
      </Suspense>
    );
  }

  return (
    <Router>
      <Toaster position="bottom-right" toastOptions={{ className: 'font-sans text-sm', duration: 4000 }} />
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

