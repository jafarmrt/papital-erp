import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Save, RotateCcw, Lock, LayoutGrid, CheckCircle2, Users } from 'lucide-react';
import { Role } from '../../types';
import { fetchJson } from '../../api';
import { cn } from '../../utils';
import { getMenuGroups } from '../layout/menuConfig';
import { useMenuVisibilityQuery, useSaveSettingsMutation } from '../../hooks/queries/useSettingsQueries';

// کنترل نمایش منو برای هر نقش — ذخیره در تنظیمات سامانه
// فقط «نمایش در منو» کنترل می‌شود؛ دسترسی واقعی صفحات بر اساس ماتریس دسترسی نقش است.

interface MenuCatalogItem {
  path: string;
  name: string;
  groupTitle: string;
}

type VisibilityDraft = Record<string, string[]>;

export const MenuVisibilityPanel: React.FC = () => {
  const { data: savedVisibility } = useMenuVisibilityQuery();
  const saveSettings = useSaveSettingsMutation();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>('');
  const [draft, setDraft] = useState<VisibilityDraft>({});
  const [baseline, setBaseline] = useState<string>('');

  // کاتالوگ کامل منو از همان منبع یگانه (menuConfig)
  const catalog = useMemo<MenuCatalogItem[]>(() => {
    const groups = getMenuGroups({ role: 'admin' } as any, { isAdmin: true }, null);
    const out: MenuCatalogItem[] = [];
    for (const g of groups) {
      for (const it of g.items) {
        out.push({ path: it.path, name: it.name, groupTitle: g.title });
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

  const isHidden = (roleCode: string, path: string) => {
    if (roleCode === 'admin') return false;
    return Array.isArray(draft[roleCode]) && draft[roleCode].includes(path);
  };

  const toggle = (roleCode: string, path: string) => {
    if (roleCode === 'admin') return;
    setDraft(prev => {
      const next: VisibilityDraft = { ...prev };
      const list = Array.isArray(next[roleCode]) ? [...next[roleCode]] : [];
      const idx = list.indexOf(path);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(path);
      if (list.length > 0) next[roleCode] = list;
      else delete next[roleCode];
      return next;
    });
  };

  const setGroupForRole = (roleCode: string, groupTitle: string, hideAll: boolean) => {
    if (roleCode === 'admin') return;
    const groupPaths = catalog.filter(c => c.groupTitle === groupTitle).map(c => c.path);
    setDraft(prev => {
      const next: VisibilityDraft = { ...prev };
      let list = Array.isArray(next[roleCode]) ? [...next[roleCode]] : [];
      if (hideAll) {
        list = Array.from(new Set([...list, ...groupPaths]));
      } else {
        list = list.filter(p => !groupPaths.includes(p));
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
  };

  const dirty = JSON.stringify(draft) !== baseline;
  const selectedHiddenCount = selectedRoleCode && Array.isArray(draft[selectedRoleCode]) ? draft[selectedRoleCode].length : 0;

  const handleSave = async () => {
    try {
      await saveSettings.mutateAsync({
        settings: [{ key: 'menu_visibility', value: JSON.stringify(draft) }]
      });
      setBaseline(JSON.stringify(draft));
    } catch {
      // toast handled by mutation
    }
  };

  const grouped = useMemo<Array<[string, MenuCatalogItem[]]>>(() => {
    const map = new Map<string, MenuCatalogItem[]>();
    for (const c of catalog) {
      if (!map.has(c.groupTitle)) map.set(c.groupTitle, []);
      map.get(c.groupTitle)!.push(c);
    }
    return Array.from(map.entries());
  }, [catalog]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-gradient-to-l from-slate-50 to-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <LayoutGrid size={16} className="text-indigo-600" />
              کنترل نمایش منو برای هر نقش
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-2xl">
              برای هر نقش مشخص کنید کدام آیتم‌های منو مخفی شوند. این تنظیم فقط «نمایش در منو» را تغییر می‌دهد؛ دسترسی واقعی صفحات طبق ماتریس دسترسی همان نقش کنترل می‌شود. مدیر ارشد همیشه همه منوها را می‌بیند.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => selectedRoleCode && resetRole(selectedRoleCode)}
              disabled={!dirty || saveSettings.isPending}
              className="px-3 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5"
              title="بازگشت این نقش به حالت پیش‌فرض (نمایش بر اساس ماتریس دسترسی)"
            >
              <RotateCcw size={13} />
              پیش‌فرض
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
              {saveSettings.isPending ? 'در حال ذخیره...' : dirty ? 'ذخیره تغییرات' : 'ذخیره شده'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-xs animate-pulse">در حال بارگذاری...</div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Role selector chips */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-2 flex items-center gap-1.5">
              <Users size={12} />
              انتخاب نقش:
            </p>
            <div className="flex flex-wrap gap-2">
              {roles.map(r => {
                const isAdmin = r.code === 'admin';
                const active = selectedRoleCode === r.code;
                const hiddenCount = Array.isArray(draft[r.code]) ? draft[r.code].length : 0;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => !isAdmin && setSelectedRoleCode(r.code)}
                    disabled={isAdmin}
                    title={isAdmin ? 'مدیر ارشد همیشه همه منوها را می‌بیند' : `ویرایش دید منو برای ${r.name}`}
                    className={cn(
                      'px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5',
                      isAdmin && 'opacity-60 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400',
                      !isAdmin && !active && 'bg-white border-slate-300 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer',
                      !isAdmin && active && 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    )}
                  >
                    {isAdmin && <Lock size={11} />}
                    {r.name}
                    {!isAdmin && hiddenCount > 0 && (
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full font-mono',
                        active ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-600 border border-rose-200'
                      )}>
                        {hiddenCount} مخفی
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected role checklist */}
          {selectedRole ? (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-black text-slate-700">
                  منوی قابل نمایش برای «{selectedRole.name}»
                  {selectedHiddenCount > 0 && (
                    <span className="text-rose-600 font-bold mr-2">({selectedHiddenCount} مورد مخفی شده)</span>
                  )}
                </p>
                <p className="text-[10px] text-slate-400">روی هر آیتم بزنید تا بین نمایش/مخفی جابجا شود</p>
              </div>
              <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                {grouped.map(([groupTitle, items]) => {
                  const groupHidden = items.filter(i => isHidden(selectedRoleCode, i.path)).length;
                  return (
                    <div key={groupTitle} className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-black text-slate-500">{groupTitle}</p>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setGroupForRole(selectedRoleCode, groupTitle, false)}
                            className="px-2 py-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 cursor-pointer"
                          >
                            نمایش همه
                          </button>
                          <button
                            type="button"
                            onClick={() => setGroupForRole(selectedRoleCode, groupTitle, true)}
                            className="px-2 py-0.5 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                          >
                            مخفی همه
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {items.map(item => {
                          const hidden = isHidden(selectedRoleCode, item.path);
                          return (
                            <button
                              key={item.path}
                              type="button"
                              onClick={() => toggle(selectedRoleCode, item.path)}
                              className={cn(
                                'flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-right transition-all cursor-pointer',
                                hidden
                                  ? 'bg-rose-50/60 border-rose-200 hover:border-rose-300'
                                  : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'
                              )}
                            >
                              <span className={cn('text-xs font-bold truncate', hidden ? 'text-slate-400 line-through' : 'text-slate-700')}>
                                {item.name}
                              </span>
                              <span className={cn(
                                'w-7 h-4 rounded-full relative shrink-0 transition-colors',
                                hidden ? 'bg-slate-300' : 'bg-emerald-500'
                              )}>
                                <span className={cn(
                                  'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
                                  hidden ? 'right-0.5' : 'right-3.5'
                                )}></span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-xs">
              نقشی برای ویرایش یافت نشد (به‌جز مدیر ارشد).
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MenuVisibilityPanel;
