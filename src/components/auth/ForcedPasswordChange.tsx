import UserProfileModal from '../UserProfileModal';
import type { User } from '../../types';

interface ForcedPasswordChangeProps {
  user: User;
  onLogout: () => void;
  onUserUpdate: (updatedUser: User) => void;
  roleName?: string;
}

/**
 * v9.0.219 (TD-523، تصمیم ت۵ الف): کاربری که رمز موقت مدیر را دارد جز برگه تغییر رمز چیزی نمی‌بیند؛ منو، نوار بالا و
 * صفحه‌ها بار نمی‌شوند (سرور هم درخواست‌های دیگر را رد می‌کند). پس از تغییر رمز، `onUserUpdate` کاربر را بی پرچم
 * برمی‌گرداند و برنامه باز می‌شود؛ تنها راه دیگر «خروج» است.
 */
export function ForcedPasswordChange({ user, onLogout, onUserUpdate, roleName }: ForcedPasswordChangeProps) {
  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      <UserProfileModal
        user={user}
        isOpen
        onClose={() => undefined}
        onUserUpdate={onUserUpdate}
        roleName={roleName}
        onLogout={onLogout}
      />
    </div>
  );
}

export default ForcedPasswordChange;
