import { useState } from 'react';
import { Inbox, AlertOctagon, History, Globe, Database, Sliders, Zap, type LucideIcon } from 'lucide-react';
import { AutoActionsSubTab } from './AutoActionsSubTab';
import { DeadLetterQueueSubTab } from './DeadLetterQueueSubTab';
import { EventSourcingReplaySubTab } from './EventSourcingReplaySubTab';
import { WebhookManagementSubTab } from './WebhookManagementSubTab';
import { OutboxSubTab } from './OutboxSubTab';
import { LiveEventsSubTab } from './LiveEventsSubTab';
import { useHasPermission } from '../../contexts/AuthContext';
import { NoticeBanner, type EventNotice } from './eventMonitorShared';

type SubTab = 'rules' | 'outbox' | 'dlq' | 'replay' | 'webhooks' | 'events';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon; iconClass?: string; activeText: string }[] = [
  { id: 'rules', label: 'عملیات و قوانین خودکار', icon: Sliders, activeText: 'text-indigo-600 dark:text-indigo-400' },
  { id: 'outbox', label: 'صف ارسال رویداد', icon: Inbox, activeText: 'text-indigo-600 dark:text-indigo-400' },
  { id: 'dlq', label: 'صف خطا', icon: AlertOctagon, iconClass: 'text-rose-500', activeText: 'text-rose-600 dark:text-rose-400' },
  { id: 'replay', label: 'خط زمان و بازپخش رویدادها', icon: History, iconClass: 'text-indigo-500', activeText: 'text-indigo-600 dark:text-indigo-400' },
  { id: 'webhooks', label: 'اشتراک‌ها و وب‌هوک‌ها', icon: Globe, iconClass: 'text-purple-500', activeText: 'text-indigo-600 dark:text-indigo-400' },
  { id: 'events', label: 'گذرگاه رویدادهای زنده', icon: Zap, activeText: 'text-indigo-600 dark:text-indigo-400' },
];

/**
 * The events page. 10.3 package 6 (package-2 leftover): the outbox monitor and the live events bus are their own
 * components (`OutboxSubTab`, `LiveEventsSubTab`), mounted only while shown, so each visit is an opening that reads again
 * and never shows the previous visit's data (the page was 690 lines, over the size cap).
 */
export function DomainEventsTab() {
  // v9.0.435 (TD-722): every change in this page asks events.manage on the server, so only its holders see the buttons
  const canManage = useHasPermission('events.manage');
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('rules');
  const [notice, setNotice] = useState<EventNotice | null>(null);
  const showNotice = (next: EventNotice) => {
    setNotice(next);
    // a later notice is not cut short by the timer of an earlier one
    setTimeout(() => setNotice(shown => (shown === next ? null : shown)), 4500);
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-tab Switcher */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                رویدادها، اقدام‌های خودکار و صف ارسال رویداد
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                مدیریت قانون‌های واکنش خودکار به رویدادها، ثبت رویداد در همان تراکنش سند و گذرگاه رویدادهای زنده
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/60 p-1.5 rounded-xl border border-slate-200 dark:border-slate-600 flex-wrap">
          {SUB_TABS.map(({ id, label, icon: Icon, iconClass, activeText }) => (
            <button
              key={id}
              onClick={() => setActiveSubTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeSubTab === id ? `bg-white dark:bg-slate-800 ${activeText} shadow-xs` : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${iconClass ?? ''}`} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {notice && <NoticeBanner notice={notice} />}
      {activeSubTab === 'rules' && <AutoActionsSubTab />}
      {activeSubTab === 'outbox' && <OutboxSubTab canManage={canManage} onNotice={showNotice} />}
      {activeSubTab === 'events' && <LiveEventsSubTab canManage={canManage} />}
      {activeSubTab === 'dlq' && <DeadLetterQueueSubTab />}
      {activeSubTab === 'replay' && <EventSourcingReplaySubTab />}
      {activeSubTab === 'webhooks' && <WebhookManagementSubTab />}
    </div>
  );
}
