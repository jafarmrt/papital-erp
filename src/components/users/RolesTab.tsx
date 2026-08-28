import React from 'react';
import { Role, User } from '../../types';
import { Plus, Trash2, Edit2, Users, Check, ShieldCheck } from 'lucide-react';
import { MenuVisibilityPanel } from './MenuVisibilityPanel';

interface RolesTabProps {
  rolesList: Role[];
  users: User[];
  totalCatalogPermsCount: number;
  onAddRole: () => void;
  onEditRole: (role: Role) => void;
  onDeleteRole: (roleId: number, roleName: string) => void;
}

export const RolesTab: React.FC<RolesTabProps> = ({
  rolesList,
  users,
  totalCatalogPermsCount,
  onAddRole,
  onEditRole,
  onDeleteRole,
}) => {
  return (
    <div className="space-y-6">
      {/* کنترل نمایش منو برای هر نقش */}
      <MenuVisibilityPanel />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white border rounded-xl p-4 shadow-sm">
        <div>
          <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
            🛡️ نقش‌های تعریف‌شده سیستم
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            امکان تعریف نقش‌های جدید انبارداری، تولید، حسابداری، فروش و تنظیم دقیق ماتریس دسترسی‌ها
          </p>
        </div>
        <button
          onClick={onAddRole}
          className="px-3.5 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm shrink-0"
        >
          <Plus size={16} /> تعریف نقش جدید
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(!Array.isArray(rolesList) || rolesList.length === 0) && (
          <div className="col-span-full bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
              <ShieldCheck size={26} />
            </div>
            <h4 className="font-bold text-sm text-slate-700">هنوز نقشی تعریف نشده است</h4>
            <p className="text-xs text-slate-500 max-w-xs">
              برای کنترل دقیق دسترسی کاربران، اولین نقش سفارشی خود را با انتخاب کلیدهای مجاز ایجاد کنید.
            </p>
            <button
              onClick={onAddRole}
              className="mt-1 px-4 py-2 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus size={15} /> تعریف اولین نقش
            </button>
          </div>
        )}
        {rolesList.map((r) => {
          const permCount = Array.isArray(r.permissions) ? r.permissions.length : 0;
          const isSys = r.isSystem === 1 || r.code === 'admin';
          const userCountWithRole = users.filter((u) => u.role === r.code).length;

          return (
            <div
              key={r.id}
              className="bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-base text-slate-800 flex items-center gap-2">
                    {r.name}
                  </h4>
                  {isSys ? (
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[11px] font-medium">
                      سیستمی
                    </span>
                  ) : (
                    <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[11px] font-medium">
                      سفارشی
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-slate-400 mb-2" dir="ltr">
                  code: {r.code}
                </p>
                <p className="text-xs text-slate-600 line-clamp-2 min-h-[32px]">
                  {r.description || 'بدون توضیحات'}
                </p>
              </div>

              <div className="space-y-3 pt-3 border-t">
                <div className="flex justify-between items-center text-xs text-slate-500">
                  <span className="flex items-center gap-1 font-medium">
                    <Users size={14} className="text-blue-500" /> {userCountWithRole} کاربر فعال
                  </span>
                  <span className="text-slate-500 font-medium flex items-center gap-1">
                    <Check size={14} className="text-emerald-600" />
                    {r.code === 'admin'
                      ? 'دسترسی نامحدود'
                      : `${permCount} از ${totalCatalogPermsCount} کلید`}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => onEditRole(r)}
                    className="flex-1 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md font-medium text-xs transition-colors flex items-center justify-center gap-1"
                  >
                    <Edit2 size={13} /> ماتریس دسترسی
                  </button>
                  {!isSys && (
                    <button
                      onClick={() => onDeleteRole(r.id, r.name)}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                      title="حذف نقش"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
