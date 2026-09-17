import { Search, X, ChevronLeft } from 'lucide-react';
import { SettingCategoryGroup } from './settingsNavigationConfig';
import { cn } from '../../utils';

interface SettingsNavigationSidebarProps {
  groups: SettingCategoryGroup[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedGroupFilter: string | null;
  setSelectedGroupFilter: (groupId: string | null) => void;
}

export function SettingsNavigationSidebar({
  groups,
  activeTab,
  onSelectTab,
  searchQuery,
  setSearchQuery,
  selectedGroupFilter,
  setSelectedGroupFilter
}: SettingsNavigationSidebarProps) {
  // Filter groups based on group filter and search query
  const filteredGroups = groups
    .filter(g => !selectedGroupFilter || g.id === selectedGroupFilter)
    .map(g => {
      if (!searchQuery.trim()) return g;
      const q = searchQuery.trim().toLowerCase();
      const matchingTabs = g.tabs.filter(t => 
        t.label.toLowerCase().includes(q) ||
        t.shortDesc.toLowerCase().includes(q) ||
        t.keywords.some(k => k.toLowerCase().includes(q))
      );
      return {
        ...g,
        tabs: matchingTabs
      };
    })
    .filter(g => g.tabs.length > 0);

  const totalMatchingTabs = filteredGroups.reduce((acc, g) => acc + g.tabs.length, 0);

  return (
    <aside className="w-full md:w-80 lg:w-88 flex flex-col shrink-0 bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
      {/* Search & Filter Header */}
      <div className="p-3.5 border-b border-slate-100 bg-slate-50/70 space-y-2.5">
        {/* Search Input */}
        <div className="relative flex items-center">
          <Search size={16} className="absolute right-3 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجو در بخش‌های تنظیمات..."
            className="w-full pl-8 pr-9 py-2 bg-white text-xs text-slate-800 placeholder-slate-400 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition shadow-2xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition"
              title="پاک کردن جستجو"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category Pills Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar text-xs">
          <button
            onClick={() => setSelectedGroupFilter(null)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer',
              selectedGroupFilter === null
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-200/60 border border-slate-200/80'
            )}
          >
            همه بخش‌ها
          </button>
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => setSelectedGroupFilter(selectedGroupFilter === g.id ? null : g.id)}
              className={cn(
                'px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-1.5',
                selectedGroupFilter === g.id
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'bg-white text-slate-600 hover:bg-slate-200/60 border border-slate-200/80'
              )}
            >
              <span>{g.title}</span>
              <span className={cn(
                'text-[10px] px-1.5 py-0.2 rounded-full',
                selectedGroupFilter === g.id ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'
              )}>
                {g.tabs.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Grouped Tabs List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar max-h-[calc(100vh-210px)]">
        {filteredGroups.length === 0 ? (
          <div className="py-8 text-center px-4">
            <p className="text-xs text-slate-500">تنظیمی با این مشخصات یافت نشد.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedGroupFilter(null);
              }}
              className="mt-2 text-xs text-blue-600 hover:underline font-bold cursor-pointer"
            >
              پاک کردن فیلترها
            </button>
          </div>
        ) : (
          filteredGroups.map(group => {
            const GroupIcon = group.icon;

            return (
              <div key={group.id} className="space-y-1">
                {/* Group Title Badge */}
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('p-1 rounded-md border text-xs', group.colorClass)}>
                      <GroupIcon size={14} />
                    </span>
                    <span className="text-xs font-bold text-slate-700">
                      {group.title}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {group.tabs.length}
                  </span>
                </div>

                {/* Tab Items */}
                <div className="space-y-1 mr-1">
                  {group.tabs.map(tab => {
                    const TabIcon = tab.icon;
                    const isActive = activeTab === tab.id;

                    return (
                      <button
                        key={tab.id}
                        onClick={() => onSelectTab(tab.id)}
                        className={cn(
                          'w-full flex items-center justify-between p-2.5 rounded-xl text-right transition cursor-pointer group',
                          isActive
                            ? 'bg-blue-50/90 text-blue-900 border border-blue-200/80 shadow-2xs'
                            : 'hover:bg-slate-50/80 text-slate-700 hover:text-slate-900 border border-transparent'
                        )}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={cn(
                            'p-1.5 rounded-lg shrink-0 transition-colors mt-0.5',
                            isActive 
                              ? 'bg-blue-600 text-white shadow-2xs' 
                              : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200/70 group-hover:text-slate-700'
                          )}>
                            <TabIcon size={15} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                'text-xs truncate block',
                                isActive ? 'font-black text-blue-900' : 'font-semibold text-slate-800'
                              )}>
                                {tab.label}
                              </span>
                              {tab.adminOnly && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-rose-100 text-rose-700 font-bold">
                                  مدیر
                                </span>
                              )}
                            </div>
                            <p className={cn(
                              'text-[11px] truncate mt-0.5',
                              isActive ? 'text-blue-700/80' : 'text-slate-400 group-hover:text-slate-500'
                            )}>
                              {tab.shortDesc}
                            </p>
                          </div>
                        </div>

                        <ChevronLeft 
                          size={14} 
                          className={cn(
                            'shrink-0 mr-1 transition-transform',
                            isActive ? 'text-blue-600 translate-x-[-2px]' : 'text-slate-300 opacity-0 group-hover:opacity-100'
                          )} 
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-[11px] text-slate-400">
        <span>مجموع بخش‌ها: {totalMatchingTabs} سربرگ</span>
        <span>پیکربندی یکپارچه سامانه</span>
      </div>
    </aside>
  );
}
