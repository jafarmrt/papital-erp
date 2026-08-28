import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelRightClose, PanelRightOpen, ChevronDown, Settings, LogOut, Compass } from 'lucide-react';
import { cn } from '../../utils';
import { fetchJson } from '../../api';
import { User } from '../../types';
import { getMenuGroups, MenuVisibilityMap } from './menuConfig';
import { useMenuVisibilityQuery } from '../../hooks/queries/useSettingsQueries';
import { useAppFavicon } from '../../hooks/useAppFavicon';

export interface SidebarProps {
  user: User;
  userPermissions: { permissions: string[]; isAdmin: boolean; roleName?: string };
  onLogout: () => void;
  onOpenProfile: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  user,
  userPermissions,
  onLogout,
  onOpenProfile,
  isCollapsed,
  onToggleCollapse
}: SidebarProps) {
  const location = useLocation();
  const [companyLogo, setCompanyLogo] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('سامانه جامع ERP پاپیتال');

  useEffect(() => {
    fetchJson('/public-settings')
      .then((data: { companyName?: string; companyLogo?: string }) => {
        if (data) {
          if (data.companyLogo) setCompanyLogo(data.companyLogo);
          if (data.companyName) setCompanyName(data.companyName);
        }
      })
      .catch(err => console.error('Error fetching settings for sidebar logo:', err));
  }, []);

  // فاوآیکون برنامه = همان لوگوی شرکت (پیش‌فرض: نشان داخلی)
  useAppFavicon(companyLogo);

  // V10-5.3: نقشه دید منو per-role — از endpoint اختصاصی
  const { data: menuVisibilityData } = useMenuVisibilityQuery();
  const menuVisibilityMap = useMemo<MenuVisibilityMap | null>(() => {
    return menuVisibilityData && typeof menuVisibilityData === 'object' ? menuVisibilityData : null;
  }, [menuVisibilityData]);

  const menuGroups = useMemo(() => {
    return getMenuGroups(user, userPermissions, menuVisibilityMap);
  }, [user, userPermissions, menuVisibilityMap]);

  // Open/Close state per group with localStorage persistence
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('erp_sidebar_open_groups');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error loading sidebar open groups state:', e);
    }
    return {
      main: true,
      inventory: true,
      crm: true,
      warehouse: true,
      production: true,
      reports: true,
      accounting: true,
      hr: true,
      system: true,
    };
  });

  // Ensure the active route's group is expanded automatically upon route change
  useEffect(() => {
    const activeGroup = menuGroups.find(g =>
      g.items.some(item => item.visible && (
        location.pathname === item.path ||
        (item.path === '/accounting/dashboard' && location.pathname.startsWith('/accounting'))
      ))
    );
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups(prev => {
        const updated = { ...prev, [activeGroup.id]: true };
        try {
          localStorage.setItem('erp_sidebar_open_groups', JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to persist sidebar open groups state to localStorage:', e);
        }
        return updated;
      });
    }
  }, [location.pathname, menuGroups]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const updated = { ...prev, [groupId]: !prev[groupId] };
      try {
        localStorage.setItem('erp_sidebar_open_groups', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to persist toggled sidebar group state to localStorage:', e);
      }
      return updated;
    });
  };

  return (
    <aside className={cn(
      "bg-slate-900 text-slate-300 flex flex-col shrink-0 h-screen print:hidden transition-all duration-300 ease-in-out z-30 select-none",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header with Logo and Collapse button */}
      <div className={cn("border-b border-slate-800 flex items-center transition-all", isCollapsed ? "p-3 justify-center" : "p-4 justify-between")}>
        {!isCollapsed ? (
          <div className="flex items-center gap-2.5 text-white min-w-0">
            {companyLogo ? (
              <div className="w-9 h-9 bg-white rounded-xl p-1 shrink-0 flex items-center justify-center shadow-md border border-slate-700 overflow-hidden">
                <img src={companyLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-base shrink-0 shadow-md">
                P
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <h1 className="text-xs font-bold tracking-tight text-white truncate" title={companyName || 'سامانه جامع ERP پاپیتال'}>
                {companyName || 'سامانه جامع ERP پاپیتال'}
              </h1>
              <span className="text-[9px] text-slate-400">سامانه یکپارچه مدیریت کارگاه و ERP</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center">
            {companyLogo ? (
              <div className="w-8 h-8 bg-white rounded-lg p-0.5 shrink-0 flex items-center justify-center shadow-md border border-slate-700 overflow-hidden" title={companyName}>
                <img src={companyLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md" title={companyName}>
                P
              </div>
            )}
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          title={isCollapsed ? "باز کردن منوی کناری" : "جمع کردن منوی کناری"}
        >
          {isCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 px-2 py-3 space-y-2 overflow-y-auto custom-scrollbar">
        {menuGroups.map((group, idx) => {
          const visibleItems = group.items.filter(item => item.visible);
          if (visibleItems.length === 0) return null;

          const GroupIcon = group.groupIcon || Compass;
          const isGroupOpen = openGroups[group.id] ?? true;
          
          const hasActiveItem = visibleItems.some(item => 
            location.pathname === item.path || 
            (item.path === '/accounting/dashboard' && location.pathname.startsWith('/accounting'))
          );

          if (isCollapsed) {
            return (
              <div key={group.id} className="space-y-1">
                {idx > 0 && <div className="h-px bg-slate-800/60 my-2 mx-1" />}
                {visibleItems.map(item => {
                  const active = location.pathname === item.path || (item.path === '/accounting/dashboard' && (location.pathname === '/accounting' || location.pathname === '/accounting/'));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={item.name}
                      className={cn(
                        "flex items-center justify-center p-2.5 rounded-xl text-xs font-semibold transition-all group relative",
                        active 
                          ? "bg-blue-600/90 text-white shadow-sm font-bold" 
                          : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
                      )}
                    >
                      <item.icon className={cn("w-4 h-4 shrink-0 transition-transform group-hover:scale-110", active ? "text-amber-300" : "text-slate-400 group-hover:text-slate-200")} />
                      {active && (
                        <span className="rounded-full bg-amber-400 shadow-xs absolute top-1 left-1 w-2 h-2" />
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          }

          return (
            <div key={group.id} className="rounded-xl overflow-hidden transition-all bg-slate-900/50">
              {/* Accordion Group Header */}
              <button
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer select-none group",
                  hasActiveItem 
                    ? "text-blue-400 bg-slate-800/60" 
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GroupIcon className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-transform group-hover:scale-110",
                    hasActiveItem ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300"
                  )} />
                  <span className="truncate text-[11px] font-bold tracking-tight">{group.title}</span>
                  
                  {!isGroupOpen && hasActiveItem && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" title="صفحه فعال در این دسته قرار دارد" />
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700/50">
                    {visibleItems.length}
                  </span>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 text-slate-500 transition-transform duration-200",
                    isGroupOpen ? "rotate-180 text-slate-300" : "rotate-0"
                  )} />
                </div>
              </button>

              {/* Accordion Group Items */}
              {isGroupOpen && (
                <div className="mr-3 mt-1 mb-1.5 pr-2 space-y-1 border-r-2 border-slate-800/80">
                  {visibleItems.map(item => {
                    const active = location.pathname === item.path || (item.path === '/accounting/dashboard' && (location.pathname === '/accounting' || location.pathname === '/accounting/'));
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all group relative",
                          active 
                            ? "bg-blue-600/90 text-white shadow-sm font-bold" 
                            : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                        )}
                      >
                        <item.icon className={cn("w-3.5 h-3.5 shrink-0 transition-transform group-hover:scale-110", active ? "text-amber-300" : "text-slate-400 group-hover:text-slate-200")} />
                        <span className="truncate">{item.name}</span>
                        {active && (
                          <span className="rounded-full bg-amber-400 shadow-xs absolute left-1.5 w-1.5 h-1.5" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer Profile & Logout */}
      <div className={cn("bg-slate-950 text-xs flex flex-col gap-2 border-t border-slate-800 transition-all", isCollapsed ? "p-2 items-center" : "p-3")}>
        <button 
          onClick={onOpenProfile} 
          className={cn("flex items-center gap-2 text-slate-300 hover:text-white transition-colors rounded-lg hover:bg-slate-900 cursor-pointer", isCollapsed ? "p-2 justify-center" : "px-2 py-1.5")}
          title="پروفایل و تنظیمات شخصی"
        >
          <Settings size={16} className="text-amber-400 shrink-0" />
          {!isCollapsed && <span className="truncate">پروفایل و تنظیمات</span>}
        </button>
        <button 
          onClick={onLogout} 
          className={cn("flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors border-t border-slate-900 rounded-lg hover:bg-slate-900 cursor-pointer", isCollapsed ? "p-2 justify-center pt-2" : "px-2 py-1.5 pt-2")}
          title="خروج از حساب کاربری"
        >
          <LogOut size={16} className="shrink-0" />
          {!isCollapsed && <span className="truncate">خروج از حساب</span>}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
