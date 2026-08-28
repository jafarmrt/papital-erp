import { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { User } from '../../types';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import UserProfileModal from '../UserProfileModal';

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
        />
        <div className="p-3 sm:p-4 lg:p-6 print:p-0 overflow-auto flex-1 print:overflow-visible">
          {children || <Outlet />}
        </div>
      </main>
    </div>
  );
}

export default AppLayout;
