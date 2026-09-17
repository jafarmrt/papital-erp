import { Calendar, Award, DollarSign, FileText, FolderKanban } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

export type PieceworkTabType = 'logs' | 'tasks' | 'rates' | 'payrolls' | 'project-costs';

interface PieceworkTabsNavProps {
  activeTab: PieceworkTabType;
  setActiveTab: (tab: PieceworkTabType) => void;
  logsCount: number;
  tasksCount: number;
  payrollsCount: number;
}

export function PieceworkTabsNav({
  activeTab,
  setActiveTab,
  logsCount,
  tasksCount,
  payrollsCount
}: PieceworkTabsNavProps) {
  const tabs = [
    {
      id: 'logs' as PieceworkTabType,
      label: 'کارکرد روزانه پرسنل',
      icon: Calendar,
      count: logsCount
    },
    {
      id: 'tasks' as PieceworkTabType,
      label: 'عناوین و نرخ پایه کارها',
      icon: Award,
      count: tasksCount
    },
    {
      id: 'rates' as PieceworkTabType,
      label: 'نرخ‌های اختصاصی پرسنل',
      icon: DollarSign
    },
    {
      id: 'payrolls' as PieceworkTabType,
      label: 'فیش‌های حقوقی و تسویه‌ها',
      icon: FileText,
      count: payrollsCount
    },
    {
      id: 'project-costs' as PieceworkTabType,
      label: 'بهای تمام‌شده دستمزد پروژه‌ها',
      icon: FolderKanban
    }
  ];

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 pb-1 overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
              isActive
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {formatPersianNumber(tab.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
