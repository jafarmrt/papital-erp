import React, { useState, useEffect } from 'react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { User, Role } from '../../types';
import { isSystemAdminRole, SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog';
import { roleWithinGrant, type GrantorPermissions } from '../../lib/permissions/grantBoundary';

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingUser: User | null;
  rolesList: Role[];
  onSuccess: () => void;
  /** v9.0.113 (TD-525، ت۳): مجوزهای کاربر جاری؛ فقط نقش‌هایی که همه مجوزهایشان را دارد پیشنهاد می‌شوند */
  grantor?: GrantorPermissions;
  currentUserId?: number;
}

export const UserFormModal: React.FC<UserFormModalProps> = ({
  isOpen,
  onClose,
  editingUser,
  rolesList,
  onSuccess,
  grantor = 'all',
  currentUserId,
}) => {
  // v9.0.73 (TD-517): کاربر تازه نقش پیش‌گزیده ندارد؛ پیش‌تر نقش اول فهرست (مدیر سیستم) انتخاب می‌شد
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = editingUser !== null;
  // v9.0.113 (TD-525، ت۳): کاربر غیرمدیر نقش حساب خودش را عوض نمی‌کند و فقط نقشی را می‌دهد که همه مجوزهایش را دارد
  const ownAccount = isEditing && grantor !== 'all' && currentUserId !== undefined && editingUser?.id === currentUserId;
  const assignableRoles = rolesList.filter((r) => !isSystemAdminRole(r.code) && roleWithinGrant(grantor, r));
  const currentRoleOutside = isEditing && userForm.role !== '' && !isSystemAdminRole(userForm.role)
    && !assignableRoles.some((r) => r.code === userForm.role);

  useEffect(() => {
    if (editingUser) {
      setUserForm({
        full_name: editingUser.full_name || '',
        username: editingUser.username || '',
        password: '',
        role: editingUser.role || '',
      });
    } else {
      setUserForm({
        username: '',
        password: '',
        full_name: '',
        role: '',
      });
    }
  }, [editingUser, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.role) {
      toast.error('نقش کاربر را انتخاب کنید');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        username: userForm.username.trim(),
        password: userForm.password,
        full_name: userForm.full_name.trim(),
        role: userForm.role,
      };

      if (isEditing) {
        await fetchJson(`/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success('اطلاعات کاربر با موفقیت ویرایش شد');
      } else {
        await fetchJson('/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('کاربر جدید با موفقیت ایجاد شد');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || err?.error || 'خطا در ثبت کاربر');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800">
            {isEditing ? 'ویرایش اطلاعات کاربر' : 'ثبت کاربر جدید'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">
              نام و نام خانوادگی
            </label>
            <input
              required
              type="text"
              value={userForm.full_name}
              onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="مثال: علی محمدی"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">
                نام کاربری (حساب)
              </label>
              <input
                required={!isEditing}
                disabled={isEditing}
                type="text"
                value={userForm.username}
                onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                dir="ltr"
                placeholder="e.g. user123"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-slate-700">
                نقش سیستم
              </label>
              <select
                required
                value={userForm.role}
                disabled={ownAccount}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="" disabled>
                  نقش را انتخاب کنید
                </option>
                {assignableRoles.map((r) => (
                  <option key={r.id} value={r.code}>
                    {r.name}
                  </option>
                ))}
                {currentRoleOutside && (
                  <option value={userForm.role} disabled>
                    {rolesList.find((r) => r.code === userForm.role)?.name ?? userForm.role}
                  </option>
                )}
                {(grantor === 'all' || isSystemAdminRole(userForm.role)) && (
                  <option value={SYSTEM_ADMIN_ROLE} disabled={grantor !== 'all'}>مدیر سیستم (دسترسی کامل)</option>
                )}
              </select>
              {ownAccount && (
                <p className="mt-1 text-xs text-slate-500">
                  نقش حساب خودتان را کاربر دیگری که «مدیریت کاربران» دارد عوض می‌کند.
                </p>
              )}
              {!ownAccount && grantor !== 'all' && (
                <p className="mt-1 text-xs text-slate-500">
                  فقط نقش‌هایی آمده‌اند که همه مجوزهایشان را خودتان دارید.
                </p>
              )}
              {isSystemAdminRole(userForm.role) && (
                <p className="mt-1 text-xs text-amber-700">
                  مدیر سیستم به همه بخش‌ها و تنظیمات دسترسی کامل دارد.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">
              {isEditing
                ? 'کلمه عبور جدید (در صورت تمایل به تغییر)'
                : 'کلمه عبور ورود'}
            </label>
            <input
              required={!isEditing}
              type="password"
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-left"
              dir="ltr"
              placeholder={isEditing ? 'برای عدم تغییر خالی بگذارید' : 'رمز عبور کاربر...'}
            />
          </div>

          <div className="pt-4 border-t flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-slate-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving
                ? 'در حال ثبت...'
                : isEditing
                ? 'ذخیره تغییرات'
                : 'ایجاد کاربر'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
