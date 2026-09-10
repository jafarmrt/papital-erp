import React from 'react';
import { Zap, ShieldCheck } from 'lucide-react';
import { User } from '../types';
import { DomainEventsTab } from '../components/settings/DomainEventsTab';

interface DomainEventsPageProps {
  currentUser: User;
}

export default function DomainEventsPage({ currentUser }: DomainEventsPageProps) {
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
    return (
      <div className="p-12 text-center text-slate-500 font-farsi">
        <div className="inline-flex p-4 bg-red-50 text-red-600 rounded-full mb-3">
          <Zap size={32} />
        </div>
        <h2 className="text-lg font-bold text-slate-800">عدم دسترسی به این بخش</h2>
        <p className="text-sm text-slate-500 mt-1">مشاهده و مدیریت رویدادهای سازمانی نیازمند دسترسی مدیریت سیستم می‌باشد.</p>
      </div>
    );
  }

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
              <h1 className="text-xl font-bold text-slate-800">رویدادها و اتوماسیون سازمانی</h1>
            </div>
            <p className="text-slate-500 text-xs mt-1">
              مدیریت رویدادهای سیستمی، قوانین واکنش خودکار، صف خطاهای قرنطینه، بازپخش رویدادها و وب‌هوک‌های ارتباطی
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
          <ShieldCheck size={15} className="text-emerald-600" />
          <span>سیستم مدیریت رویدادهای سازمانی</span>
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
