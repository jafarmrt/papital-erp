import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Target, Clock, AlertCircle, CheckCircle2, Phone, Calendar,
  UserCheck, ArrowLeft, Plus, ExternalLink, Sparkles, Filter, Search, X
} from 'lucide-react';
import { toPersianDigits, formatPersianPrice, getTodayJalaliDate } from '../../utils';
import { CRMLead, CRMActivity } from '../../types';

interface CRMTasksWidgetProps {
  leads: CRMLead[];
  activities: CRMActivity[];
  loading?: boolean;
  onRefresh?: () => void;
  onSelectLead?: (lead: CRMLead) => void;
}

export function CRMTasksWidget({
  leads = [],
  activities = [],
  loading = false,
  onRefresh,
  onSelectLead
}: CRMTasksWidgetProps) {
  const navigate = useNavigate();
  const todayJalali = getTodayJalaliDate();
  const [activeFilter, setActiveFilter] = useState<'today_overdue' | 'all_pending' | 'won_deals'>('today_overdue');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filter activities with followups
  const pendingFollowups = useMemo(() => {
    return activities
      .filter((act) => act.nextFollowUpDate && !act.isFollowUpCompleted && (act as any).isDeleted !== 1)
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''));
  }, [activities]);

  const todayAndOverdueFollowups = useMemo(() => {
    return pendingFollowups.filter((act) => {
      const d = act.nextFollowUpDate || '';
      return d <= todayJalali;
    });
  }, [pendingFollowups, todayJalali]);

  const wonLeads = useMemo(() => {
    return leads
      .filter((l) => l.stage === 'won')
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [leads]);

  // Search filtration
  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (activeFilter === 'won_deals') {
      if (!q) return wonLeads;
      return wonLeads.filter(
        (l) =>
          l.title?.toLowerCase().includes(q) ||
          l.customerName?.toLowerCase().includes(q) ||
          l.company?.toLowerCase().includes(q) ||
          l.assignedTo?.toLowerCase().includes(q)
      );
    }

    const baseList = activeFilter === 'today_overdue' ? todayAndOverdueFollowups : pendingFollowups;
    if (!q) return baseList;
    return baseList.filter(
      (act) =>
        act.title?.toLowerCase().includes(q) ||
        act.customerName?.toLowerCase().includes(q) ||
        (act as any).leadCustomerName?.toLowerCase().includes(q) ||
        act.nextFollowUpTask?.toLowerCase().includes(q) ||
        act.assignedTo?.toLowerCase().includes(q) ||
        act.loggedBy?.toLowerCase().includes(q)
    );
  }, [activeFilter, wonLeads, todayAndOverdueFollowups, pendingFollowups, searchQuery]);

  const totalCountForTab =
    activeFilter === 'today_overdue'
      ? todayAndOverdueFollowups.length
      : activeFilter === 'all_pending'
      ? pendingFollowups.length
      : wonLeads.length;

  return (
    <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold shrink-0">
            <Target size={18} />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
              <span>تسک‌ها و پیگیری‌های CRM و فروش</span>
              {todayAndOverdueFollowups.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">
                  {toPersianDigits(todayAndOverdueFollowups.length)} نیازمند اقدام
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">پیگیری مشتریان، تماس‌ها و جلسات کاری برنامه‌ریزی‌شده</p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={() => navigate('/crm')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold transition-colors"
          >
            <span>ورود به CRM</span>
            <ArrowLeft size={13} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-2xl mb-2.5 text-xs font-semibold">
        <button
          onClick={() => {
            setActiveFilter('today_overdue');
            setSearchQuery('');
          }}
          className={`flex-1 py-1.5 px-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeFilter === 'today_overdue'
              ? 'bg-white text-slate-900 shadow-xs font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock size={13} className={activeFilter === 'today_overdue' ? 'text-rose-500' : ''} />
          <span>امروز و معوق</span>
          <span className="text-[10px] px-1.5 py-0.2 bg-slate-200/80 rounded-full">
            {toPersianDigits(todayAndOverdueFollowups.length)}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveFilter('all_pending');
            setSearchQuery('');
          }}
          className={`flex-1 py-1.5 px-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeFilter === 'all_pending'
              ? 'bg-white text-slate-900 shadow-xs font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Target size={13} className={activeFilter === 'all_pending' ? 'text-blue-500' : ''} />
          <span>همه پیگیری‌ها</span>
          <span className="text-[10px] px-1.5 py-0.2 bg-slate-200/80 rounded-full">
            {toPersianDigits(pendingFollowups.length)}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveFilter('won_deals');
            setSearchQuery('');
          }}
          className={`flex-1 py-1.5 px-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeFilter === 'won_deals'
              ? 'bg-white text-slate-900 shadow-xs font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles size={13} className={activeFilter === 'won_deals' ? 'text-emerald-500' : ''} />
          <span>معاملات موفق</span>
          <span className="text-[10px] px-1.5 py-0.2 bg-slate-200/80 rounded-full">
            {toPersianDigits(wonLeads.length)}
          </span>
        </button>
      </div>

      {/* Search Bar when items > 3 */}
      {totalCountForTab > 3 && (
        <div className="relative mb-2.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجو در نام مشتری، عنوان یا اقدام بعدی..."
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-1 focus:ring-rose-400 text-slate-700"
          />
          <Search size={13} className="absolute right-2.5 top-2.5 text-slate-400" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* List content with scrollbar */}
      <div className="flex-1 overflow-y-auto space-y-2.5 max-h-72 sm:max-h-80 pr-1">
        {loading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : activeFilter === 'today_overdue' && todayAndOverdueFollowups.length === 0 ? (
          <div className="text-center py-8 px-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-2">
              <CheckCircle2 size={20} />
            </div>
            <p className="text-xs font-bold text-emerald-800">هیچ پیگیری معوق یا فوری برای امروز ندارید!</p>
            <p className="text-[11px] text-emerald-600 mt-1">همه تماس‌ها و وظایف CRM به‌موقع انجام شده‌اند. خدا قوت! 🌟</p>
          </div>
        ) : activeFilter === 'all_pending' && pendingFollowups.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-2xl">
            هیچ پیگیری فعالی در صف CRM ثبت نشده است.
          </div>
        ) : activeFilter === 'won_deals' && wonLeads.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-2xl">
            هنوز معامله موفقی ثبت نشده است.
          </div>
        ) : displayedItems.length === 0 && searchQuery ? (
          <div className="text-center py-6 text-slate-400 text-xs bg-slate-50 rounded-2xl">
            موردی مطابق با عبارت «{searchQuery}» پیدا نشد.
          </div>
        ) : activeFilter === 'won_deals' ? (
          (displayedItems as CRMLead[]).map((lead) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/crm?leadId=${lead.id}`)}
              className="p-3 bg-emerald-50/60 hover:bg-emerald-100/80 border border-emerald-200/80 rounded-2xl transition-all cursor-pointer flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <h4 className="font-bold text-xs text-slate-800 truncate">{lead.title}</h4>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  مشتری: {lead.customerName || lead.company || '—'}
                </p>
              </div>
              <div className="text-left shrink-0">
                <span className="text-xs font-black text-emerald-700">
                  {formatPersianPrice(lead.estimatedValue, lead.currency)}
                </span>
                <span className="block text-[9px] text-slate-400 mt-0.5">مسئول: {lead.assignedTo || '—'}</span>
              </div>
            </div>
          ))
        ) : (
          (displayedItems as CRMActivity[]).map((act) => {
            const isOverdue = (act.nextFollowUpDate || '') < todayJalali;
            const isToday = (act.nextFollowUpDate || '') === todayJalali;

            return (
              <div
                key={act.id}
                onClick={() => navigate(`/crm?leadId=${act.leadId || ''}`)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  isOverdue
                    ? 'bg-rose-50/70 border-rose-200/80 hover:bg-rose-100/80'
                    : isToday
                    ? 'bg-amber-50/70 border-amber-200/80 hover:bg-amber-100/80'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isOverdue ? 'bg-rose-500' : isToday ? 'bg-amber-500' : 'bg-blue-500'
                        }`}
                      />
                      <h4 className="font-bold text-xs text-slate-800 truncate">{act.title}</h4>
                    </div>
                    {act.nextFollowUpTask && (
                      <p className="text-[11px] text-slate-600 font-medium mt-1 truncate">
                        📝 اقدام بعدی: {act.nextFollowUpTask}
                      </p>
                    )}
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold shrink-0 ${
                      isOverdue
                        ? 'bg-rose-200/80 text-rose-800'
                        : isToday
                        ? 'bg-amber-200/80 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isOverdue ? 'معوق' : isToday ? 'امروز' : toPersianDigits(act.nextFollowUpDate || '')}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-200/60">
                  <span className="truncate">
                    مشتری: {act.customerName || (act as any).leadCustomerName || '—'}
                  </span>
                  <span className="shrink-0 font-medium">مسئول: {act.assignedTo || act.loggedBy || '—'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer counter and quick link */}
      {totalCountForTab > 0 && (
        <div className="pt-2.5 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            نمایش {toPersianDigits(displayedItems.length)} از {toPersianDigits(totalCountForTab)} مورد
          </span>
          <button
            onClick={() => navigate('/crm')}
            className="text-rose-600 hover:text-rose-800 font-bold flex items-center gap-1"
          >
            <span>مدیریت کامل در CRM</span>
            <ArrowLeft size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
