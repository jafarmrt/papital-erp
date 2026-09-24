import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  PanelRightClose, 
  PanelRightOpen, 
  ChevronDown, 
  Settings, 
  LogOut, 
  Compass, 
  Star, 
  FolderMinus, 
  Search
} from 'lucide-react';
import { cn } from '../../utils';
import { fetchJson } from '../../api';
import { User } from '../../types';
import { getMenuGroups, MenuVisibilityMap, MenuItem } from './menuConfig';
import { useMenuVisibilityQuery } from '../../hooks/queries/useSettingsQueries';
import { useAppFavicon } from '../../hooks/useAppFavicon';
import { SidebarSearch } from './SidebarSearch';
import { useSidebarFavorites } from './useSidebarFavorites';

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [companyLogo, setCompanyLogo] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('سامانه جامع ERP پاپیتال');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isFavoritesOpen, setIsFavoritesOpen] = useState<boolean>(true);

  const { favoritePaths, toggleFavorite, isFavorite } = useSidebarFavorites();

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

  const rawMenuGroups = useMemo(() => {
    return getMenuGroups(user, userPermissions, menuVisibilityMap);
  }, [user, userPermissions, menuVisibilityMap]);

  // شناسه گروه فعال فعلی برای قانون Single-Accordion
  const [activeGroupId, setActiveGroupId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('erp_sidebar_single_active_group');
      if (saved) return saved;
    } catch (e) {
      console.error('Error reading active group from localStorage:', e);
    }
    return 'main';
  });

  // کلید میانبر سراسری برای باز کردن و فوکوس روی سرچ منو (Ctrl + K یا /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isCollapsed) {
          onToggleCollapse();
        }
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCollapsed, onToggleCollapse]);

  // بررسی فعال بودن یک آیتم منو
  const isItemActive = (itemPath: string) => {
    const currentFull = location.pathname + location.search;
    if (itemPath.includes('?')) {
      return currentFull === itemPath;
    }
    if (itemPath === '/settings') {
      return location.pathname === '/settings' && !currentFull.includes('tab=chart_of_accounts');
    }
    if (itemPath === '/accounting/dashboard') {
      return location.pathname === '/accounting/dashboard' || location.pathname === '/accounting' || location.pathname === '/accounting/';
    }
    return location.pathname === itemPath;
  };

  // همگام‌سازی شاخه فعال با تغییر آدرس صفحه (اگر سرچ فعال نباشد، فقط شاخه جاری باز می‌شود)
  useEffect(() => {
    const matchingGroup = rawMenuGroups.find(g =>
      g.items.some(item => item.visible && isItemActive(item.path))
    );
    if (matchingGroup && matchingGroup.id !== activeGroupId) {
      setActiveGroupId(matchingGroup.id);
      try {
        localStorage.setItem('erp_sidebar_single_active_group', matchingGroup.id);
      } catch (e) {
        console.error('Error saving active group to localStorage:', e);
      }
    }
  }, [location.pathname, rawMenuGroups]);

  // کلیک روی هدر یک شاخه: Single Accordion (اگر همان شاخه باز بود، بسته می‌شود، وگرنه شاخه‌های دیگر بسته می‌شوند)
  const handleToggleGroup = (groupId: string) => {
    setActiveGroupId(prev => {
      const next = prev === groupId ? '' : groupId;
      try {
        localStorage.setItem('erp_sidebar_single_active_group', next);
      } catch (e) {
        console.error('Error saving active group to localStorage:', e);
      }
      return next;
    });
  };

  // بستن تمامی شاخه‌ها با یک کلیک
  const handleCollapseAll = () => {
    setActiveGroupId('');
    setIsFavoritesOpen(false);
    try {
      localStorage.setItem('erp_sidebar_single_active_group', '');
    } catch (e) {
      console.error('Error clearing active group:', e);
    }
  };

  // فیلتر کردن منوها با کادر سرچ بلادرنگ
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const { filteredGroups, totalMatchesCount, allVisibleItems } = useMemo(() => {
    const allItems: (MenuItem & { groupId: string; groupTitle: string })[] = [];
    rawMenuGroups.forEach(g => {
      g.items.forEach(it => {
        if (it.visible) {
          allItems.push({ ...it, groupId: g.id, groupTitle: g.title });
        }
      });
    });

    if (!normalizedQuery) {
      return {
        filteredGroups: rawMenuGroups,
        totalMatchesCount: allItems.length,
        allVisibleItems: allItems
      };
    }

    let matchCount = 0;
    const groups = rawMenuGroups
      .map(group => {
        const matchingItems = group.items.filter(item => {
          if (!item.visible) return false;
          const matchName = item.name.toLowerCase().includes(normalizedQuery);
          const matchPath = item.path.toLowerCase().includes(normalizedQuery);
          const matchGroup = group.title.toLowerCase().includes(normalizedQuery);
          return matchName || matchPath || matchGroup;
        });

        matchCount += matchingItems.length;

        return {
          ...group,
          items: matchingItems
        };
      })
      .filter(g => g.items.length > 0);

    return {
      filteredGroups: groups,
      totalMatchesCount: matchCount,
      allVisibleItems: allItems
    };
  }, [rawMenuGroups, normalizedQuery]);

  // فهرست آیتم‌های مورد علاقه کاربر
  const favoriteItems = useMemo(() => {
    const list: (MenuItem & { groupTitle: string })[] = [];
    favoritePaths.forEach(favPath => {
      const found = allVisibleItems.find(it => it.path === favPath);
      if (found) {
        list.push({
          name: found.name,
          path: found.path,
          icon: found.icon,
          visible: true,
          groupTitle: found.groupTitle
        });
      }
    });
    return list;
  }, [favoritePaths, allVisibleItems]);

  return (
    <aside className={cn(
      "bg-slate-900 text-slate-300 flex flex-col shrink-0 h-screen print:hidden transition-all duration-300 ease-in-out z-30 select-none",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header with Logo and Collapse button */}
      <div className={cn("border-b border-slate-800 flex items-center transition-all", isCollapsed ? "p-3 justify-center" : "p-3.5 justify-between")}>
        {!isCollapsed ? (
          <div className="flex items-center gap-2.5 text-white min-w-0">
            {companyLogo ? (
              <div className="w-8 h-8 bg-white rounded-xl p-1 shrink-0 flex items-center justify-center shadow-md border border-slate-700 overflow-hidden">
                <img 
                  src={companyLogo.startsWith('/') || companyLogo.startsWith('http') || companyLogo.startsWith('data:') ? companyLogo : '/' + companyLogo} 
                  alt="Logo" 
                  className="max-w-full max-h-full object-contain"
                  onError={() => setCompanyLogo('')}
                />
              </div>
            ) : (
              <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 shadow-md">
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

      {/* Quick Search & Controls (تنها در حالت باز بودن منو) */}
      {!isCollapsed && (
        <div className="px-2 pt-2.5 pb-1 border-b border-slate-800/80">
          <SidebarSearch
            query={searchQuery}
            onQueryChange={setSearchQuery}
            inputRef={searchInputRef}
            totalResultsCount={totalMatchesCount}
          />
          
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[10px] text-slate-500 font-medium">پیمایش منوها</span>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1 py-0.5 rounded hover:bg-slate-800/60"
              title="بستن همه شاخه‌ها"
            >
              <FolderMinus size={12} />
              <span>بستن همه</span>
            </button>
          </div>
        </div>
      )}

      {/* Navigation Groups */}
      <nav className="flex-1 px-2 py-2 space-y-1.5 overflow-y-auto custom-scrollbar">
        {/* بخش دسترسی سریع و علاقه‌مندی‌ها (Favorites) */}
        {!isCollapsed && !searchQuery.trim() && favoriteItems.length > 0 && (
          <div className="rounded-xl overflow-hidden bg-amber-950/20 border border-amber-900/30 mb-2">
            <button
              onClick={() => setIsFavoritesOpen(prev => !prev)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-900/30 transition cursor-pointer"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Star size={13} className="text-amber-400 fill-amber-400 shrink-0" />
                <span className="text-[11px] truncate">دسترسی سریع و برگزیده‌ها</span>
              </div>
              <ChevronDown size={13} className={cn("transition-transform duration-200 text-amber-400", isFavoritesOpen ? "rotate-180" : "rotate-0")} />
            </button>

            {isFavoritesOpen && (
              <div className="p-1 space-y-0.5 border-t border-amber-900/30">
                {favoriteItems.map(fav => {
                  const active = isItemActive(fav.path);
                  return (
                    <div key={fav.path} className="group/fav relative flex items-center">
                      <Link
                        to={fav.path}
                        className={cn(
                          "flex-1 flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all relative pr-3",
                          active
                            ? "bg-amber-500/20 text-amber-200 font-bold border-r-2 border-amber-400"
                            : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                        )}
                      >
                        <fav.icon size={13} className={cn("shrink-0", active ? "text-amber-300" : "text-slate-400 group-hover/fav:text-amber-300")} />
                        <span className="truncate">{fav.name}</span>
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(fav.path);
                        }}
                        className="p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover/fav:opacity-100 transition-opacity cursor-pointer shrink-0"
                        title="حذف از دسترسی سریع"
                      >
                        <Star size={11} className="fill-amber-400 text-amber-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* لیست گروه‌ها */}
        {filteredGroups.map((group, idx) => {
          const visibleItems = group.items.filter(item => item.visible);
          if (visibleItems.length === 0) return null;

          const GroupIcon = group.groupIcon || Compass;
          // اگر کاربر در حال جستجو است، تمام گروه‌های شامل نتیجه خودکار باز شوند؛ در غیر این صورت از قانون Single-Accordion پیروی شود
          const isGroupOpen = searchQuery.trim() ? true : activeGroupId === group.id;
          
          const hasActiveItem = visibleItems.some(item => isItemActive(item.path));

          if (isCollapsed) {
            return (
              <div key={group.id} className="space-y-1">
                {idx > 0 && <div className="h-px bg-slate-800/60 my-2 mx-1" />}
                {visibleItems.map(item => {
                  const active = isItemActive(item.path);
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
                onClick={() => handleToggleGroup(group.id)}
                className={cn(
                  "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer select-none group border-r-2",
                  hasActiveItem 
                    ? "text-blue-400 bg-slate-800/60 border-blue-500" 
                    : isGroupOpen
                      ? "text-slate-200 bg-slate-800/40 border-slate-600"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent"
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
                <div className="mr-3 mt-1 mb-1.5 pr-2 space-y-0.5 border-r-2 border-slate-800/80">
                  {visibleItems.map(item => {
                    const active = isItemActive(item.path);
                    const itemIsFav = isFavorite(item.path);

                    return (
                      <div key={item.path} className="group/item relative flex items-center">
                        <Link
                          to={item.path}
                          className={cn(
                            "flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all relative border-r-2",
                            active 
                              ? "bg-blue-600 text-white shadow-sm font-bold border-amber-400 pr-3" 
                              : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200 border-transparent"
                          )}
                        >
                          <item.icon className={cn("w-3.5 h-3.5 shrink-0 transition-transform group-hover/item:scale-110", active ? "text-amber-300" : "text-slate-400 group-hover/item:text-slate-200")} />
                          <span className="truncate">{item.name}</span>
                          {active && (
                            <span className="rounded-full bg-amber-400 shadow-xs absolute left-1.5 w-1.5 h-1.5" />
                          )}
                        </Link>

                        {/* دکمه پین کردن به علاقه‌مندی‌ها */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(item.path);
                          }}
                          className={cn(
                            "p-1 rounded transition-opacity cursor-pointer shrink-0 ml-1",
                            itemIsFav
                              ? "text-amber-400 opacity-100"
                              : "text-slate-600 hover:text-amber-300 opacity-0 group-hover/item:opacity-100"
                          )}
                          title={itemIsFav ? "حذف از برگزیده‌ها" : "افزودن به برگزیده‌ها"}
                        >
                          <Star size={12} className={itemIsFav ? "fill-amber-400" : ""} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {filteredGroups.length === 0 && searchQuery.trim() && (
          <div className="py-6 px-3 text-center text-slate-500">
            <Search size={22} className="mx-auto mb-1 text-slate-600" />
            <p className="text-xs">نتیجه‌ای با عبارت «{searchQuery}» یافت نشد.</p>
          </div>
        )}
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
