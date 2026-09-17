import { useEffect } from 'react';
import { Search, X, Calendar as CalendarIcon, BarChart3 } from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";

import { User } from '../types';
import { formatPersianNumber, getTodayJalaliDate, extractDateString } from '../utils';
import { useAuth } from '../contexts/AuthContext';
import { useDailyLogs } from '../hooks/useDailyLogs';
import { DailyLogStatsCards } from '../components/daily-logs/DailyLogStatsCards';
import { DailyLogsList } from '../components/daily-logs/DailyLogsList';
import { DailyLogSummaryView } from '../components/daily-logs/DailyLogSummaryView';
import { DailyLogModal } from '../components/daily-logs/DailyLogModal';
import { DailyLogReviewModal } from '../components/daily-logs/DailyLogReviewModal';

interface DailyLogsPageProps {
  user: User;
}

export default function DailyLogsPage({ user }: DailyLogsPageProps) {
  const dl = useDailyLogs(user);
  const { userPermissions } = useAuth();

  // گزارش تجمیعی مدیریت: فقط ادمین یا دارای مجوز daily_logs.manage_all
  const canViewSummary = Boolean(
    user.role === 'admin' ||
    userPermissions?.isAdmin ||
    (Array.isArray(userPermissions?.permissions) && userPermissions.permissions.includes('daily_logs.manage_all'))
  );

  // اگر تب تجمیعی فعال بود ولی دسترسی وجود نداشت، به تب همه برگرد
  useEffect(() => {
    if (dl.activeTab === 'summary' && !canViewSummary) {
      dl.setActiveTab('all');
    }
  }, [dl.activeTab, canViewSummary]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12 font-farsi text-right">
      {/* Printable Report Header - Only visible when printing */}
      <div className="hidden print:block mb-6 p-4 border-b-2 border-slate-900 text-right">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900">گزارش کارکرد و فعالیت‌های روزانه</h1>
            <p className="text-xs text-slate-600 mt-1">سامانه جامع ERP و مدیریت تولید کارگاهی</p>
          </div>
          <div className="text-left text-xs font-semibold text-slate-700">
            <p>کاربر / همکار: {user.full_name || user.username}</p>
            <p>تاریخ خروجی: {getTodayJalaliDate()}</p>
            <p>تعداد گزارش‌ها: {formatPersianNumber(dl.logs.length)} مورد</p>
          </div>
        </div>
      </div>

      {/* Header & Stats Cards */}
      <DailyLogStatsCards
        user={user}
        stats={dl.stats}
        onPrint={dl.handlePrintLogs}
        onOpenCreateModal={dl.handleOpenCreateModal}
      />

      {/* Tabs & Search Filter Bar */}
      <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-2xs space-y-3 print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl overflow-x-auto custom-scrollbar">
            <button
              onClick={() => dl.setActiveTab('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                dl.activeTab === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              همه گزارش‌های مجاز ({formatPersianNumber(dl.stats.total_logs)})
            </button>
            <button
              onClick={() => dl.setActiveTab('mine')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                dl.activeTab === 'mine'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              گزارش‌های من ({formatPersianNumber(dl.stats.my_total_logs)})
            </button>
            <button
              onClick={() => dl.setActiveTab('mentioned')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                dl.activeTab === 'mentioned'
                  ? 'bg-white text-amber-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              منشن‌شده‌های من ({formatPersianNumber(dl.stats.my_mentions_count)})
            </button>
            {canViewSummary && (
              <button
                onClick={() => dl.setActiveTab('summary')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  dl.activeTab === 'summary'
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-xs'
                    : 'text-indigo-600 hover:bg-indigo-50 border border-indigo-200/60'
                }`}
                title="فقط مدیر سیستم یا کاربران دارای مجوز daily_logs.manage_all"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                گزارش تجمیعی مدیریت
              </button>
            )}
          </div>

          {/* Persian Jalali Date Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 flex items-center gap-1 whitespace-nowrap">
              <CalendarIcon className="w-3.5 h-3.5 text-blue-600" />
              فیلتر تاریخ شمسی:
            </span>
            <DatePicker
              value={dl.selectedDateFilter}
              onChange={(dateObj: any) => {
                dl.setSelectedDateFilter(extractDateString(dateObj));
              }}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              placeholder="انتخاب تاریخ شمسی..."
              inputClass="w-36 px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white text-slate-700 text-center font-bold"
            />
            {dl.selectedDateFilter && (
              <button
                onClick={() => dl.setSelectedDateFilter(null)}
                className="text-[11px] font-bold text-rose-500 hover:underline cursor-pointer"
              >
                پاکسازی
              </button>
            )}
          </div>
        </div>

        {/* Search & Mode Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="جستجو در عنوان، شرح فعالیت، نام همکار یا برچسب‌ها..."
              value={dl.searchQuery}
              onChange={(e) => dl.setSearchQuery(e.target.value)}
              className="w-full pr-9 pl-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-hidden focus:border-blue-500 transition-all"
            />
            {dl.searchQuery && (
              <button
                onClick={() => dl.setSearchQuery('')}
                className="absolute left-3 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={dl.selectedWorkMode}
            onChange={(e) => dl.setSelectedWorkMode(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:bg-white cursor-pointer"
          >
            <option value="">همه حالت‌های کاری</option>
            <option value="onsite">🏢 حضوری</option>
            <option value="remote">🏠 دورکاری</option>
          </select>
        </div>
      </div>

      {/* Main Tab Content */}
      {dl.activeTab === 'summary' ? (
        <DailyLogSummaryView
          summaryMode={dl.summaryMode}
          setSummaryMode={dl.setSummaryMode}
          summaryDateFilter={dl.summaryDateFilter}
          setSummaryDateFilter={dl.setSummaryDateFilter}
          summaryYear={dl.summaryYear}
          setSummaryYear={dl.setSummaryYear}
          summaryMonth={dl.summaryMonth}
          setSummaryMonth={dl.setSummaryMonth}
          summarySelectedUserId={dl.summarySelectedUserId}
          setSummarySelectedUserId={dl.setSummarySelectedUserId}
          summaryReportData={dl.summaryReportData}
          summaryLoading={dl.summaryLoading}
          systemUsers={dl.systemUsers}
          selectedUserLogsModal={dl.selectedUserLogsModal}
          setSelectedUserLogsModal={dl.setSelectedUserLogsModal}
          onExportCSV={dl.handleExportSummaryCSV}
          onPrint={dl.handlePrintLogs}
        />
      ) : (
        <DailyLogsList
          logs={dl.logs}
          loading={dl.loading}
          page={dl.page}
          setPage={dl.setPage}
          limit={dl.limit}
          user={user}
          systemUsers={dl.systemUsers}
          onOpenCreateModal={dl.handleOpenCreateModal}
          onOpenEditModal={dl.handleOpenEditModal}
          onDeleteLog={dl.handleDeleteLog}
          onOpenReviewModal={dl.handleOpenReviewModal}
        />
      )}

      {/* Create / Edit Form Modal */}
      <DailyLogModal
        isModalOpen={dl.isModalOpen}
        onClose={() => dl.setIsModalOpen(false)}
        editingLog={dl.editingLog}
        formDate={dl.formDate}
        setFormDate={dl.setFormDate}
        formStartTime={dl.formStartTime}
        setFormStartTime={dl.setFormStartTime}
        formEndTime={dl.formEndTime}
        setFormEndTime={dl.setFormEndTime}
        formWorkMode={dl.formWorkMode}
        setFormWorkMode={dl.setFormWorkMode}
        formTitle={dl.formTitle}
        setFormTitle={dl.setFormTitle}
        formContent={dl.formContent}
        setFormContent={dl.setFormContent}
        formProjectId={dl.formProjectId}
        setFormProjectId={dl.setFormProjectId}
        formVisibility={dl.formVisibility}
        setFormVisibility={dl.setFormVisibility}
        formMentions={dl.formMentions}
        setFormMentions={dl.setFormMentions}
        formTags={dl.formTags}
        tagInput={dl.tagInput}
        setTagInput={dl.setTagInput}
        currentFormHours={dl.currentFormHours}
        isSaving={dl.isSaving}
        user={user}
        systemUsers={dl.systemUsers}
        projects={dl.projects}
        onAddTag={dl.handleAddTag}
        onRemoveTag={dl.handleRemoveTag}
        onToggleMentionUser={dl.handleToggleMentionUser}
        onSaveLog={dl.handleSaveLog}
      />

      {/* Manager Review Modal */}
      <DailyLogReviewModal
        reviewModalLog={dl.reviewModalLog}
        onClose={() => dl.setReviewModalLog(null)}
        reviewNotes={dl.reviewNotes}
        setReviewNotes={dl.setReviewNotes}
        isSubmittingReview={dl.isSubmittingReview}
        onSaveReview={dl.handleSaveReview}
        systemUsers={dl.systemUsers}
      />
    </div>
  );
}
