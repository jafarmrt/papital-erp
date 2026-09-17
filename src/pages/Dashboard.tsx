import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCRMData } from '../hooks/useCRMData';
import { useDailyLogs } from '../hooks/useDailyLogs';
import { PersonalBanner } from '../components/dashboard/PersonalBanner';
import { CustomizableShortcuts } from '../components/dashboard/CustomizableShortcuts';
import { InteractiveJalaliCalendar, CalendarEventItem } from '../components/dashboard/InteractiveJalaliCalendar';
import { CRMTasksWidget } from '../components/dashboard/CRMTasksWidget';
import { DailyLogsMentionsWidget } from '../components/dashboard/DailyLogsMentionsWidget';
import { Warehouse, ArrowLeft, Sparkles } from 'lucide-react';
import { toEnglishDigits } from '../utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, userPermissions, logout } = useAuth();

  // Load CRM Data (Leads, Activities, Follow-ups)
  const {
    leads,
    activities,
    loading: crmLoading,
    loadAllData: fetchCRMData
  } = useCRMData(user);

  // Load Daily Logs and Mentions Data
  const {
    logs: dailyLogs,
    stats: dailyStats,
    loading: logsLoading,
  } = useDailyLogs(user as any);

  const hasCrmPermission = Boolean(
    userPermissions?.isAdmin ||
    user?.role === 'admin' ||
    Array.isArray(userPermissions?.permissions) && userPermissions.permissions.includes('crm.view')
  );

  // Convert CRM activities and Daily Logs into Calendar Event items
  const calendarEvents = useMemo<CalendarEventItem[]>(() => {
    const items: CalendarEventItem[] = [];

    // CRM Follow-ups (Only if user has CRM permission)
    if (hasCrmPermission && Array.isArray(activities)) {
      activities.forEach((act) => {
        if (act.nextFollowUpDate) {
          items.push({
            id: `crm-act-${act.id}`,
            title: act.title || 'پیگیری CRM',
            date: toEnglishDigits(act.nextFollowUpDate).replace(/-/g, '/'),
            type: 'crm_followup',
            customerName: act.customerName || '',
            assignedTo: act.assignedTo || '',
            raw: act
          });
        }
      });
    }

    // CRM Leads with expected close dates (Only if user has CRM permission)
    if (hasCrmPermission && Array.isArray(leads)) {
      leads.forEach((lead) => {
        if (lead.expectedCloseDate && lead.stage !== 'won' && lead.stage !== 'lost') {
          items.push({
            id: `crm-lead-${lead.id}`,
            title: `سررسید معامله: ${lead.title}`,
            date: toEnglishDigits(lead.expectedCloseDate).replace(/-/g, '/'),
            type: 'crm_close',
            customerName: lead.customerName || lead.company || '',
            assignedTo: lead.assignedTo || '',
            raw: lead
          });
        }
      });
    }

    // Daily work logs
    if (Array.isArray(dailyLogs)) {
      dailyLogs.slice(0, 50).forEach((log) => {
        const d = log.date;
        if (d && typeof d === 'string') {
          items.push({
            id: `log-${log.id}`,
            title: `گزارش کار: ${log.userFullName || log.username || 'همکار'}`,
            date: toEnglishDigits(d).replace(/-/g, '/'),
            type: 'daily_log',
            assignedTo: log.userFullName || log.username || '',
            raw: log
          });
        }
      });
    }

    return items;
  }, [activities, leads, dailyLogs, hasCrmPermission]);

  const handleCalendarEventClick = (event: CalendarEventItem) => {
    if (event.type === 'crm_followup' || event.type === 'crm_close') {
      const leadId = event.raw?.leadId || event.raw?.id;
      navigate(`/crm${leadId ? `?leadId=${leadId}` : ''}`);
    } else if (event.type === 'daily_log') {
      navigate('/daily-logs');
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* 1. Personalized Motivational & Well-being Banner */}
      <PersonalBanner user={user} onLogout={logout} />

      {/* 2. Customizable Quick Shortcuts / User Workbench */}
      <CustomizableShortcuts user={user} userPermissions={userPermissions} />

      {/* 3. Main Dashboard Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right / Main Column: CRM Tasks (if authorized) & Daily Log Mentions (7 Cols on desktop) */}
        <div className="lg:col-span-7 space-y-6">
          {/* CRM Tasks & Followups Widget - ONLY rendered if user has CRM permission */}
          {hasCrmPermission && (
            <CRMTasksWidget
              leads={leads}
              activities={activities}
              loading={crmLoading}
              onRefresh={fetchCRMData}
            />
          )}

          {/* Daily Logs & Mentions Widget */}
          <DailyLogsMentionsWidget
            user={user}
            logs={dailyLogs}
            stats={dailyStats}
            loading={logsLoading}
          />
        </div>

        {/* Left Column: Interactive Jalali Calendar & Secondary Panels (5 Cols on desktop) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Interactive Jalali Calendar */}
          <div className="min-h-[440px]">
            <InteractiveJalaliCalendar
              events={calendarEvents}
              onEventClick={handleCalendarEventClick}
            />
          </div>

          {/* Warehouse BI & Analytics Quick Link Card */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-5 border border-slate-700/80 shadow-md flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
                <Warehouse size={22} />
              </div>
              <div className="truncate">
                <h3 className="text-sm font-extrabold text-white flex items-center gap-1.5">
                  <span>دیده‌بان وضعیت انبار و هوش تجاری</span>
                  <Sparkles size={13} className="text-amber-400" />
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                  مشاهده ارزش مالی انبار، آلارم‌های نقطه سفارش و تفکیک موجودی
                </p>
              </div>
            </div>

            <button
              onClick={() => navigate('/inventory-status')}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 shrink-0"
            >
              <span>مشاهده</span>
              <ArrowLeft size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
