import React, { useState, useEffect } from 'react';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { User, Role } from '../../types';

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingUser: User | null;
  rolesList: Role[];
  onSuccess: () => void;
}

export const UserFormModal: React.FC<UserFormModalProps> = ({
  isOpen,
  onClose,
  editingUser,
  rolesList,
  onSuccess,
}) => {
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'viewer',
  });
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = editingUser !== null;

  useEffect(() => {
    if (editingUser) {
      setUserForm({
        full_name: editingUser.full_name || '',
        username: editingUser.username || '',
        password: '',
        role: editingUser.role || 'viewer',
      });
    } else {
      setUserForm({
        username: '',
        password: '',
        full_name: '',
        role: rolesList[0]?.code || 'viewer',
      });
    }
  }, [editingUser, rolesList, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="admin">مدیر سیستم</option>
                {rolesList
                  .filter((r) => r.code !== 'admin')
                  .map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.name}
                    </option>
                  ))}
              </select>
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
