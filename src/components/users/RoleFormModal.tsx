import React, { useState, useEffect, useMemo } from 'react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { Role, PermissionCategory } from '../../types';
import {
  ShieldCheck,
  Search,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';

export const ROLE_PRESETS = [
  {
    name: 'مدیر ارشد مالی (CFO)',
    code: 'cfo_accountant',
    description: 'دسترسی کامل به تمامی بخش‌های مالی و حسابداری، کدینگ حساب‌ها، اسناد دوبل، خزانه‌داری، چک صیادی و صورت‌های مالی',
    permissions: [
      'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
      'products.view', 'products.edit_price', 'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
      'customers.view', 'customers.manage', 'personnel.view', 'piecework.view', 'piecework.payroll', 'reports.view', 'audit_logs.view'
    ]
  },
  {
    name: 'حسابدار و مسئول اسناد مالی',
    code: 'accountant',
    description: 'مدیریت اسناد دوبل حسابداری، ثبت دفاتر، کدینگ، فاکتورهای خرید/فروش و تراز آزمایشی',
    permissions: [
      'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.reports',
      'documents.view', 'documents.create', 'documents.edit', 'products.view', 'products.edit_price',
      'customers.view', 'reports.view'
    ]
  },
  {
    name: 'خزانه‌دار و مسئول صندوق و چک',
    code: 'treasurer',
    description: 'مدیریت حساب‌های بانکی، تراکنش‌های خزانه‌داری (دریافت و پرداخت) و دفتر چک‌های صیادی',
    permissions: [
      'accounting.view', 'accounting.treasury', 'accounting.cheques',
      'documents.view', 'customers.view'
    ]
  },
  {
    name: 'مدیر تولید و کارگاه',
    code: 'production_manager',
    description: 'دسترسی کامل به پروژه‌ها، گانت، کانبان، کنترل مواد اولیه، گزارش کارهای روزانه و کار پرکیسی',
    permissions: [
      'projects.view', 'projects.create', 'projects.edit', 'products.view', 
      'warehouse.view', 'daily_logs.view', 'daily_logs.create', 'pending_materials.view',
      'piecework.view', 'piecework.log'
    ]
  },
  {
    name: 'سرپرست انبار و اقلام',
    code: 'warehouse_keeper',
    description: 'مدیریت موجودی، ثبت رسید و حواله، جابجایی، انبارگردانی و تایید مواد اولیه در انتظار',
    permissions: [
      'warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.transfer',
      'products.view', 'products.create', 'products.edit', 'audit.view', 'audit.create', 'audit.apply',
      'pending_materials.view', 'pending_materials.approve'
    ]
  },
  {
    name: 'کارشناس فروش و CRM',
    code: 'sales_agent',
    description: 'مدیریت مشتریان، فرصت‌های فروش CRM، پیش‌فاکتورها و مشاهده سفارشات ووکامرس',
    permissions: [
      'crm.view', 'crm.manage', 'customers.view', 'customers.manage', 
      'documents.view', 'documents.create', 'woocommerce.view'
    ]
  },
  {
    name: 'اپراتور و ثبت کارکرد کارگاه',
    code: 'workshop_operator',
    description: 'ثبت کارکرد پرکیسی پرسنل و درج گزارش کار روزانه کارگاه',
    permissions: [
      'piecework.view', 'piecework.log', 'daily_logs.view', 'daily_logs.create'
    ]
  }
];

interface RoleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingRole: Role | null;
  permCatalog: PermissionCategory[];
  onSuccess: () => void;
}

