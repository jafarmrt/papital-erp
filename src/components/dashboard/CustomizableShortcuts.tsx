import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Settings2, Package, Box, FileText, Target, CalendarCheck, Layers,
  CheckSquare, FileInput, Warehouse, UsersRound, DollarSign, Sparkles,
  AlertTriangle, Users, Calculator, Landmark, ClipboardList, Check, X,
  ArrowUpRight
} from 'lucide-react';
import { User } from '../../types';

export interface ShortcutItemDef {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: any;
  color: string;
  bgColor: string;
  borderColor: string;
  requiredPerm?: string | string[];
}

export const ALL_SHORTCUTS: ShortcutItemDef[] = [
  {
    id: 'crm',
    title: 'مدیریت CRM و فروش',
    description: 'پیگیری فرصت‌ها و ارتباط با مشتریان',
    path: '/crm',
    icon: Target,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50 hover:bg-rose-100/80',
    borderColor: 'border-rose-200/80',
    requiredPerm: 'crm.view',
  },
  {
    id: 'daily_logs',
    title: 'ثبت کار روزانه',
    description: 'گزارش عملکرد و ساعات کاری روزانه',
    path: '/daily-logs',
    icon: CalendarCheck,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 hover:bg-blue-100/80',
    borderColor: 'border-blue-200/80',
    requiredPerm: ['daily_logs.view', 'daily_logs.create'],
  },
  {
    id: 'approval_inbox',
    title: 'کارتابل تاییدات (ورکفلو)',
    description: 'بررسی اسناد و تاییدات معوقه',
    path: '/approval-inbox',
    icon: CheckSquare,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 hover:bg-purple-100/80',
    borderColor: 'border-purple-200/80',
  },
  {
    id: 'create_invoice',
    title: 'صدور فاکتور / پیش‌فاکتور',
    description: 'ثبت فروش و صدور اسناد خروج',
    path: '/invoices/create',
    icon: FileText,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 hover:bg-emerald-100/80',
    borderColor: 'border-emerald-200/80',
    requiredPerm: 'documents.create',
  },
  {
    id: 'products',
    title: 'محصولات و کالاها',
    description: 'تعریف و مدیریت کاتالوگ محصولات',
    path: '/products',
    icon: Package,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 hover:bg-indigo-100/80',
    borderColor: 'border-indigo-200/80',
    requiredPerm: 'products.view',
  },
  {
    id: 'raw_materials',
    title: 'مواد اولیه',
    description: 'مدیریت و موجودی متریال و مواد خام',
    path: '/products?type=raw_material',
    icon: Box,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 hover:bg-amber-100/80',
    borderColor: 'border-amber-200/80',
    requiredPerm: 'products.view',
  },
  {
    id: 'projects',
    title: 'کنترل پروژه‌های تولید',
    description: 'برنامه‌ریزی، مراحل و سفارشات تولید',
    path: '/projects',
    icon: Layers,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50 hover:bg-cyan-100/80',
    borderColor: 'border-cyan-200/80',
    requiredPerm: 'projects.view',
  },
  {
    id: 'inventory_status',
    title: 'دیده‌بان وضعیت انبار',
    description: 'گزارش ارزش، جابجایی‌ها و هوش تجاری',
    path: '/inventory-status',
    icon: Warehouse,
    color: 'text-slate-700',
    bgColor: 'bg-slate-100 hover:bg-slate-200/80',
    borderColor: 'border-slate-300/80',
  },
  {
    id: 'receipts',
    title: 'ورود و خروج انبار',
    description: 'حواله‌ها و رسیدهای انبار',
    path: '/receipts',
    icon: FileInput,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50 hover:bg-teal-100/80',
    borderColor: 'border-teal-200/80',
    requiredPerm: ['warehouse.in', 'documents.view', 'documents.create'],
  },
  {
    id: 'customers',
    title: 'طرفین حساب و مشتریان',
    description: 'دفترچه مخاطبان و پرونده مشتریان',
    path: '/customers',
    icon: UsersRound,
    color: 'text-sky-600',
    bgColor: 'bg-sky-50 hover:bg-sky-100/80',
    borderColor: 'border-sky-200/80',
    requiredPerm: 'customers.view',
  },
  {
    id: 'pricing',
    title: 'قیمت‌گذاری اقلام',
    description: 'استراتژی‌های قیمت و کدهای ترنسفر',
    path: '/pricing',
    icon: DollarSign,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50 hover:bg-emerald-100/80',
    borderColor: 'border-emerald-300/80',
    requiredPerm: ['products.edit_price', 'products.view'],
  },
  {
    id: 'transfers',
    title: 'کدهای ترنسفر',
    description: 'مدیریت و تصاویر ترنسفر محصولات',
    path: '/transfers',
    icon: Sparkles,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 hover:bg-purple-100/80',
    borderColor: 'border-purple-200/80',
    requiredPerm: ['products.view', 'warehouse.view'],
  },
  {
    id: 'reorder_alerts',
    title: 'هشدار نقطه سفارش',
    description: 'کنترل کسری‌ها و هشدارهای تامین',
    path: '/reorder-alerts',
    icon: AlertTriangle,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50 hover:bg-rose-100/80',
    borderColor: 'border-rose-200/80',
    requiredPerm: ['products.view', 'warehouse.view'],
  },
  {
    id: 'personnel',
    title: 'مشخصات پرسنل',
    description: 'فهرست و سوابق اعضای تیم',
    path: '/personnel',
    icon: Users,
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 hover:bg-blue-100/80',
    borderColor: 'border-blue-200/80',
    requiredPerm: 'personnel.view',
  },
  {
    id: 'piecework',
    title: 'حقوق و دستمزد کارمزدی',
    description: 'ثبت و محاسبه کارکرد پرسنل',
    path: '/piecework',
    icon: Calculator,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 hover:bg-amber-100/80',
    borderColor: 'border-amber-300/80',
    requiredPerm: 'piecework.view',
  },
  {
    id: 'accounting',
    title: 'حسابداری و مالی',
    description: 'اسناد دوبل، ترازنامه و مرور حساب‌ها',
    path: '/accounting/dashboard',
    icon: Landmark,
    color: 'text-violet-700',
    bgColor: 'bg-violet-50 hover:bg-violet-100/80',
    borderColor: 'border-violet-200/80',
    requiredPerm: 'accounting.view',
  },
  {
    id: 'audit',
    title: 'انبارگردانی دوره‌ای',
    description: 'شمارش موجودی و تطبیق انبار',
    path: '/audit',
    icon: ClipboardList,
    color: 'text-slate-600',
    bgColor: 'bg-slate-50 hover:bg-slate-100/80',
    borderColor: 'border-slate-200/80',
    requiredPerm: 'audit.view',
  },
];

