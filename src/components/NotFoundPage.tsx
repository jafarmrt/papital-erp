import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';

/**
 * v11 phase 6.3a (U12): an address the app has no page for shows this page instead of an empty content area. The look
 * follows the «عدم دسترسی» page of `ProtectedRoute`.
 */
export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 bg-white rounded-3xl border border-slate-200 shadow-sm max-w-md mx-auto mt-10">
      <div className="w-16 h-16 bg-slate-50 text-slate-500 rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
        <SearchX size={32} />
      </div>
      <h2 className="text-lg font-black text-slate-800 mb-2">این صفحه پیدا نشد</h2>
      <p className="text-xs text-slate-600 mb-6 leading-relaxed max-w-xs">
        نشانی واردشده در برنامه صفحه‌ای ندارد. از منو صفحهٔ مورد نظر را باز کنید.
      </p>
      <Link
        to="/"
        className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-slate-900/10"
      >
        بازگشت به پیشخوان
      </Link>
    </div>
  );
}

export default NotFoundPage;