export const RoleFormModal: React.FC<RoleFormModalProps> = ({
  isOpen,
  onClose,
  editingRole,
  permCatalog,
  onSuccess,
}) => {
  const [roleForm, setRoleForm] = useState<{
    name: string;
    code: string;
    description: string;
    permissions: string[];
    isSystem: number;
  }>({
    name: '',
    code: '',
    description: '',
    permissions: [],
    isSystem: 0,
  });

  const [permSearch, setPermSearch] = useState('');
  const [permCategoryFilter, setPermCategoryFilter] = useState<string>('ALL');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = editingRole !== null;

  useEffect(() => {
    if (editingRole) {
      setRoleForm({
        name: editingRole.name || '',
        code: editingRole.code || '',
        description: editingRole.description || '',
        permissions: Array.isArray(editingRole.permissions) ? editingRole.permissions : [],
        isSystem: editingRole.isSystem || 0,
      });
    } else {
      setRoleForm({
        name: '',
        code: '',
        description: '',
        permissions: [],
        isSystem: 0,
      });
    }
  }, [editingRole, isOpen]);

  // Filtered Permission Catalog inside Modal
  const filteredCatalog = useMemo(() => {
    return permCatalog
      .map((cat) => {
        if (permCategoryFilter !== 'ALL' && cat.category !== permCategoryFilter) {
          return null;
        }
        const matchingPerms = cat.permissions.filter((p) => {
          if (!permSearch.trim()) return true;
          const q = permSearch.toLowerCase();
          return (
            p.title.toLowerCase().includes(q) ||
            p.key.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q)
          );
        });

        if (matchingPerms.length === 0) return null;
        return {
          ...cat,
          permissions: matchingPerms,
        };
      })
      .filter(Boolean) as PermissionCategory[];
  }, [permCatalog, permSearch, permCategoryFilter]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (isEditing) {
        await fetchJson(`/roles/${editingRole.id}`, {
          method: 'PUT',
          body: JSON.stringify(roleForm),
        });
        toast.success('نقش و ماتریس دسترسی با موفقیت بروزرسانی شد');
      } else {
        await fetchJson('/roles', {
          method: 'POST',
          body: JSON.stringify(roleForm),
        });
        toast.success('نقش جدید با موفقیت ایجاد شد');
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت نقش');
    } finally {
      setIsSaving(false);
    }
  };

  const applyRolePreset = (preset: typeof ROLE_PRESETS[0]) => {
    setRoleForm((prev) => ({
      ...prev,
      name: prev.name || preset.name,
      code: prev.code || preset.code,
      description: prev.description || preset.description,
      permissions: preset.permissions,
    }));
    toast.success(`قالب نقش "${preset.name}" با موفقیت جاگذاری شد`);
  };

  const togglePermission = (permKey: string) => {
    setRoleForm((prev) => {
      const exists = prev.permissions.includes(permKey);
      if (exists) {
        return { ...prev, permissions: prev.permissions.filter((k) => k !== permKey) };
      } else {
        return { ...prev, permissions: [...prev.permissions, permKey] };
      }
    });
  };

  const toggleCategoryPermissions = (categoryPerms: string[]) => {
    setRoleForm((prev) => {
      const allSelected = categoryPerms.every((k) => prev.permissions.includes(k));
      if (allSelected) {
        return { ...prev, permissions: prev.permissions.filter((k) => !categoryPerms.includes(k)) };
      } else {
        const set = new Set([...prev.permissions, ...categoryPerms]);
        return { ...prev, permissions: Array.from(set) };
      }
    });
  };

  const selectAllPermissions = () => {
    const allKeys = permCatalog.flatMap((c) => c.permissions.map((p) => p.key));
    setRoleForm((prev) => ({ ...prev, permissions: allKeys }));
  };

  const selectViewOnlyPermissions = () => {
    const viewKeys = permCatalog.flatMap((c) =>
      c.permissions.filter((p) => p.key.endsWith('.view')).map((p) => p.key)
    );
    setRoleForm((prev) => ({ ...prev, permissions: viewKeys }));
  };

  const clearAllPermissions = () => {
    setRoleForm((prev) => ({ ...prev, permissions: [] }));
  };

  const toggleCategoryCollapse = (categoryName: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [categoryName]: !prev[categoryName] }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-emerald-600" size={20} />
            <h3 className="font-bold text-slate-800">
              {isEditing
                ? `ویرایش نقش و ماتریس دسترسی: ${roleForm.name}`
                : 'تعریف نقش جدید و ماتریس دسترسی'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          <div className="p-5 border-b bg-slate-50/60 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  عنوان نقش (فارسی)
                </label>
                <input
                  required
                  type="text"
                  value={roleForm.name}
                  onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="مثال: کمک انباردار یا سرپرست فروش"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  کد نقش (شناسه انگلیسی)
                </label>
                <input
                  required={!isEditing}
                  disabled={isEditing}
                  type="text"
                  value={roleForm.code}
                  onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value })}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                  dir="ltr"
                  placeholder="e.g. warehouse_assistant"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                توضیحات شرح وظایف نقش
              </label>
              <input
                type="text"
                value={roleForm.description}
                onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="توضیح کوتاهی از حوزه مسئولیت و دسترسی‌های این نقش..."
              />
            </div>

            {/* Quick Presets row */}
            {roleForm.code !== 'admin' && (
              <div className="pt-2 border-t">
                <span className="text-[11px] font-bold text-slate-600 block mb-1.5 flex items-center gap-1">
                  <Sparkles size={13} className="text-amber-500" />
                  قالب‌های آماده نقش برای بارگذاری سریع:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applyRolePreset(p)}
                      className="text-[11px] px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 rounded-md transition-colors flex items-center gap-1"
                    >
                      <Layers size={12} /> {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* PERMISSION MATRIX SEARCH & ACTIONS */}
          <div className="p-4 border-b bg-white flex flex-col md:flex-row justify-between items-center gap-3">
            <div className="flex flex-1 items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 max-w-sm">
                <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  placeholder="جستجوی کلید یا عنوان مجوز..."
                  className="w-full pr-8 pl-3 py-1 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <select
                value={permCategoryFilter}
                onChange={(e) => setPermCategoryFilter(e.target.value)}
                className="text-xs border rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="ALL">همه بخش‌ها ({permCatalog.length})</option>
                {permCatalog.map((c, i) => (
                  <option key={i} value={c.category}>
                    {c.category}
                  </option>
                ))}
              </select>
            </div>

            {roleForm.code !== 'admin' && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={selectAllPermissions}
                  className="text-xs text-blue-700 hover:text-blue-900 bg-blue-50 px-2.5 py-1 rounded font-medium border border-blue-200"
                >
                  انتخاب همه
                </button>
                <button
                  type="button"
                  onClick={selectViewOnlyPermissions}
                  className="text-xs text-emerald-700 hover:text-emerald-900 bg-emerald-50 px-2.5 py-1 rounded font-medium border border-emerald-200"
                >
                  فقط مشاهده (.view)
                </button>
                <button
                  type="button"
                  onClick={clearAllPermissions}
                  className="text-xs text-slate-600 hover:text-slate-800 bg-slate-100 px-2.5 py-1 rounded font-medium border border-slate-200"
                >
                  پاکسازی
                </button>
              </div>
            )}
          </div>

          {/* PERMISSION MATRIX AREA */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {roleForm.code === 'admin' ? (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-xs text-purple-800 flex items-center gap-2">
                <Info size={18} className="shrink-0 text-purple-600" />
                <span>
                  نقش <strong>مدیر ارشد سیستم</strong> به صورت پیش‌فرض به تمامی بخش‌ها و قابلیت‌های فنی و مدیریتی برنامه دسترسی کامل و نامحدود دارد.
                </span>
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                هیچ مجوزی مطابق با عبارت جستجویافته پیدا نشد.
              </div>
            ) : (
              filteredCatalog.map((cat, idx) => {
                const catPermKeys = cat.permissions.map((p) => p.key);
                const allCatSelected =
                  catPermKeys.length > 0 &&
                  catPermKeys.every((k) => roleForm.permissions.includes(k));
                const isCollapsed = !!collapsedCategories[cat.category];

                return (
                  <div key={idx} className="border rounded-xl bg-slate-50/40 overflow-hidden shadow-2xs">
                    <div className="flex justify-between items-center p-3 border-b bg-slate-100/60">
                      <button
                        type="button"
                        onClick={() => toggleCategoryCollapse(cat.category)}
                        className="font-bold text-xs text-slate-800 flex items-center gap-2 hover:text-blue-600"
                      >
                        {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                        {cat.category} ({cat.permissions.length} کلید)
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleCategoryPermissions(catPermKeys)}
                        className={`text-[11px] font-medium px-2.5 py-0.5 rounded transition-colors ${
                          allCatSelected
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-white border text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {allCatSelected ? 'لغو این بخش' : 'انتخاب کامل بخش'}
                      </button>
                    </div>

                    {!isCollapsed && (
                      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {cat.permissions.map((p) => {
                          const isChecked = roleForm.permissions.includes(p.key);
                          return (
                            <label
                              key={p.key}
                              onClick={() => togglePermission(p.key)}
                              className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                                isChecked
                                  ? 'bg-blue-50/80 border-blue-300 text-slate-800 shadow-xs'
                                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}} // handled by label onClick
                                className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                              />
                              <div>
                                <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                                  {p.title}
                                  <span className="text-[10px] font-mono text-slate-400 font-normal">
                                    ({p.key})
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                                  {p.description}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* FOOTER */}
          <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
            <span className="text-xs text-slate-600">
              تعداد مجوزهای فعال:{' '}
              <strong className="text-slate-800 font-bold">
                {roleForm.code === 'admin'
                  ? 'تمامی مجوزهای سیستم'
                  : `${roleForm.permissions.length} کلید`}
              </strong>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-white transition-colors"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {isSaving ? 'در حال ذخیره‌سازی...' : 'ذخیره نقش و مجوزها'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
