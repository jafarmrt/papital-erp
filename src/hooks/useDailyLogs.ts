import { useState, useEffect, useRef, FormEvent } from 'react';
import { DEFAULT_DAILY_LOG_VISIBILITY, type DailyLogVisibility } from '../lib/dailyLogs/dailyLogVisibility';
import { EMPTY_DAILY_LOG_STATS, type DailyLogStats } from '../lib/dailyLogs/dailyLogStats';
import { workHoursBetween, workTimeError } from '../lib/dailyLogs/workHours';
import { SUMMARY_CSV_DOWNLOADED, buildSummaryCsv, summaryCsvFileName } from '../lib/dailyLogs/summaryCsv';
import { fetchJson } from '../api';
import { DailyWorkLog, User } from '../types';
import { PICK_LIST_URLS, type ProjectPick } from '../lib/permissions/pickLists';
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

export function useDailyLogs(user: User) {
  const [logs, setLogs] = useState<DailyWorkLog[]>([]);
  // v9.0.237 (TD-630): the server pages the list; `total` is every log the filters match
  const [total, setTotal] = useState<number>(0);
  const [stats, setStats] = useState<DailyLogStats>(EMPTY_DAILY_LOG_STATS);
  const [systemUsers, setSystemUsers] = useState<SimpleUserOption[]>([]);
  const [projects, setProjects] = useState<ProjectPick[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState(1);
  const limit = 30;

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'mentioned' | 'summary'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // v9.0.237 (TD-630): the search box asks the server only after typing pauses
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const listFilterKey = useRef('');
  const [selectedWorkMode, setSelectedWorkMode] = useState<string>('');
  const [selectedDateFilter, setSelectedDateFilter] = useState<any>(null);
  // گارد stale-response برای درخواست‌های abort شده
  const logsFetchSeq = useRef(0);
  const summaryFetchSeq = useRef(0);

  // Management Aggregated Summary States
  const todayParts = getTodayJalaliDate().split('/');
  const defaultYear = todayParts[0] || '1405';
  const defaultMonth = todayParts[1] || '05';

  const [summaryMode, setSummaryMode] = useState<'daily' | 'monthly'>('monthly');
  const [summaryDateFilter, setSummaryDateFilter] = useState<any>(getTodayJalaliDate());
  const [summaryYear, setSummaryYear] = useState<string>(defaultYear);
  const [summaryMonth, setSummaryMonth] = useState<string>(defaultMonth);
  const [summarySelectedUserId, setSummarySelectedUserId] = useState<string>('0');
  const [summaryReportData, setSummaryReportData] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [selectedUserLogsModal, setSelectedUserLogsModal] = useState<any | null>(null);

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
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);

  // Load System Users & Projects for Mentions/Selects
  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/users/list-simple', { signal: controller.signal })
      .then((data: SimpleUserOption[]) => {
        if (Array.isArray(data)) setSystemUsers(data);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Error loading users for mentions:', err);
      });

    fetchJson<{ data?: ProjectPick[] } | null>(PICK_LIST_URLS.projects, { signal: controller.signal })
      .then((res) => {
        if (Array.isArray(res?.data)) setProjects(res.data);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Error loading projects:', err);
      });

    return () => controller.abort();
  }, []);

  const loadLogsAndStats = (signal?: AbortSignal) => {
    // گارد stale-response: فقط آخرین درخواست حق تغییر state دارد
    // (رفع باگ: پس از پاک کردن فیلتر، لیست در حالت فیلتر قبلی گیر می‌کرد)
    const seq = ++logsFetchSeq.current;
    setLoading(true);
    let url = `/daily-logs?filter_type=${activeTab}&page=${page}&limit=${limit}`;
    if (selectedWorkMode) url += `&work_mode=${selectedWorkMode}`;
    if (selectedDateFilter) {
      const dateStr = getFormattedDateString(selectedDateFilter);
      if (dateStr) url += `&date=${encodeURIComponent(dateStr)}`;
    }
    if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;

    Promise.all([
      fetchJson(url, { signal }),
      fetchJson('/daily-logs/stats', { signal })
    ])
      .then(([logsData, statsData]) => {
        if (seq !== logsFetchSeq.current) return;
        const rows = Array.isArray(logsData?.data) ? logsData.data : (Array.isArray(logsData) ? logsData : []);
        setLogs(rows);
        setTotal(typeof logsData?.total === 'number' ? logsData.total : rows.length);
        if (statsData) setStats(statsData);
        setLoading(false);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        if (seq !== logsFetchSeq.current) return;
        console.error('Error loading daily logs:', err);
        toast.error('خطا در دریافت لیست گزارش کارهای روزانه');
        setLoading(false);
      });
  };

  const loadSummaryReportData = (signal?: AbortSignal) => {
    const seq = ++summaryFetchSeq.current;
    setSummaryLoading(true);
    let url = `/daily-logs/summary-report?report_type=${summaryMode}`;
    if (summaryMode === 'daily') {
      const dateStr = getFormattedDateString(summaryDateFilter) || getTodayJalaliDate();
      url += `&date=${encodeURIComponent(dateStr)}`;
    } else {
      const ym = `${summaryYear}/${summaryMonth}`;
      url += `&year_month=${encodeURIComponent(ym)}`;
    }
    if (summarySelectedUserId && summarySelectedUserId !== '0') {
      url += `&user_id=${summarySelectedUserId}`;
    }

    fetchJson(url, { signal })
      .then(data => {
        if (seq !== summaryFetchSeq.current) return;
        if (data) setSummaryReportData(data);
        setSummaryLoading(false);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        if (seq !== summaryFetchSeq.current) return;
        console.error('Error loading summary report:', err);
        toast.error('خطا در دریافت گزارش تجمیعی مدیریت');
        setSummaryLoading(false);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    if (activeTab === 'summary') {
      loadSummaryReportData(controller.signal);
    } else {
      // a filter change starts again from page 1 (one request, not a request for the old page first)
      const filterKey = JSON.stringify([activeTab, selectedWorkMode, getFormattedDateString(selectedDateFilter), debouncedSearch]);
      const filterChanged = listFilterKey.current !== '' && listFilterKey.current !== filterKey;
      listFilterKey.current = filterKey;
      if (filterChanged && page !== 1) {
        setPage(1);
        return () => controller.abort();
      }
      loadLogsAndStats(controller.signal);
    }
    return () => controller.abort();
  }, [activeTab, selectedWorkMode, selectedDateFilter, debouncedSearch, page, summaryMode, summaryDateFilter, summaryYear, summaryMonth, summarySelectedUserId]);

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

  const currentFormHours = workHoursBetween(formStartTime, formEndTime) ?? 0; // v9.0.247 (TD-634): the server's rule

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

  const handleToggleMentionUser = (uId: number) => {
    if (formMentions.includes(uId)) {
      setFormMentions(formMentions.filter(id => id !== uId));
    } else {
      setFormMentions([...formMentions, uId]);
    }
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
        await fetchJson(`/daily-logs/${editingLog.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
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
      loadLogsAndStats();
    } catch (err) {
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
      loadLogsAndStats();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در حذف گزارش کار');
    }
  };

  const handleOpenReviewModal = (log: DailyWorkLog) => {
    setReviewModalLog(log);
    setReviewNotes(log.manager_notes || log.managerNotes || '');
  };

  const handleSaveReview = async () => {
    if (!reviewModalLog) return;
    setIsSubmittingReview(true);
    try {
      await fetchJson(`/daily-logs/${reviewModalLog.id}/review`, {
        method: 'PUT',
        body: JSON.stringify({ manager_notes: reviewNotes })
      });
      toast.success('بازخورد مدیریتی ثبت گردید');
      setReviewModalLog(null);
      loadLogsAndStats();
    } catch (err) {
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
    handleToggleMentionUser,
    handleSaveLog,
    handleDeleteLog,
    handleOpenReviewModal,
    handleSaveReview,
    handleExportSummaryCSV,
    handlePrintLogs,
  };
}
