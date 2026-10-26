import { useState, useEffect, useCallback, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DAILY_LOG_VISIBILITY, type DailyLogVisibility } from '../lib/dailyLogs/dailyLogVisibility';
import { EMPTY_DAILY_LOG_STATS } from '../lib/dailyLogs/dailyLogStats';
import { workHoursBetween, workTimeError } from '../lib/dailyLogs/workHours';
import { SUMMARY_CSV_DOWNLOADED, buildSummaryCsv, summaryCsvFileName } from '../lib/dailyLogs/summaryCsv';
import { fetchJson } from '../api';
import { DailyWorkLog, User } from '../types';
import type { ProjectPick } from '../lib/permissions/pickLists';
import { QUERY_KEYS } from '../lib/queryKeys';
import { useDailyLogListQuery, useDailyLogStatsQuery, useDailyLogSummaryQuery } from './queries/useDailyLogQueries';
import { useProjectPickQuery } from './queries/useProjectQueries';
import { useSimpleUsersQuery } from './queries/useSimpleUsersQuery';
import { toast } from 'react-hot-toast';
import { getTodayJalaliDate, extractDateString, errorMessageOf, isoToJalaliDate } from '../utils';
import { confirmAction } from '../components/ConfirmDialogHost';
import { DAILY_LOG_TAGS_MAX } from '../lib/dailyLogs/dailyLogLimits';

export interface SimpleUserOption {
  id: number;
  username: string;
  full_name: string;
  /** v9.0.223 (TD-534): نام فارسی نقش، نه کد آن */
  role_name?: string;
  avatar_url?: string;
}

export function getFormattedDateString(dateObj: any): string {
  return extractDateString(dateObj);
}

const SEARCH_DEBOUNCE_MS = 300;
const NO_LOGS: DailyWorkLog[] = [];
const NO_USERS: SimpleUserOption[] = [];
const NO_PROJECTS: ProjectPick[] = [];

