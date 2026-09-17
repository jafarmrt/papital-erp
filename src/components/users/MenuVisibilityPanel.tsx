import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { EyeOff, Save, RotateCcw, Lock, LayoutGrid, CheckCircle2, Users, Search, Check } from 'lucide-react';
import { Role } from '../../types';
import { fetchJson } from '../../api';
import { cn } from '../../utils';
import { getMenuGroups } from '../layout/menuConfig';
import { useMenuVisibilityQuery, useSaveSettingsMutation } from '../../hooks/queries/useSettingsQueries';

// کنترل نمایش منو برای هر نقش — ذخیره در تنظیمات سامانه
// ماتریس هوشمند: بررسی دسترسی‌های هر نقش + امکان مخفی‌سازی یا آشکارسازی گزینه‌ها

interface MenuCatalogItem {
  path: string;
  name: string;
  groupTitle: string;
  groupId: string;
}

type VisibilityDraft = Record<string, string[]>;
type FilterMode = 'all' | 'displayed' | 'hidden' | 'no_perm';

export const MenuVisibilityPanel: React.FC = () => {
  const { data: savedVisibility } = useMenuVisibilityQuery();
  const saveSettings = useSaveSettingsMutation();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>('');
  const [draft, setDraft] = useState<VisibilityDraft>({});
  const [baseline, setBaseline] = useState<string>('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // کاتالوگ کامل منو از همان منبع یگانه (menuConfig)
  const catalog = useMemo<MenuCatalogItem[]>(() => {
    const groups = getMenuGroups({ role: 'admin' } as any, { isAdmin: true }, null);
    const out: MenuCatalogItem[] = [];
    for (const g of groups) {
      for (const it of g.items) {
        out.push({ path: it.path, name: it.name, groupTitle: g.title, groupId: g.id });
      }
    }
    return out;
  }, []);

  const normalize = (raw: any, rolesFetched: Role[]): VisibilityDraft => {
    const clean: VisibilityDraft = {};
    const validPaths = new Set(catalog.map(c => c.path));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const r of rolesFetched) {
        const hidden = Array.isArray(raw[r.code]) ? raw[r.code].filter((p: any) => validPaths.has(p)) : [];
        if (hidden.length > 0) clean[r.code] = hidden;
      }
    }
    return clean;
  };

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const rolesRes = await fetchJson('/roles', { signal: controller.signal });
        const rolesList: Role[] = Array.isArray(rolesRes) ? rolesRes : (Array.isArray(rolesRes?.data) ? rolesRes.data : []);
        setRoles(rolesList);
        const clean = normalize(savedVisibility, rolesList);
        setDraft(clean);
        setBaseline(JSON.stringify(clean));
        if (!selectedRoleCode) {
          const firstEditable = rolesList.find(r => r.code !== 'admin');
          setSelectedRoleCode(firstEditable?.code || '');
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') toast.error('خطا در دریافت نقش‌ها');
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedVisibility]);

  const selectedRole = roles.find(r => r.code === selectedRoleCode);

  // محاسبه دسترسی‌های پایه منو برای هر نقش بر اساس ماتریس مجوزهای آن نقش (getMenuGroups)
  const rolePermissionsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of roles) {
      if (r.code === 'admin') {
        map.set(r.code, new Set(catalog.map(c => c.path)));
      } else {
        const groups = getMenuGroups(
          { role: r.code } as any,
          { permissions: r.permissions || [], isAdmin: false },
          null
        );
        const permitted = new Set<string>();
        for (const g of groups) {
          for (const item of g.items) {
            if (item.visible) {
              permitted.add(item.path);
            }
          }
        }
        map.set(r.code, permitted);
      }
    }
    return map;
  }, [roles, catalog]);

  const selectedPermittedPaths = useMemo<Set<string>>(() => {
    if (!selectedRoleCode) return new Set();
    return rolePermissionsMap.get(selectedRoleCode) || new Set();
  }, [selectedRoleCode, rolePermissionsMap]);

  // آیا آیتم توسط مدیر ارشد به صورت دستی در این نقش مخفی شده است؟
  const isExplicitlyHidden = (roleCode: string, path: string) => {
    if (roleCode === 'admin') return false;
    return Array.isArray(draft[roleCode]) && draft[roleCode].includes(path);
  };

  // آیا آیتم بر اساس ماتریس دسترسی و تنظیمات دید در منوی این نقش ظاهر می‌شود؟

  const toggle = (roleCode: string, path: string, hasPerm: boolean) => {
    if (roleCode === 'admin') return;

    if (!hasPerm) {
      const item = catalog.find(c => c.path === path);
      toast(
        `این نقش فاقد دسترسی به «${item?.name || path}» در ماتریس دسترسی است. برای نمایش آن در منو، ابتدا دسترسی مربوطه را در تب «ماتریس نقش‌ها و مجوزها» به این نقش اختصاص دهید.`,
        { icon: '🔒', duration: 4500 }
      );
      return;
    }

    setDraft(prev => {
      const next: VisibilityDraft = { ...prev };
      const list = Array.isArray(next[roleCode]) ? [...next[roleCode]] : [];
      const idx = list.indexOf(path);
      if (idx >= 0) {
        // قبلاً مخفی بود -> اکنون نمایش داده شود
        list.splice(idx, 1);
        toast.success('نمایش این صفحه در منو فعال شد');
      } else {
        // قبلاً نمایش داده می‌شد -> اکنون مخفی شود
        list.push(path);
        toast.success('این صفحه از منوی این نقش مخفی شد');
      }
      if (list.length > 0) next[roleCode] = list;
      else delete next[roleCode];
      return next;
    });
  };

  const setGroupForRole = (roleCode: string, groupTitle: string, hideAll: boolean) => {
    if (roleCode === 'admin') return;
    const groupPermittedPaths = catalog
      .filter(c => c.groupTitle === groupTitle && selectedPermittedPaths.has(c.path))
      .map(c => c.path);

    if (groupPermittedPaths.length === 0) {
      toast('هیچ صفحه مجاز و فعالی در این بخش برای تغییر وضعیت یافت نشد.', { icon: 'ℹ️' });
      return;
    }

    setDraft(prev => {
      const next: VisibilityDraft = { ...prev };
      let list = Array.isArray(next[roleCode]) ? [...next[roleCode]] : [];
      if (hideAll) {
        list = Array.from(new Set([...list, ...groupPermittedPaths]));
        toast.success(`تمام صفحات مجاز گروه «${groupTitle}» مخفی شدند`);
      } else {
        list = list.filter(p => !groupPermittedPaths.includes(p));
        toast.success(`تمام صفحات مجاز گروه «${groupTitle}» در منو نمایان شدند`);
      }
      if (list.length > 0) next[roleCode] = list;
      else delete next[roleCode];
      return next;
    });
  };

  const resetRole = (roleCode: string) => {
    if (roleCode === 'admin') return;
    setDraft(prev => {
      const next = { ...prev };
      delete next[roleCode];
      return next;
    });
    toast.success('تنظیمات دید این نقش به حالت پیش‌فرض (ماتریس دسترسی) بازگردانی شد.');
  };

  const dirty = JSON.stringify(draft) !== baseline;

  // آمار کلی برای نقش جاری
  const roleStats = useMemo(() => {
    if (!selectedRoleCode) return { displayed: 0, explicitlyHidden: 0, noPermission: 0, total: catalog.length };
    let displayed = 0;
    let explicitlyHidden = 0;
    let noPermission = 0;

    for (const item of catalog) {
      const hasPerm = selectedPermittedPaths.has(item.path);
      const isHidden = isExplicitlyHidden(selectedRoleCode, item.path);
      if (hasPerm) {
        if (isHidden) {
          explicitlyHidden++;
        } else {
          displayed++;
        }
      } else {
        noPermission++;
      }
    }
    return { displayed, explicitlyHidden, noPermission, total: catalog.length };
  }, [catalog, selectedPermittedPaths, draft, selectedRoleCode]);

  const handleSave = async () => {
    try {
      await saveSettings.mutateAsync({
        settings: [{ key: 'menu_visibility', value: JSON.stringify(draft) }]
      });
      setBaseline(JSON.stringify(draft));
      toast.success('تنظیمات دید منو با موفقیت در سیستم ثبت گردید.');
    } catch {
      // handled by mutation
    }
  };

  // گروه‌بندی آیتم‌ها با اعمال فیلتر جستجو و تب وضعیت
  const grouped = useMemo<Array<[string, MenuCatalogItem[]]>>(() => {
    const q = searchTerm.trim().toLowerCase();
    const map = new Map<string, MenuCatalogItem[]>();

    for (const c of catalog) {
      const hasPerm = selectedPermittedPaths.has(c.path);
      const isHidden = isExplicitlyHidden(selectedRoleCode, c.path);
      const isDisplayed = hasPerm && !isHidden;

      // فیلتر جستجو
      if (q && !c.name.toLowerCase().includes(q) && !c.groupTitle.toLowerCase().includes(q)) {
        continue;
      }

      // فیلتر وضعیت
      if (filterMode === 'displayed' && !isDisplayed) continue;
      if (filterMode === 'hidden' && !(hasPerm && isHidden)) continue;
      if (filterMode === 'no_perm' && hasPerm) continue;

      if (!map.has(c.groupTitle)) map.set(c.groupTitle, []);
      map.get(c.groupTitle)!.push(c);
    }
    return Array.from(map.entries());
  }, [catalog, searchTerm, filterMode, selectedPermittedPaths, selectedRoleCode, draft]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden font-farsi">
      {/* Header */}
      <div className="p-4 md:p-5 border-b border-slate-200 bg-gradient-to-l from-slate-50 via-indigo-50/20 to-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
                <LayoutGrid size={18} />
              </div>
              <h3 className="font-black text-sm md:text-base text-slate-800">
                کنترل نمایش و فیلتر دید منو برای هر نقش
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-3xl">
              برای هر نقش مشخص کنید کدام صفحات در سایدبار نمایش داده شوند. گزینه‌های سبز به صورت فعال در منوی کاربران آن نقش نمایش داده می‌شوند و با زدن کلید هر گزینه، می‌توانید نمایش آن را روشن یا خاموش کنید.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => selectedRoleCode && resetRole(selectedRoleCode)}
              disabled={!dirty && roleStats.explicitlyHidden === 0}
              className="px-3 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
              title="بازگشت این نقش به حالت پیش‌فرض مجوزهای ماتریس دسترسی"
            >
              <RotateCcw size={13} />
              پیش‌فرض این نقش
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saveSettings.isPending}
              className={cn(
                'px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-sm',
                dirty
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-indigo-600/20'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
              )}
            >
              {dirty ? <Save size={14} /> : <CheckCircle2 size={14} />}
              {saveSettings.isPending ? 'در حال ذخیره...' : dirty ? 'ذخیره تغییرات دید منو' : 'تنظیمات ذخیره است'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-xs animate-pulse">در حال بارگذاری اطلاعات نقش‌ها و دسترسی‌ها...</div>
      ) : (
        <div className="p-4 md:p-5 space-y-5">
          {/* Role selector chips */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <Users size={14} className="text-indigo-600" />
                انتخاب نقش جهت بررسی و تنظیم دید منو:
              </p>
              <span className="text-[11px] text-slate-400">
                روی هر نقش کلیک کنید تا وضعیت واقعی سایدبار آن نمایش داده شود
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {roles.map(r => {
                const isAdmin = r.code === 'admin';
                const active = selectedRoleCode === r.code;
                const hiddenCount = Array.isArray(draft[r.code]) ? draft[r.code].length : 0;
                const permSet = rolePermissionsMap.get(r.code) || new Set();
                const totalPermitted = permSet.size;
                const currentDisplayed = isAdmin ? catalog.length : Math.max(0, totalPermitted - hiddenCount);

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => !isAdmin && setSelectedRoleCode(r.code)}
                    disabled={isAdmin}
                    title={isAdmin ? 'مدیر ارشد سیستم همیشه تمام منوها را مشاهده می‌کند' : `تنظیم دید منو برای «${r.name}»`}
                    className={cn(
                      'px-3.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2',
                      isAdmin && 'opacity-60 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-500',
                      !isAdmin && !active && 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer shadow-2xs',
                      !isAdmin && active && 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    )}
                  >
                    {isAdmin ? <Lock size={12} /> : <span className={cn('w-2 h-2 rounded-full', active ? 'bg-white' : 'bg-indigo-500')}></span>}
                    <span>{r.name}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-md font-mono',
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    )}>
                      {currentDisplayed} منو
                    </span>
                    {!isAdmin && hiddenCount > 0 && (
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-md font-bold',
                        active ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-600 border border-rose-200'
                      )}>
                        {hiddenCount} مخفی
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected role control area */}
          {selectedRole ? (
            <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-2xs bg-white">
              {/* Role Title & Visual Status Bar */}
              <div className="p-4 bg-slate-50/80 border-b border-slate-200 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                      {selectedRole.name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                        دید منو برای نقش: <span className="text-indigo-600">«{selectedRole.name}»</span>
                        <span className="text-[11px] font-mono text-slate-400">({selectedRole.code})</span>
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {selectedRole.description || 'بدون توضیحات ثبت‌شده برای این نقش'}
                      </p>
                    </div>
                  </div>

                  {/* Summary Metric Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-700 shadow-2xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span>نمایش داده می‌شود:</span>
                      <span className="font-mono text-emerald-800">{roleStats.displayed}</span>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 shadow-2xs">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span>مخفی‌شده توسط مدیر:</span>
                      <span className="font-mono text-rose-800">{roleStats.explicitlyHidden}</span>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-2xs">
                      <Lock size={12} className="text-slate-400" />
                      <span>فاقد دسترسی در نقش:</span>
                      <span className="font-mono text-slate-700">{roleStats.noPermission}</span>
                    </div>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-200/70">
                  {/* Status Filter Tabs */}
                  <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer',
                        filterMode === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      همه صفحات ({roleStats.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('displayed')}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1',
                        filterMode === 'displayed' ? 'bg-emerald-600 text-white shadow-xs' : 'text-emerald-700 hover:bg-emerald-50'
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      قابل نمایش در منو ({roleStats.displayed})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('hidden')}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1',
                        filterMode === 'hidden' ? 'bg-rose-600 text-white shadow-xs' : 'text-rose-700 hover:bg-rose-50'
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                      مخفی‌شده توسط مدیر ({roleStats.explicitlyHidden})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('no_perm')}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1',
                        filterMode === 'no_perm' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-500 hover:bg-slate-100'
                      )}
                    >
                      <Lock size={10} />
                      فاقد مجوز نقش ({roleStats.noPermission})
                    </button>
                  </div>

                  {/* Search inside menu */}
                  <div className="relative sm:w-64">
                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="جستجوی نام صفحه یا گروه..."
                      className="w-full pl-7 pr-8 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Items List by Group */}
              <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto p-2 sm:p-4 space-y-4">
                {grouped.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    هیچ صفحه‌ای مطابق با فیلتر یا عبارت جستجوی انتخابی یافت نشد.
                  </div>
                ) : (
                  grouped.map(([groupTitle, items]) => {
                    const permittedInGroup = items.filter(i => selectedPermittedPaths.has(i.path));
                    const displayedInGroup = permittedInGroup.filter(i => !isExplicitlyHidden(selectedRoleCode, i.path));

                    return (
                      <div key={groupTitle} className="p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                        {/* Group Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-200/60">
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-3.5 bg-indigo-500 rounded-full"></span>
                            <h5 className="text-xs font-black text-slate-800">{groupTitle}</h5>
                            <span className="text-[11px] text-slate-400 font-mono">
                              ({displayedInGroup.length} از {permittedInGroup.length} مجاز فعال)
                            </span>
                          </div>
                          {permittedInGroup.length > 0 && (
                            <div className="flex items-center gap-1.5 self-end sm:self-auto">
                              <button
                                type="button"
                                onClick={() => setGroupForRole(selectedRoleCode, groupTitle, false)}
                                className="px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer flex items-center gap-1"
                                title="نمایش تمام صفحات مجاز این گروه در منو"
                              >
                                <Check size={12} />
                                نمایش همه
                              </button>
                              <button
                                type="button"
                                onClick={() => setGroupForRole(selectedRoleCode, groupTitle, true)}
                                className="px-2 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200/80 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer flex items-center gap-1"
                                title="مخفی کردن تمام صفحات این گروه از منو"
                              >
                                <EyeOff size={12} />
                                مخفی همه
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Items Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {items.map(item => {
                            const hasPerm = selectedPermittedPaths.has(item.path);
                            const isHidden = isExplicitlyHidden(selectedRoleCode, item.path);
                            const isDisplayed = hasPerm && !isHidden;

                            return (
                              <div
                                key={item.path}
                                onClick={() => toggle(selectedRoleCode, item.path, hasPerm)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggle(selectedRoleCode, item.path, hasPerm);
                                  }
                                }}
                                className={cn(
                                  'flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-right transition-all select-none',
                                  // Case 1: Visible in Menu (Green)
                                  isDisplayed && 'bg-white border-emerald-200/90 shadow-2xs hover:border-emerald-400 hover:bg-emerald-50/30 cursor-pointer',
                                  // Case 2: Hidden by Admin (Rose/Red)
                                  hasPerm && isHidden && 'bg-rose-50/50 border-rose-200 hover:border-rose-300 hover:bg-rose-50/80 cursor-pointer',
                                  // Case 3: No Permission in Role (Gray/Locked)
                                  !hasPerm && 'bg-slate-50 border-slate-200/70 opacity-65 cursor-pointer hover:border-slate-300'
                                )}
                              >
                                <div className="flex flex-col min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        'text-xs font-bold truncate',
                                        isDisplayed && 'text-slate-800',
                                        hasPerm && isHidden && 'text-rose-700 line-through',
                                        !hasPerm && 'text-slate-400'
                                      )}
                                    >
                                      {item.name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    {isDisplayed && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-md">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        نمایش در منو (روشن)
                                      </span>
                                    )}
                                    {hasPerm && isHidden && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100/70 border border-rose-200 px-1.5 py-0.5 rounded-md">
                                        <EyeOff size={10} />
                                        مخفی‌شده توسط مدیر (خاموش)
                                      </span>
                                    )}
                                    {!hasPerm && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">
                                        <Lock size={10} className="text-slate-400" />
                                        فاقد دسترسی در نقش (عدم نمایش)
                                      </span>
                                    )}
                                    <span className="text-[10px] font-mono text-slate-400 truncate dir-ltr">
                                      {item.path}
                                    </span>
                                  </div>
                                </div>

                                {/* Custom Toggle Switch Indicator */}
                                <div className="shrink-0 flex items-center">
                                  <div
                                    className={cn(
                                      'w-9 h-5 rounded-full relative transition-colors',
                                      isDisplayed && 'bg-emerald-500 shadow-xs shadow-emerald-500/20',
                                      hasPerm && isHidden && 'bg-rose-400',
                                      !hasPerm && 'bg-slate-300'
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all flex items-center justify-center',
                                        isDisplayed ? 'right-4.5' : 'right-0.5'
                                      )}
                                    >
                                      {!hasPerm && <Lock size={9} className="text-slate-400" />}
                                      {hasPerm && isHidden && <EyeOff size={9} className="text-rose-500" />}
                                      {isDisplayed && <Check size={10} className="text-emerald-600 stroke-[3]" />}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs">
              نقشی برای ویرایش دید منو یافت نشد (مدیر ارشد سیستم همواره به همه منوها دسترسی دارد).
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MenuVisibilityPanel;