const DEFAULT_SELECTED_SHORTCUTS = ['crm', 'daily_logs', 'approval_inbox', 'create_invoice', 'products', 'projects'];

interface CustomizableShortcutsProps {
  user: User;
  userPermissions?: { permissions?: string[]; isAdmin?: boolean };
}

export function CustomizableShortcuts({ user, userPermissions }: CustomizableShortcutsProps) {
  const navigate = useNavigate();
  const isAdmin = Boolean(userPermissions?.isAdmin || user?.role === 'admin');

  const checkPermission = (required?: string | string[]) => {
    if (isAdmin || !required) return true;
    const perms = Array.isArray(userPermissions?.permissions) ? userPermissions.permissions : [];
    if (Array.isArray(required)) {
      return required.some((p) => perms.includes(p));
    }
    return perms.includes(required);
  };

  // Filter shortcuts allowed for this specific user
  const accessibleShortcuts = useMemo(() => {
    return ALL_SHORTCUTS.filter((s) => checkPermission(s.requiredPerm));
  }, [userPermissions, isAdmin]);

  const storageKey = `user_shortcuts_${user?.id || 'default'}`;

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load shortcuts:', e);
    }
    return DEFAULT_SELECTED_SHORTCUTS;
  });

  const [isCustomizeOpen, setIsCustomizeOpen] = useState<boolean>(false);
  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([]);

  const activeShortcuts = useMemo(() => {
    const valid = accessibleShortcuts.filter((s) => selectedIds.includes(s.id));
    return valid.length > 0 ? valid : accessibleShortcuts.slice(0, 6);
  }, [accessibleShortcuts, selectedIds]);

  const handleOpenCustomize = () => {
    setTempSelectedIds([...selectedIds]);
    setIsCustomizeOpen(true);
  };

  const handleToggleShortcut = (id: string) => {
    setTempSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSaveCustomize = () => {
    const toSave = tempSelectedIds.length > 0 ? tempSelectedIds : DEFAULT_SELECTED_SHORTCUTS;
    setSelectedIds(toSave);
    try {
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save shortcuts:', e);
    }
    setIsCustomizeOpen(false);
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            <span>⚡ دسترسی‌های سریع و میز کار من</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">میانبرهای پرکاربرد سفارشی‌شده مطابق دسترسی‌های شغلی شما</p>
        </div>

        <button
          onClick={handleOpenCustomize}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50/70 text-xs font-bold transition-all shadow-2xs"
          title="تغییر میانبرهای میز کار"
        >
          <Settings2 size={14} />
          <span>سفارشی‌سازی میانبرها</span>
        </button>
      </div>

      {/* Grid of Active Shortcuts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {activeShortcuts.map((shortcut) => {
          const IconComp = shortcut.icon;
          return (
            <button
              key={shortcut.id}
              onClick={() => navigate(shortcut.path)}
              className={`group p-3.5 rounded-2xl border transition-all text-right flex flex-col justify-between h-28 relative overflow-hidden ${shortcut.bgColor} ${shortcut.borderColor} hover:shadow-sm hover:-translate-y-0.5`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-9 h-9 rounded-xl bg-white/90 shadow-2xs flex items-center justify-center ${shortcut.color}`}>
                  <IconComp size={18} />
                </div>
                <ArrowUpRight size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <div>
                <h3 className="font-extrabold text-xs text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors">
                  {shortcut.title}
                </h3>
                <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">
                  {shortcut.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Customize Modal */}
      {isCustomizeOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Settings2 size={18} className="text-blue-600" />
                  انتخاب میانبرهای میز کار
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  بخش‌های مورد نظرتان را برای دسترسی فوری انتخاب کنید (بر اساس مجوزهای شما):
                </p>
              </div>
              <button
                onClick={() => setIsCustomizeOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl"
              >
                <X size={18} />
              </button>
            </div>

            {/* List of Available Shortcuts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 overflow-y-auto flex-1 p-1">
              {accessibleShortcuts.map((s) => {
                const IconComp = s.icon;
                const isChecked = tempSelectedIds.includes(s.id);
                return (
                  <div
                    key={s.id}
                    onClick={() => handleToggleShortcut(s.id)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isChecked
                        ? 'bg-blue-50/70 border-blue-300 text-blue-900 shadow-2xs'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-2xs ${s.color}`}>
                        <IconComp size={16} />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold truncate">{s.title}</p>
                        <p className="text-[10px] text-slate-500 truncate">{s.description}</p>
                      </div>
                    </div>

                    <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-colors shrink-0 ${
                      isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-white'
                    }`}>
                      {isChecked && <Check size={12} strokeWidth={3} />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {tempSelectedIds.length} مورد انتخاب شده
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCustomizeOpen(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-600"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={handleSaveCustomize}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                >
                  ذخیره میانبرها
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
