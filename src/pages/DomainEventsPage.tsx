import { Zap, ShieldCheck } from 'lucide-react';
import { DomainEventsTab } from '../components/settings/DomainEventsTab';

/**
 * v9.0.435 (TD-722، B15-20): صفحه رویدادها را همان مجوز مسیر و API (`events.view`، `PAGE_ACCESS['/domain-events']`) باز
 * می‌کند و دکمه‌های تغییر فقط برای دارنده `events.manage` نشان داده می‌شوند؛ پیش‌تر صفحه با کد نقش (`admin` / `manager`)
 * گارد شده بود، پس دارنده `events.view` با نقش دیگر فهرست و مسیر را می‌دید و پیام «عدم دسترسی» می‌گرفت.
 */
export default function DomainEventsPage() {
  return (
    <div className="flex flex-col h-full bg-slate-50 font-farsi text-right">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl shadow-xs border border-amber-100">
            <Zap size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">رویدادها و خودکارسازی سازمانی</h1>
            </div>
            <p className="text-slate-500 text-xs mt-1">
              مدیریت رویدادهای سامانه، قاعده‌های واکنش خودکار، صف خطا، بازپخش رویدادها و وب‌هوک‌ها
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
          <ShieldCheck size={15} className="text-emerald-600" />
          <span>مدیریت رویدادهای سازمانی</span>
        </div>
      </div>

      {/* Content Body */}
      <div className="p-6 flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <DomainEventsTab />
        </div>
      </div>
    </div>
  );
}
