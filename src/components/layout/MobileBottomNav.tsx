import { ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckSquare, ClipboardList, LayoutDashboard, Menu, Wallet } from 'lucide-react';
import { User } from '../../types';
import { isMobileNavItemActive, MOBILE_MENU_LABEL, visibleMobileNavItems } from './mobileNavItems';

const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  '/': LayoutDashboard,
  '/approval-inbox': CheckSquare,
  '/audit': ClipboardList,
  '/piecework': Wallet,
};

export interface MobileBottomNavProps {
  user: User;
  userPermissions: { permissions: string[]; isAdmin: boolean };
  onOpenMenu: () => void;
}

/** v10.0.17 (D-11): نوار پایین گوشی؛ در پهنای ۷۶۸ پیکسل و بیشتر پنهان است */
export function MobileBottomNav({ user, userPermissions, onOpenMenu }: MobileBottomNavProps) {
  const { pathname } = useLocation();
  const items = visibleMobileNavItems({ permissions: userPermissions.permissions, isAdmin: userPermissions.isAdmin, role: user.role });
  const cell = 'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-bold min-w-0';

  return (
    <nav
      aria-label="نوار پایین"
      dir="rtl"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      {items.map(item => {
        const Icon = ICONS[item.path] ?? LayoutDashboard;
        const active = isMobileNavItemActive(item.path, pathname);
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? 'page' : undefined}
            className={`${cell} ${active ? 'text-blue-700' : 'text-slate-500'}`}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="truncate max-w-full">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMenu} className={`${cell} text-slate-500 cursor-pointer`}>
        <Menu size={20} aria-hidden="true" />
        <span>{MOBILE_MENU_LABEL}</span>
      </button>
    </nav>
  );
}

export default MobileBottomNav;
