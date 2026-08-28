import { Menu } from 'lucide-react';
import { User } from '../../types';
import GlobalHeaderSearch from '../GlobalHeaderSearch';
import NotificationBell from '../NotificationBell';

export interface TopBarProps {
  user: User;
  userPermissions: { permissions: string[]; isAdmin: boolean; roleName?: string };
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  onOpenProfile: () => void;
}

export function TopBar({
  user,
  userPermissions,
  onToggleSidebar,
  isSidebarCollapsed,
  onOpenProfile
}: TopBarProps) {
  const roleTitle = userPermissions.roleName || (
    user.role === 'admin' 
      ? 'مدیر ارشد سیستم' 
      : user.role === 'manager' 
        ? 'سرپرست انبار' 
        : 'کاربر تماشاگر'
  );

  return (
    <header className="h-16 bg-white border-b flex items-center justify-between px-3 sm:px-4 lg:px-6 shrink-0 print:hidden z-30">
      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
          title={isSidebarCollapsed ? "باز کردن منوی کناری" : "جمع کردن منوی کناری"}
        >
          <Menu size={20} />
        </button>
        <GlobalHeaderSearch />
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <NotificationBell />
        <button
          onClick={onOpenProfile}
          className="flex items-center gap-2 sm:gap-3 p-1.5 pl-2 sm:pl-3 rounded-2xl hover:bg-slate-100 transition-all border border-transparent hover:border-slate-200 group text-right cursor-pointer"
          title="مشاهده و تغییر پروفایل شخصی"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-900 border-2 border-amber-400 text-amber-400 font-black flex items-center justify-center shadow-sm overflow-hidden shrink-0 group-hover:scale-105 transition-transform">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.full_name || user.username} className="w-full h-full object-cover" />
            ) : (
              <span>{(user.full_name || user.username || '?').charAt(0)}</span>
            )}
          </div>
          <div className="text-right hidden md:block">
            <p className="text-[11px] text-slate-400 font-semibold">{roleTitle}</p>
            <p className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
              {user.full_name || user.username}
            </p>
          </div>
        </button>
      </div>
    </header>
  );
}

export default TopBar;
