import { useState, useEffect, useRef, FormEvent } from 'react';
import { fetchJson } from '../api';
import { DailyWorkLog, User, ProductionProject } from '../types';
import { toast } from 'react-hot-toast';
import { formatPersianNumber, getTodayJalaliDate, extractDateString } from '../utils';
import { confirmAction } from '../components/ConfirmDialogHost';

export interface SimpleUserOption {
  id: number;
  username: string;
  full_name: string;
  role: string;
  avatar_url?: string;
}

export function getFormattedDateString(dateObj: any): string {
  return extractDateString(dateObj);
}

export function calculateHours(start: string, end: string): number {
  if (!start || !end) return 8;
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) return 8;
  let sTot = sH * 60 + sM;
  let eTot = eH * 60 + eM;
  if (eTot < sTot) eTot += 24 * 60;
  const diff = eTot - sTot;
  return Math.max(0, Math.round((diff / 60) * 10) / 10);
}

export function useDailyLogs(user: User) {
  const [logs, setLogs] = useState<DailyWorkLog[]>([]);
  const [stats, setStats] = useState<any>({
    today_hours: 0,
    my_total_logs: 0,
    my_total_hours: 0,
    total_logs: 0,
    onsite_count: 0,
    remote_count: 0,
    my_mentions_count: 0
  });
  const [systemUsers, setSystemUsers] = useState<SimpleUserOption[]>([]);
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState(1);
  const limit = 30;

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'mentioned' | 'summary'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
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
  const [formVisibility, setFormVisibility] = useState<'mentioned_only' | 'public' | 'private'>('mentioned_only');
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

    fetchJson('/projects', { signal: controller.signal })
      .then((data: ProductionProject[]) => {
        if (Array.isArray(data)) setProjects(data);
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
    let url = `/daily-logs?filter_type=${activeTab}`;
    if (selectedWorkMode) url += `&work_mode=${selectedWorkMode}`;
    if (selectedDateFilter) {
      const dateStr = getFormattedDateString(selectedDateFilter);
      if (dateStr) url += `&date=${encodeURIComponent(dateStr)}`;
    }
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

    Promise.all([
      fetchJson(url, { signal }),
      fetchJson('/daily-logs/stats', { signal })
    ])
      .then(([logsData, statsData]) => {
        if (seq !== logsFetchSeq.current) return;
        if (Array.isArray(logsData)) {
          setLogs(logsData);
          setPage(1);
        }
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
      loadLogsAndStats(controller.signal);
    }
    return () => controller.abort();
  }, [activeTab, selectedWorkMode, selectedDateFilter, searchQuery, summaryMode, summaryDateFilter, summaryYear, summaryMonth, summarySelectedUserId]);

  const handleExportSummaryCSV = () => {
    if (!summaryReportData || !Array.isArray(summaryReportData.user_summaries)) {
      toast.error('اطلاعاتی جهت دانلود موجود نیست');
      return;
    }
    const headers = [
      'نام و نام خانوادگی',
      'نام کاربری',
      'نقش',
      'ساعات کارکرد (ساعت)',
      'تعداد روزهای کاری',
      'تعداد گزارش‌ها',
      'روزهای حضوری',
      'روزهای دورکاری',
      'میانگین کارکرد روزانه (ساعت)'
    ];
    const rows = summaryReportData.user_summaries.map((u: any) => [
      `"${u.userFullName || u.username}"`,
      `"${u.username}"`,
      `"${u.role || 'کاربر'}"`,
      u.totalHours,
      u.daysWorked,
      u.logsCount,
      u.onsiteCount,
      u.remoteCount,
      u.avgDailyHours
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const filename = summaryMode === 'daily' 
      ? `Gozaresh_Rouzaneh_${getFormattedDateString(summaryDateFilter) || 'Today'}.csv`
      : `Gozaresh_Mahaneh_${summaryYear}_${summaryMonth}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('فایل اکسل گزارش تجمیعی با موفقیت دانلود شد');
  };

  const currentFormHours = calculateHours(formStartTime, formEndTime);

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
    setFormDate(log.date || getTodayJalaliDate());
    setFormStartTime(log.start_time || log.startTime || '08:30');
    setFormEndTime(log.end_time || log.endTime || '17:00');
    setFormWorkMode(log.work_mode || log.workMode || 'onsite');
    setFormTitle(log.title || '');
    setFormContent(log.content || '');
    setFormProjectId(log.project_id || log.projectId ? String(log.project_id || log.projectId) : '');
    setFormVisibility((log.visibility as any) || 'mentioned_only');
    setFormMentions(Array.isArray(log.mentions) ? log.mentions : []);
    setFormTags(Array.isArray(log.tags) ? log.tags : []);
    setIsModalOpen(true);
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !formTags.includes(trimmed)) {
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
        toast.success('گزارش کار جدید ثبت شد و برای افراد منشن‌شده ارسال گردید');
      }
      setIsModalOpen(false);
      resetForm();
      loadLogsAndStats();
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت گزارش کار');
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
      toast.error(err.message || 'خطا در حذف گزارش کار');
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
      toast.error(err.message || 'خطا در ثبت بازخورد مدیریتی');
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
