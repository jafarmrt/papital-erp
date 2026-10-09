import { ReactNode, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { User } from '../../types';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import UserProfileModal from '../UserProfileModal';
import { MobileBottomNav } from './MobileBottomNav';

/** v10.0.17 (D-11): زیر این پهنا (Tailwind md) گوشی است: فهرست کناری روی صفحه باز می‌شود و نوار پایین جای آن را می‌گیرد */
export const PHONE_MAX_WIDTH = 767;
const isPhoneWidth = () => typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX_WIDTH;

export interface AppLayoutProps {
  user: User;
  userPermissions: { permissions: string[]; isAdmin: boolean; roleName?: string };
  onLogout: () => void;
  onUserUpdate: (u: User) => void;
  isProfileModalOpen: boolean;
  setIsProfileModalOpen: (open: boolean) => void;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  children?: ReactNode;
}

export function AppLayout({
  user,
  userPermissions,
  onLogout,
  onUserUpdate,
  isProfileModalOpen,
  setIsProfileModalOpen,
  isSidebarCollapsed,
  toggleSidebar,
  children
}: AppLayoutProps) {
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);
  // on a phone the open menu covers the page, so moving to another page closes it
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (isPhoneWidth() && !isSidebarCollapsed) toggleSidebar();
  }, [pathname, isSidebarCollapsed, toggleSidebar]);

  return (
    <div className="flex bg-slate-50 min-h-screen text-slate-800 font-sans overflow-hidden" dir="rtl">
      <Sidebar
        user={user}
        userPermissions={userPermissions}
        onLogout={onLogout}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      {!isSidebarCollapsed && (
        <div
          aria-hidden="true"
          data-testid="phone-menu-backdrop"
          onClick={toggleSidebar}
          className="md:hidden fixed inset-0 z-40 bg-slate-900/50 print:hidden"
        />
      )}
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar
          user={user}
          userPermissions={userPermissions}
          onToggleSidebar={toggleSidebar}
          isSidebarCollapsed={isSidebarCollapsed}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />
        <UserProfileModal
          user={user}
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
          onUserUpdate={onUserUpdate}
          roleName={userPermissions.roleName}
        />
        <div className="p-3 pb-24 sm:p-4 sm:pb-24 md:pb-4 lg:p-6 print:p-0 overflow-auto flex-1 print:overflow-visible">
          {children || <Outlet />}
        </div>
      </main>
      <MobileBottomNav user={user} userPermissions={userPermissions} onOpenMenu={toggleSidebar} />
    </div>
  );
}

export default AppLayout;
