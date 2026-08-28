import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { User } from '../../types';

export interface ProtectedRouteProps {
  requiredPerm?: string | string[];
  userPermissions: { permissions: string[]; isAdmin: boolean; roleName?: string };
  permissionsLoaded: boolean;
  user: User;
  children: ReactNode;
}

export function ProtectedRoute({
  requiredPerm,
  userPermissions,
  permissionsLoaded,
  user,
  children
}: ProtectedRouteProps) {
  if (userPermissions?.isAdmin || user?.role === 'admin') {
    return <>{children}</>;
  }

  if (!permissionsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold">در حال بررسی سطوح دسترسی...</span>
        </div>
      </div>
    );
  }

  if (!requiredPerm) {
    return <>{children}</>;
  }

  const permArray = Array.isArray(requiredPerm) ? requiredPerm : [requiredPerm];
  const permissions = Array.isArray(userPermissions?.permissions) ? userPermissions.permissions : [];
  const hasAccess = permArray.some(p => permissions.includes(p));

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 bg-white rounded-3xl border border-slate-200 shadow-sm max-w-md mx-auto mt-10">
        <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mb-4 border border-rose-100 shadow-sm">
          <Lock size={32} />
        </div>
        <h2 className="text-lg font-black text-slate-800 mb-2">عدم دسترسی به این بخش</h2>
        <p className="text-xs text-slate-500 mb-6 leading-relaxed max-w-xs">
          حساب کاربری شما مجوز لازم جهت مشاهده این صفحه را ندارد. در صورت نیاز با مدیر ارشد سیستم جهت ارتقاء سطح دسترسی تماس بگیرید.
        </p>
        <Link
          to="/"
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-slate-900/10"
        >
          بازگشت به داشبورد اصلی
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

export default ProtectedRoute;
