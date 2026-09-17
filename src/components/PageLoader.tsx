import { Loader2 } from 'lucide-react';

export function PageLoader({ message = 'در حال بارگذاری صفحه...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] w-full py-12 px-4 animate-fadeIn" dir="rtl">
      <div className="relative flex items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-sm">
          <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
        </div>
      </div>
      <p className="mt-4 text-xs font-medium text-slate-500 tracking-wide">{message}</p>
    </div>
  );
}

export default PageLoader;