export function useDailyLogs(user: User) {
  const queryClient = useQueryClient();
  const limit = 30;

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'mentioned' | 'summary'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // v9.0.249 (TD-630): the search box asks the server only after typing pauses
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [selectedWorkMode, setSelectedWorkMode] = useState<string>('');
  const [selectedDateFilter, setSelectedDateFilter] = useState<any>(null);

  // a page belongs to its search conditions: a filter change starts again from page 1 with one request, never one for
  // the old page first
  const listFilterKey = JSON.stringify([activeTab, selectedWorkMode, getFormattedDateString(selectedDateFilter), debouncedSearch]);
  const [pageState, setPageState] = useState({ key: listFilterKey, page: 1 });
  const page = pageState.key === listFilterKey ? pageState.page : 1;
  const setPage = useCallback<Dispatch<SetStateAction<number>>>((next) => {
    setPageState((prev) => {
      const current = prev.key === listFilterKey ? prev.page : 1;
      return { key: listFilterKey, page: typeof next === 'function' ? next(current) : next };
    });
  }, [listFilterKey]);

  // Management Aggregated Summary States
  const todayParts = getTodayJalaliDate().split('/');
  const defaultYear = todayParts[0] || '1405';
  const defaultMonth = todayParts[1] || '05';

  const [summaryMode, setSummaryMode] = useState<'daily' | 'monthly'>('monthly');
  const [summaryDateFilter, setSummaryDateFilter] = useState<any>(getTodayJalaliDate());
  const [summaryYear, setSummaryYear] = useState<string>(defaultYear);
  const [summaryMonth, setSummaryMonth] = useState<string>(defaultMonth);
  const [summarySelectedUserId, setSummarySelectedUserId] = useState<string>('0');
  const [selectedUserLogsModal, setSelectedUserLogsModal] = useState<any | null>(null);

  // v10.2 package 11 part 5b (TD-1360, OBS-R2-102): the list, statistics, summary and pick lists come from React Query
  const onSummary = activeTab === 'summary';
  const listQuery = useDailyLogListQuery({
    filterType: onSummary ? 'all' : activeTab,
    page,
    limit,
    workMode: selectedWorkMode,
    date: getFormattedDateString(selectedDateFilter) || '',
    search: debouncedSearch,
  }, !onSummary);
  const statsQuery = useDailyLogStatsQuery();
  const summaryQuery = useDailyLogSummaryQuery<any>({
    mode: summaryMode,
    date: summaryMode === 'daily' ? (getFormattedDateString(summaryDateFilter) || getTodayJalaliDate()) : '',
    yearMonth: summaryMode === 'monthly' ? `${summaryYear}/${summaryMonth}` : '',
    userId: summarySelectedUserId,
  }, onSummary);
  const usersQuery = useSimpleUsersQuery();
  const projectsQuery = useProjectPickQuery();

  const logs = listQuery.data?.rows ?? NO_LOGS;
  // v9.0.249 (TD-630): the server pages the list; `total` is every log the filters match
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data ?? EMPTY_DAILY_LOG_STATS;
  const systemUsers = (usersQuery.data ?? NO_USERS) as SimpleUserOption[];
  const projects = projectsQuery.data ?? NO_PROJECTS;
  // the first load and a new page or filter show the loading state; a refresh in the background does not
  const loading = listQuery.isPending || listQuery.isPlaceholderData;
  const summaryReportData = summaryQuery.data ?? null;
  const summaryLoading = onSummary && (summaryQuery.isPending || summaryQuery.isPlaceholderData);

  useEffect(() => {
    if (listQuery.isError) toast.error('خطا در دریافت لیست گزارش کارهای روزانه');
  }, [listQuery.isError, listQuery.errorUpdatedAt]);
  useEffect(() => {
    if (summaryQuery.isError) toast.error('خطا در دریافت گزارش تجمیعی مدیریت');
  }, [summaryQuery.isError, summaryQuery.errorUpdatedAt]);

  /** Reads the list, statistics, summary and the dashboard's daily logs again after a write */
  const loadLogsAndStats = useCallback(
    () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailyLogs.all }),
    [queryClient],
  );

  // Form Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingLog, setEditingLog] = useState<DailyWorkLog | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Form Fields - Jalali Date as primary date
  const [formDate, setFormDate] = useState<any>(getTodayJalaliDate());
  const [formStartTime, setFormStartTime] = useState<string>('08:30');
  const [formEndTime, setFormEndTime] = useState<string>('17:00');
  const [formWorkMode, setFormWorkMode] = useState<'onsite' | 'remote'>('onsite');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formContent, setFormContent] = useState<string>('');
  const [formProjectId, setFormProjectId] = useState<string>('');
  const [formVisibility, setFormVisibility] = useState<DailyLogVisibility>(DEFAULT_DAILY_LOG_VISIBILITY);
  const [formMentions, setFormMentions] = useState<number[]>([]);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState<string>('');

  // Manager Review Modal State
  const [reviewModalLog, setReviewModalLog] = useState<DailyWorkLog | null>(null);
  const [reviewNotes, setReviewNotes] = useState<string>('');
  // review 3 of #403: the notes of a review refused as stale (409) wait for the manager to reopen the same log
  const [reviewDraft, setReviewDraft] = useState<{ logId: number; notes: string } | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);

  const handleExportSummaryCSV = () => {
    if (!summaryReportData || !Array.isArray(summaryReportData.user_summaries)) {
      toast.error('اطلاعاتی جهت دانلود موجود نیست');
      return;
    }
    // v9.0.235 (TD-640): quoted, escaped cells and no live formula
    const csvContent = buildSummaryCsv(summaryReportData.user_summaries);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const filename = summaryCsvFileName(summaryMode, getFormattedDateString(summaryDateFilter) || getTodayJalaliDate(), summaryYear, summaryMonth);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(SUMMARY_CSV_DOWNLOADED);
  };

  const currentFormHours = workHoursBetween(formStartTime, formEndTime) ?? 0; // v9.0.259 (TD-634): the server's rule

  const resetForm = () => {
    setEditingLog(null);
    setFormDate(getTodayJalaliDate());
    setFormStartTime('08:30');
    setFormEndTime('17:00');
    setFormWorkMode('onsite');
    setFormTitle('');
    setFormContent('');
    setFormProjectId('');
    setFormVisibility('mentioned_only');
    setFormMentions([]);
    setFormTags([]);
    setTagInput('');
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (log: DailyWorkLog) => {
    setEditingLog(log);
    setFormDate(isoToJalaliDate(log.date) || getTodayJalaliDate());
    setFormStartTime(log.start_time || log.startTime || '08:30');
    setFormEndTime(log.end_time || log.endTime || '17:00');
    setFormWorkMode(log.work_mode || log.workMode || 'onsite');
    setFormTitle(log.title || '');
    setFormContent(log.content || '');
    setFormProjectId(log.project_id || log.projectId ? String(log.project_id || log.projectId) : '');
    setFormVisibility(log.visibility || DEFAULT_DAILY_LOG_VISIBILITY);
    setFormMentions(Array.isArray(log.mentions) ? log.mentions : []);
    setFormTags(Array.isArray(log.tags) ? log.tags : []);
    setIsModalOpen(true);
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !formTags.includes(trimmed) && formTags.length < DAILY_LOG_TAGS_MAX) {
      setFormTags([...formTags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormTags(formTags.filter(t => t !== tagToRemove));
  };

  const handleSaveLog = async (e: FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      toast.error('لطفاً عنوان گزارش کار را وارد کنید');
      return;
    }
    if (!formContent.trim()) {
      toast.error('لطفاً شرح کامل فعالیت‌ها را وارد کنید');
      return;
    }
    const timeError = workTimeError(formStartTime, formEndTime);
    if (timeError) { toast.error(timeError); return; }

    setIsSaving(true);
    const selectedProj = projects.find(p => p.id === Number(formProjectId));
    const dateStr = getFormattedDateString(formDate) || getTodayJalaliDate();

    const payload = {
      date: dateStr,
      start_time: formStartTime,
      end_time: formEndTime,
      work_mode: formWorkMode,
      title: formTitle,
      content: formContent,
      project_id: formProjectId ? Number(formProjectId) : null,
      project_name: selectedProj ? selectedProj.title : '',
      tags: formTags,
      mentions: formMentions,
      visibility: formVisibility
    };

    try {
      if (editingLog) {
        // v10.2.32 (TD-1327): the version the form was built from; a stale one is 409 with the server's message
        await fetchJson(`/daily-logs/${editingLog.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, version: editingLog.version })
        });
        toast.success('گزارش کار با موفقیت ویرایش شد');
      } else {
        await fetchJson('/daily-logs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        toast.success('گزارش کار جدید ثبت شد و برای افراد اشاره‌شده ارسال گردید');
      }
      setIsModalOpen(false);
      resetForm();
      void loadLogsAndStats();
    } catch (err) {
      // v10.2.37 (#354 review L1): after a stale version (409) the list is read again, so a reopened form has the stored version
      if ((err as { status?: unknown } | null)?.status === 409) void loadLogsAndStats();
      toast.error(errorMessageOf(err) || 'خطا در ثبت گزارش کار');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLog = async (logId: number) => {
    if (!(await confirmAction({ title: 'حذف گزارش کار', message: 'آیا از حذف این گزارش کار اطمینان دارید؟' }))) return;
    try {
      await fetchJson(`/daily-logs/${logId}`, { method: 'DELETE' });
      toast.success('گزارش کار حذف شد');
      void loadLogsAndStats();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در حذف گزارش کار');
    }
  };

  const handleOpenReviewModal = (log: DailyWorkLog) => {
    setReviewModalLog(log);
    if (reviewDraft?.logId === log.id) {
      setReviewNotes(reviewDraft.notes);
      setReviewDraft(null);
    } else {
      setReviewNotes(log.manager_notes || log.managerNotes || '');
    }
  };

  const handleSaveReview = async () => {
    if (!reviewModalLog) return;
    setIsSubmittingReview(true);
    try {
      await fetchJson(`/daily-logs/${reviewModalLog.id}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          manager_notes: reviewNotes,
          version: reviewModalLog.version,
          // review 4 of #403: the review state this form opened, so a second manager's review is not silently replaced
          opened_status: reviewModalLog.status,
          opened_manager_notes: reviewModalLog.manager_notes ?? reviewModalLog.managerNotes ?? '',
        })
      });
      toast.success('بازخورد مدیریتی ثبت گردید');
      setReviewModalLog(null);
      void loadLogsAndStats();
    } catch (err) {
      // v11 phase 6.1a (reviews of #403): after a stale version (409) the form closes at once with the notes typed here
      // kept for this log, and the list is read again, so the manager reads the changed log and a reopened form has its
      // stored version and these notes
      if ((err as { status?: unknown } | null)?.status === 409) {
        setReviewDraft({ logId: reviewModalLog.id, notes: reviewNotes });
        setReviewModalLog(null);
        void loadLogsAndStats();
      }
      toast.error(errorMessageOf(err) || 'خطا در ثبت بازخورد مدیریتی');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handlePrintLogs = () => {
    try {
      window.print();
    } catch (err) {
      console.error('Print failed:', err);
      toast.error('امکان ارسال به چاپگر وجود ندارد');
    }
  };

  return {
    logs,
    total,
    stats,
    loadLogsAndStats,
    systemUsers,
    projects,
    loading,
    page,
    setPage,
    limit,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    selectedWorkMode,
    setSelectedWorkMode,
    selectedDateFilter,
    setSelectedDateFilter,
    summaryMode,
    setSummaryMode,
    summaryDateFilter,
    setSummaryDateFilter,
    summaryYear,
    setSummaryYear,
    summaryMonth,
    setSummaryMonth,
    summarySelectedUserId,
    setSummarySelectedUserId,
    summaryReportData,
    summaryLoading,
    selectedUserLogsModal,
    setSelectedUserLogsModal,
    isModalOpen,
    setIsModalOpen,
    editingLog,
    isSaving,
    formDate,
    setFormDate,
    formStartTime,
    setFormStartTime,
    formEndTime,
    setFormEndTime,
    formWorkMode,
    setFormWorkMode,
    formTitle,
    setFormTitle,
    formContent,
    setFormContent,
    formProjectId,
    setFormProjectId,
    formVisibility,
    setFormVisibility,
    formMentions,
    setFormMentions,
    formTags,
    tagInput,
    setTagInput,
    currentFormHours,
    reviewModalLog,
    setReviewModalLog,
    reviewNotes,
    setReviewNotes,
    isSubmittingReview,
    handleOpenCreateModal,
    handleOpenEditModal,
    handleAddTag,
    handleRemoveTag,
    handleSaveLog,
    handleDeleteLog,
    handleOpenReviewModal,
    handleSaveReview,
    handleExportSummaryCSV,
    handlePrintLogs,
  };
}
