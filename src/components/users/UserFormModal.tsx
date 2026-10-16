import React, { useState, useEffect, useId } from 'react';
import { useRestoreUserMutation, useSaveUserMutation } from '../../hooks/queries/useUserQueries';
import { errorMessageOf } from '../../utils';
import { toast } from 'react-hot-toast';
import { User, Role } from '../../types';
import { isSystemAdminRole, SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog';
import { roleWithinGrant, type GrantorPermissions } from '../../lib/permissions/grantBoundary';
import { USERNAME_OF_DELETED_USER, deletedUserOf, deletedUsernameMessage, type DeletedUserMatch } from '../../lib/users/userRestore';
import { PASSWORD_LENGTH_HINT, passwordLengthError } from '../../lib/auth/passwordPolicy';
import { FULL_NAME_MAX_LENGTH } from '../../lib/users/profileFields';
import { DialogLayer } from '../common/DialogLayer';

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingUser: User | null;
  rolesList: Role[];
  onSuccess: () => void;
  /** v9.0.130 (TD-525، ت۳): مجوزهای کاربر جاری؛ فقط نقش‌هایی که همه مجوزهایشان را دارد پیشنهاد می‌شوند */
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
  const fieldId = useId();
  // v9.0.73 (TD-517): کاربر تازه نقش پیش‌گزیده ندارد؛ پیش‌تر نقش اول فهرست (مدیر سیستم) انتخاب می‌شد
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: '',
  });
  // OBS-R1-38: the writes go through React Query mutations, which refresh the users list
  const saveUserMutation = useSaveUserMutation();
  const restoreUserMutation = useRestoreUserMutation();
  const isSaving = saveUserMutation.isPending || restoreUserMutation.isPending;
  // v9.0.178 (TD-519، تصمیم ت۲ الف): نام کاربری کاربر حذف‌شده رد می‌شود و بازگرداندن همان کاربر اقدامی جداست
  const [deletedMatch, setDeletedMatch] = useState<DeletedUserMatch | null>(null);

  const isEditing = editingUser !== null;
  // v9.0.130 (TD-525، ت۳): کاربر غیرمدیر نقش حساب خودش را عوض نمی‌کند و فقط نقشی را می‌دهد که همه مجوزهایش را دارد
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
    setDeletedMatch(null);
  }, [editingUser, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.role) {
      toast.error('نقش کاربر را انتخاب کنید');
      return;
    }
    // v9.0.217 (TD-532): رمز تازه (و در ویرایش، اگر وارد شده) با همان کمینه مشترک سرور
    const passwordError = !isEditing || userForm.password ? passwordLengthError(userForm.password) : null;
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    try {
      const payload = {
        username: userForm.username.trim(),
        password: userForm.password,
        full_name: userForm.full_name.trim(),
        role: userForm.role,
      };

      await saveUserMutation.mutateAsync({ id: isEditing ? editingUser.id : null, payload });
      toast.success(isEditing ? 'اطلاعات کاربر با موفقیت ویرایش شد' : 'کاربر جدید با موفقیت ایجاد شد');
      onSuccess();
      onClose();
    } catch (err: any) {
      const match = !isEditing && err?.code === USERNAME_OF_DELETED_USER ? deletedUserOf(err?.details) : null;
      if (match) setDeletedMatch(match);
      else toast.error(err?.message || err?.error || 'خطا در ثبت کاربر');
    }
  };

  const deletedName = deletedMatch ? deletedMatch.fullName || deletedMatch.username : '';
  const handleRestore = async () => {
    if (!deletedMatch) return;
    if (!userForm.role || !userForm.password) {
      toast.error('برای بازگرداندن، نقش و رمز موقت را در همین فرم وارد کنید');
      return;
    }
    const passwordError = passwordLengthError(userForm.password);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    try {
      await restoreUserMutation.mutateAsync({ id: deletedMatch.id, role: userForm.role, password: userForm.password });
      toast.success(`کاربر «${deletedName}» بازگردانده شد؛ در ورود بعدی باید رمز موقت را عوض کند`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در بازگرداندن کاربر');
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <DialogLayer onClose={onClose} disabled={isSaving} />
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
            <label htmlFor={`${fieldId}-full_name`} className="block text-sm font-medium mb-1 text-slate-700">
              نام و نام خانوادگی
            </label>
            <input
              id={`${fieldId}-full_name`}
              required
              type="text"
              value={userForm.full_name}
              maxLength={FULL_NAME_MAX_LENGTH}
              onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="مثال: علی محمدی"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${fieldId}-username`} className="block text-sm font-medium mb-1 text-slate-700">
                نام کاربری (حساب)
              </label>
              <input
                id={`${fieldId}-username`}
                required={!isEditing}
                disabled={isEditing}
                type="text"
                value={userForm.username}
                onChange={(e) => { setUserForm({ ...userForm, username: e.target.value }); setDeletedMatch(null); }}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-left focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                dir="ltr"
                placeholder="مثلاً ali_rezaei"
              />
            </div>

            <div>
              <label htmlFor={`${fieldId}-role`} className="block text-sm font-medium mb-1 text-slate-700">
                نقش سیستم
              </label>
              <select
                id={`${fieldId}-role`}
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
            <label htmlFor={`${fieldId}-password`} className="block text-sm font-medium mb-1 text-slate-700">
              {isEditing
                ? 'کلمه عبور جدید (در صورت تمایل به تغییر)'
                : 'کلمه عبور ورود'}
            </label>
            <input
              id={`${fieldId}-password`}
              required={!isEditing}
              type="password"
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-left"
              dir="ltr"
              placeholder={isEditing ? 'برای عدم تغییر خالی بگذارید' : `رمز عبور کاربر، ${PASSWORD_LENGTH_HINT}`}
            />
          </div>

          {deletedMatch && (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
              <p>{deletedUsernameMessage(deletedName)}</p>
              <p>بازگرداندن، همان کاربر را با نام و سوابقش، با نقش این فرم و رمز این فرم به‌عنوان رمز موقت فعال می‌کند.</p>
              <button
                type="button"
                onClick={handleRestore}
                disabled={isSaving}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                بازگرداندن «{deletedName}»
              </button>
            </div>
          )}

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
