import { useState, useEffect, useMemo, FormEvent } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { fetchJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions';
import { PICK_LIST_URLS } from '../lib/permissions/pickLists';
import {
  Personnel,
  PieceworkTask,
  PieceworkLog,
  PieceworkPayroll,
  PieceworkPersonnelRate
} from '../types';
import { toast as hotToast } from 'react-hot-toast';
import { parseQuantityOrTime, formatPersianPrice, errorMessageOf, toStorageDate, getTodayIsoDate } from '../utils';
import { computeFixedSalaryShares, priorFixedGrantsOf } from '../lib/payroll/fixedSalaryProration';
import { fixedSalaryPeriodEnd, payrollPeriodFutureError, serviceEndOf } from '../lib/payroll/payrollPeriod';
import { refreshSuggestedRates, submittedRate, suggestedRate } from '../lib/payroll/workLogRate';
import {
  exportPieceworkTasksToExcel,
  downloadPieceworkTemplate
} from '../components/piecework/pieceworkExcelUtils';

export interface BatchLogRow {
  taskId: number | '';
  projectId: number | '';
  quantity: string;
  unitRate: number;
  /** v8.0.109 (TD-386): نرخ دستی عوض شده است؛ فقط در این حالت فرستاده می‌شود */
  rateEdited?: boolean;
}

export interface TaskFormData {
  title: string;
  category: string;
  unit: string;
  defaultRate: number;
}

export function usePiecework() {
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks' | 'rates' | 'payrolls' | 'project-costs'>('logs');

  // v7.0.59 (TD-223، تصمیم مالک محصول): مبالغ فیش‌ها فقط برای دارندگان مجوز فیش (همان گارد API)
  const { userPermissions } = useAuth();
  const canViewPayrolls = Boolean(
    userPermissions?.isAdmin ||
    (Array.isArray(userPermissions?.permissions) &&
      READ_PERMISSIONS.payrolls.some(p => userPermissions.permissions.includes(p)))
  );
  // حوزه H (TD-300): نرخ دستی کارکرد فقط برای مدیر پرسنل یا مدیر تعرفه‌ها (همان قاعده سرور)
  const canSetLogRate = Boolean(
    userPermissions?.isAdmin ||
    (Array.isArray(userPermissions?.permissions) &&
      ['personnel.manage', 'piecework.manage_tasks'].some(p => userPermissions.permissions.includes(p)))
  );

  // Core Data Lists
  const [personnelList, setPersonnelList] = useState<Personnel[]>([]);
  const [tasksList, setTasksList] = useState<PieceworkTask[]>([]);
  const [logsList, setLogsList] = useState<PieceworkLog[]>([]);
  const [payrollsList, setPayrollsList] = useState<PieceworkPayroll[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters for Logs
  const [selectedPersonnelFilter, setSelectedPersonnelFilter] = useState<string | number>('all');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | number>('all');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');

  // Filters for Tasks
  const [taskCategoryFilter, setTaskCategoryFilter] = useState<string>('all');
  const [taskSearchQuery, setTaskSearchQuery] = useState<string>('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<'active' | 'archived' | 'all'>('active');

  // Modal 1: Create / Edit Work Logs
  const [isLogModalOpen, setIsLogModalOpen] = useState<boolean>(false);
  const [selectedPersonnelForLog, setSelectedPersonnelForLog] = useState<number | ''>('');
  const [defaultBatchProjectId, setDefaultBatchProjectId] = useState<number | ''>('');
  const [logDate, setLogDate] = useState<string>('');
  const [batchLogRows, setBatchLogRows] = useState<BatchLogRow[]>([
    { taskId: '', projectId: '', quantity: '1', unitRate: 0 }
  ]);
  const [editingLog, setEditingLog] = useState<PieceworkLog | null>(null);
  // v8.0.109 (TD-386): نرخ‌های اختصاصی پرسنلِ فرم ثبت کارکرد، برای پیشنهاد همان نرخی که سرور برمی‌گزیند
  const [logPersonnelRates, setLogPersonnelRates] = useState<Record<number, number>>({});
  const [isSavingLog, setIsSavingLog] = useState<boolean>(false);

  // Modal 2: Create / Edit Task
  const [isTaskModalOpen, setIsTaskModalOpen] = useState<boolean>(false);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState<boolean>(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [selectedTaskForHistory, setSelectedTaskForHistory] = useState<PieceworkTask | null>(null);
  const [editingTask, setEditingTask] = useState<PieceworkTask | null>(null);
  const [isSavingTask, setIsSavingTask] = useState<boolean>(false);
  const [taskFormData, setTaskFormData] = useState<TaskFormData>({
    title: '',
    category: '',
    unit: 'عدد',
    defaultRate: 0
  });

  // Task Categories from Settings
  const [taskCategories, setTaskCategories] = useState<{ id: number | string; name: string; description?: string }[]>([]);

  // Tab 3: Custom Rates
  const [selectedPersonnelForRates, setSelectedPersonnelForRates] = useState<number | ''>('');
  const [customRatesMap, setCustomRatesMap] = useState<Record<number, number>>({});

  // Modal 3: Payroll Generation Modal
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState<boolean>(false);
  const [payrollPersonnelId, setPayrollPersonnelId] = useState<number | ''>('');
  const [payrollStartDate, setPayrollStartDate] = useState<string>('');
  const [payrollEndDate, setPayrollEndDate] = useState<string>('');
  const [payrollTitle, setPayrollTitle] = useState<string>('');
  const [payrollBonuses, setPayrollBonuses] = useState<number>(0);
  const [payrollDeductions, setPayrollDeductions] = useState<number>(0);
  // V1.9.0: کسر از مساعده/وام پرسنلی — بستانکار حساب مساعده در سند تسویه
  const [payrollAdvanceDeduction, setPayrollAdvanceDeduction] = useState<number>(0);
  const [payrollNotes, setPayrollNotes] = useState<string>('');
  const [isSavingPayroll, setIsSavingPayroll] = useState<boolean>(false);

  // Modal 4: View Payslip
  const [viewingPayroll, setViewingPayroll] = useState<PieceworkPayroll | null>(null);

  // Initial Data Fetch
  const loadData = async (signal?: AbortSignal, status: 'active' | 'archived' | 'all' = taskStatusFilter) => {
    setLoading(true);
    try {
      const [pRes, tRes, lRes, payRes, projRes, catRes] = await Promise.all([
        fetchJson('/personnel', { signal }),
        fetchJson(`/piecework/tasks?status=${status}`, { signal }),
        fetchJson('/piecework/logs', { signal }),
        canViewPayrolls ? fetchJson('/piecework/payrolls', { signal }) : Promise.resolve([]),
        fetchJson(PICK_LIST_URLS.projects, { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load projects for piecework:', err);
          return [];
        }),
        fetchJson('/piecework/categories', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load piecework categories:', err);
          return [];
        })
      ]);
      setPersonnelList(Array.isArray(pRes) ? pRes : []);
      setTasksList(Array.isArray(tRes) ? tRes : []);
      setLogsList(Array.isArray(lRes) ? lRes : []);
      setPayrollsList(Array.isArray(payRes) ? payRes : []);
      const projectsArr = Array.isArray(projRes?.data) ? projRes.data : (Array.isArray(projRes) ? projRes : []);
      setProjectsList(projectsArr);
      setTaskCategories(Array.isArray(catRes) ? catRes : []);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading piecework data:', err);
      hotToast.error(err?.message || 'خطا در دریافت اطلاعات پرکیسی');
    } finally {
      setLoading(false);
    }
  };

  const handleTaskStatusFilterChange = (status: 'active' | 'archived' | 'all') => {
    setTaskStatusFilter(status);
    fetchJson<PieceworkTask[]>(`/piecework/tasks?status=${status}`)
      .then((res) => {
        setTasksList(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        hotToast.error('خطا در دریافت عناوین کاری: ' + (err?.message || ''));
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, []);

  // Category list derived from settings management and existing tasks
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    (taskCategories || []).forEach(c => {
      if (c && c.name && c.name.trim()) set.add(c.name.trim());
    });
    const safeTasks = Array.isArray(tasksList) ? tasksList : [];
    safeTasks.forEach(t => {
      if (t.category && t.category.trim()) set.add(t.category.trim());
    });
    return Array.from(set);
  }, [taskCategories, tasksList]);

  // Options for SearchableSelect
  const taskSelectOptions = useMemo(() => {
    const safeTasks = Array.isArray(tasksList) ? tasksList : [];
    return safeTasks.map(t => ({
      value: String(t.id),
      label: `${t.title} (${t.category || 'عمومی'}) - نرخ پایه: ${Number(t.defaultRate || 0).toLocaleString()} ریال`
    }));
  }, [tasksList]);

  const personnelSelectOptions = useMemo(() => {
    const safePersonnel = Array.isArray(personnelList) ? personnelList : [];
    return safePersonnel.map(p => ({
      value: String(p.id),
      label: `${p.fullName || 'بی‌نام'} (${p.jobTitle || 'بدون سمت'} - کد: ${p.personnelCode || '---'})`
    }));
  }, [personnelList]);

  const projectSelectOptions = useMemo(() => {
    const safeProjects = Array.isArray(projectsList) ? projectsList : [];
    return [
      { value: '', label: '-- بدون پروژه کارگاهی --' },
      ...safeProjects.map(p => ({
        value: String(p.id),
        label: `${p.title || p.name || 'پروژه'} ${p.project_code || p.projectCode ? `(${p.project_code || p.projectCode})` : ''}`
      }))
    ];
  }, [projectsList]);

  // v8.0.109 (TD-386): نرخ‌های اختصاصی پرسنل انتخاب‌شده در فرم ثبت کارکرد؛ نرخ ردیف‌های دستی‌نشده با آن‌ها تازه می‌شود
  useEffect(() => {
    if (!isLogModalOpen || editingLog || !selectedPersonnelForLog) {
      setLogPersonnelRates({});
      return;
    }
    const controller = new AbortController();
    fetchJson<PieceworkPersonnelRate[]>(`/piecework/personnel-rates/${selectedPersonnelForLog}`, { signal: controller.signal })
      .then(res => {
        const map: Record<number, number> = {};
        (Array.isArray(res) ? res : []).forEach(r => { map[r.taskId] = Number(r.customRate); });
        setLogPersonnelRates(map);
        setBatchLogRows(rows => refreshSuggestedRates(rows, tasksList, map));
      })
      .catch(() => {
        if (!controller.signal.aborted) setLogPersonnelRates({});
      });
    return () => controller.abort();
  }, [isLogModalOpen, editingLog, selectedPersonnelForLog, tasksList]);

  // Handle task select in batch row
  const handleTaskChangeInRow = (idx: number, taskId: number | '') => {
    // v8.0.109 (TD-386): نرخ پیشنهادی = نرخ اختصاصی پرسنل، وگرنه نرخ پایه عنوان (همان انتخاب سرور)
    const newRows = [...batchLogRows];
    newRows[idx] = {
      ...newRows[idx],
      taskId: taskId,
      unitRate: suggestedRate(taskId, tasksList, logPersonnelRates),
      rateEdited: false
    };
    setBatchLogRows(newRows);
  };

  const handleAddLogRow = () => {
    setBatchLogRows(prev => [
      ...prev,
      { taskId: '', projectId: defaultBatchProjectId || '', quantity: '1', unitRate: 0 }
    ]);
  };

  const handleRemoveLogRow = (idx: number) => {
    setBatchLogRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Work Log Actions
  const handleOpenAddLogModal = () => {
    setEditingLog(null);
    setSelectedPersonnelForLog('');
    setDefaultBatchProjectId('');
    setBatchLogRows([{ taskId: '', projectId: '', quantity: '1', unitRate: 0 }]);
    setIsLogModalOpen(true);
  };

  const handleOpenEditLogModal = (log: PieceworkLog) => {
    setEditingLog(log);
    setIsLogModalOpen(true);
  };

  const handleSaveLogs = async (e: FormEvent) => {
    e.preventDefault();
    if (isSavingLog) return;
    setIsSavingLog(true);

    try {
      if (editingLog) {
        // Single Edit
        const parsedQty = parseQuantityOrTime(editingLog.quantity);
        if (parsedQty <= 0) {
          hotToast.error('مقدار یا زمان وارد شده معتبر نیست');
          setIsSavingLog(false);
          return;
        }

        const payload = {
          date: editingLog.date,
          projectId: editingLog.projectId || null,
          quantity: parsedQty,
          unitRate: Number(editingLog.unitRate) || 0
        };

        await fetchJson(`/piecework/logs/${editingLog.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        hotToast.success('ردیف کارکرد با موفقیت ویرایش شد');
      } else {
        // Batch Create
        if (!selectedPersonnelForLog) {
          hotToast.error('لطفاً پرسنل را انتخاب کنید');
          setIsSavingLog(false);
          return;
        }
        if (!logDate) {
          hotToast.error('لطفاً تاریخ کارکرد را مشخص کنید');
          setIsSavingLog(false);
          return;
        }

        const validRows = batchLogRows.filter(r => r.taskId && parseQuantityOrTime(r.quantity) > 0);
        if (validRows.length === 0) {
          hotToast.error('حداقل یک ردیف کاری با عنوان و تعداد معتبر وارد کنید');
          setIsSavingLog(false);
          return;
        }

        const items = validRows.map(r => ({
          personnelId: Number(selectedPersonnelForLog),
          taskId: Number(r.taskId),
          projectId: r.projectId ? Number(r.projectId) : null,
          date: logDate,
          quantity: parseQuantityOrTime(r.quantity),
          // v8.0.109 (TD-386): فقط نرخ دستی؛ وگرنه سرور نرخ اختصاصی پرسنل یا نرخ پایه را برمی‌گزیند
          unitRate: submittedRate(r)
        }));

        await fetchJson('/piecework/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });

        hotToast.success(`${items.length} ردیف کارکرد با موفقیت ثبت شد`);
      }

      setIsLogModalOpen(false);
      void loadData();
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در ثبت کارکرد');
    } finally {
      setIsSavingLog(false);
    }
  };

  const handleDeleteLog = async (id: number) => {
    if (await confirmAction({ title: 'حذف ردیف کارکرد', message: 'آیا از حذف این ردیف کارکرد اطمینان دارید؟' })) {
      try {
        await fetchJson(`/piecework/logs/${id}`, { method: 'DELETE' });
        hotToast.success('ردیف کارکرد حذف شد');
        void loadData();
      } catch (err) {
        hotToast.error(errorMessageOf(err) || 'خطا در حذف کارکرد');
      }
    }
  };

  // Task Actions
  const handleOpenAddTaskModal = () => {
    setEditingTask(null);
    const defaultCat = taskCategories[0]?.name || (categoriesList[0] || '');
    setTaskFormData({ title: '', category: defaultCat, unit: 'عدد', defaultRate: 0 });
    setIsTaskModalOpen(true);
  };

  const handleOpenEditTaskModal = (task: PieceworkTask) => {
    setEditingTask(task);
    setTaskFormData({
      title: task.title,
      category: task.category || (taskCategories[0]?.name || (categoriesList[0] || '')),
      unit: task.unit || 'عدد',
      defaultRate: Number(task.defaultRate) || 0
    });
    setIsTaskModalOpen(true);
  };

  const handleSaveTask = async (e: FormEvent) => {
    e.preventDefault();
    if (isSavingTask) return;

    if (!taskFormData.title.trim()) {
      hotToast.error('عنوان کاری الزامی است');
      return;
    }

    setIsSavingTask(true);
    try {
      if (editingTask) {
        await fetchJson(`/piecework/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskFormData)
        });
        hotToast.success('عنوان کاری ویرایش شد');
      } else {
        await fetchJson('/piecework/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskFormData)
        });
        hotToast.success('عنوان کاری جدید افزوده شد');
      }

      setIsTaskModalOpen(false);
      void loadData();
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در ذخیره عنوان کاری');
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleDeleteTask = async (task: PieceworkTask) => {
    if (await confirmAction({
      title: 'حذف و بایگانی عنوان کاری',
      message: `آیا از حذف و بایگانی عنوان کاری «${task.title}» اطمینان دارید؟\nتمام سوابق، نرخ‌های قدیمی و فیش‌های پیشین مربوط به این عنوان در تاریخچه سامانه محفوظ می‌مانند.`
    })) {
      try {
        await fetchJson(`/piecework/tasks/${task.id}`, { method: 'DELETE' });
        hotToast.success('عنوان کاری به بایگانی منتقل شد و سوابق آن ذخیره گردید');
        void loadData();
      } catch (err: any) {
        hotToast.error(err?.message || 'خطا در حذف عنوان کاری');
      }
    }
  };

  const handleRestoreTask = async (task: PieceworkTask) => {
    if (await confirmAction({
      title: 'بازیابی عنوان کاری',
      message: `آیا مایل به بازیابی عنوان کاری «${task.title}» به لیست فعال هستید؟`
    })) {
      try {
        await fetchJson(`/piecework/tasks/${task.id}/restore`, { method: 'POST' });
        hotToast.success('عنوان کاری با موفقیت بازیابی شد');
        void loadData();
      } catch (err: any) {
        hotToast.error(err?.message || 'خطا در بازیابی عنوان کاری');
      }
    }
  };

  const handleOpenTaskHistoryModal = (task: PieceworkTask) => {
    setSelectedTaskForHistory(task);
    setIsHistoryModalOpen(true);
  };

  const handleOpenGlobalHistoryModal = () => {
    setSelectedTaskForHistory(null);
    setIsHistoryModalOpen(true);
  };

  const handleCloseHistoryModal = () => {
    setIsHistoryModalOpen(false);
    setSelectedTaskForHistory(null);
  };

  const handleExportTasksExcel = () => {
    try {
      if (tasksList.length === 0) {
        hotToast.error('هیچ عنوانی برای خروجی اکسل وجود ندارد.');
        return;
      }
      exportPieceworkTasksToExcel(tasksList);
      hotToast.success('فایل اکسل عناوین کاری دانلود شد.');
    } catch (err: any) {
      hotToast.error('خطا در صدور فایل اکسل: ' + (err?.message || ''));
    }
  };

  const handleDownloadTemplate = () => {
    try {
      downloadPieceworkTemplate();
      hotToast.success('فایل قالب نمونه اکسل دانلود شد.');
    } catch (err: any) {
      hotToast.error('خطا در دانلود قالب اکسل: ' + (err?.message || ''));
    }
  };

  // Custom Rates Actions
  const loadCustomRates = async (personnelId: number) => {
    try {
      const res = await fetchJson(`/piecework/personnel-rates/${personnelId}`);
      const map: Record<number, number> = {};
      if (Array.isArray(res)) {
        res.forEach((r: PieceworkPersonnelRate) => {
          map[r.taskId] = Number(r.customRate);
        });
      }
      setCustomRatesMap(map);
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در دریافت نرخ‌های اختصاصی');
    }
  };

  const handleSelectPersonnelForRates = (id: number | '') => {
    setSelectedPersonnelForRates(id);
    if (id) {
      void loadCustomRates(Number(id));
    } else {
      setCustomRatesMap({});
    }
  };

  const handleSaveCustomRate = async (taskId: number, customRate: number) => {
    if (!selectedPersonnelForRates) return;
    try {
      await fetchJson('/piecework/personnel-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personnelId: Number(selectedPersonnelForRates),
          taskId,
          customRate
        })
      });
      setCustomRatesMap(prev => ({ ...prev, [taskId]: customRate }));
      hotToast.success('نرخ اختصاصی ثبت شد');
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در ذخیره نرخ اختصاصی');
    }
  };

  // Payroll Actions
  const handleOpenPayrollModal = () => {
    setPayrollPersonnelId('');
    setPayrollStartDate('');
    setPayrollEndDate('');
    setPayrollTitle('');
    setPayrollBonuses(0);
    setPayrollDeductions(0);
    setPayrollNotes('');
    setIsPayrollModalOpen(true);
  };

  // Preview pending logs for payroll issuance
  const payrollPreviewLogs = useMemo(() => {
    if (!payrollPersonnelId || !payrollStartDate || !payrollEndDate) return [];
    const safeLogs = Array.isArray(logsList) ? logsList : [];
    return safeLogs.filter(l =>
      l.personnelId === Number(payrollPersonnelId) &&
      l.status === 'pending' &&
      // v7.0.134 (TD-232): تاریخ کارکرد ISO است و بازه فیش شمسی انتخاب می‌شود
      l.date >= (toStorageDate(payrollStartDate) || '') &&
      l.date <= (toStorageDate(payrollEndDate) || '')
    );
  }, [logsList, payrollPersonnelId, payrollStartDate, payrollEndDate]);

  // V10-4.4: آیا پرسنل انتخاب‌شده برای صدور فیش به سهم حقوق ثابت نیازمند ردیف کارکرد نیست؟
  const selectedPayrollPerson = (personnelList as any[]).find((p: any) => String(p.id) === String(payrollPersonnelId));
  const payrollFixedIncluded =
    selectedPayrollPerson != null &&
    ['monthly_fixed', 'mixed'].includes(String(selectedPayrollPerson.salaryType || 'none'));

  // v8.0.30 (TD-284): سهم حقوق ثابت هر ماه شمسیِ بازه، ماه ناقص به نسبت روزها، پس از کسر فیش‌های پیشین — همان قاعده سرور
  const payrollFixedShares = useMemo(() => {
    if (!payrollFixedIncluded || !selectedPayrollPerson) return null;
    const startIso = toStorageDate(payrollStartDate);
    const endIso = toStorageDate(payrollEndDate);
    if (!startIso || !endIso || Number(selectedPayrollPerson.monthlySalary || 0) <= 0) return null;
    // v9.0.233 (TD-808): حقوق ثابت فقط تا پایان همکاری — همان قاعده سرور
    const fixedEnd = fixedSalaryPeriodEnd(startIso, endIso, serviceEndOf(selectedPayrollPerson));
    if (fixedEnd === null) return null;
    const personPayrolls = (Array.isArray(payrollsList) ? payrollsList : []).filter(pr => Number(pr.personnelId) === Number(payrollPersonnelId));
    return computeFixedSalaryShares(selectedPayrollPerson.monthlySalary, startIso, fixedEnd, personPayrolls.flatMap(priorFixedGrantsOf));
  }, [payrollFixedIncluded, selectedPayrollPerson, payrollsList, payrollPersonnelId, payrollStartDate, payrollEndDate]);

  const payrollFixedRemainingHint = useMemo<string | null>(() => {
    if (!payrollFixedShares || payrollFixedShares.months.length === 0) return null;
    if (!payrollFixedShares.total.isPositive()) {
      return 'هشدار: سهم حقوق ثابت این بازه قبلاً در فیش(های) دیگر محاسبه شده است — در این فیش مبلغ ثابتی اضافه نمی‌شود و فقط کارکرد پرکیسی پرداخت خواهد شد.';
    }
    const parts = payrollFixedShares.months.map(m => `${m.month}: ${m.days} از ${m.monthDays} روز (${formatPersianPrice(Number(m.amount))})`);
    return `سهم حقوق ثابت این فیش ${formatPersianPrice(payrollFixedShares.total.toNumber())} است — ${parts.join('، ')}.`;
  }, [payrollFixedShares]);

  const handleGeneratePayroll = async (e: FormEvent) => {
    e.preventDefault();
    if (isSavingPayroll) return;

    if (!payrollPersonnelId || !payrollStartDate || !payrollEndDate) {
      hotToast.error('پرسنل و بازه تاریخی الزامی هستند');
      return;
    }
    // v9.0.233 (TD-808): فیش دوره‌ای که هنوز تمام نشده صادر نمی‌شود — همان پیام سرور
    const futureError = payrollPeriodFutureError(toStorageDate(payrollEndDate) || '', getTodayIsoDate());
    if (futureError) {
      hotToast.error(futureError);
      return;
    }

    // V10-4.4: برای پرسنل با حقوق ثابت/ترکیبی، صدور فیش بدون ردیف کارکرد نیز مجاز است
    // v8.0.30 (TD-284): سهم ثابت هر ماه شمسیِ بازه به نسبت روزها — مطابق منطق سمت سرور
    if (payrollPreviewLogs.length === 0 && !(payrollFixedShares?.total.isPositive() ?? false)) {
      hotToast.error(payrollFixedShares && payrollFixedShares.months.length > 0
        ? 'سهم حقوق ثابت این بازه قبلاً در فیش دیگری محاسبه شده و کارکرد پرکیسی معوقی هم در این بازه وجود ندارد'
        : 'هیچ کارکرد تسویه‌نشده‌ای در این بازه یافت نشد');
      return;
    }

    setIsSavingPayroll(true);
    try {
      const payload = {
        personnelId: Number(payrollPersonnelId),
        startDate: payrollStartDate,
        endDate: payrollEndDate,
        title: payrollTitle || undefined,
        bonuses: payrollBonuses || 0,
        totalBonuses: payrollBonuses || 0,
        deductions: payrollDeductions || 0,
        totalDeductions: payrollDeductions || 0,
        advanceDeduction: payrollAdvanceDeduction || 0,
        notes: payrollNotes || undefined
      };

      const res = await fetchJson('/piecework/payrolls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      hotToast.success(`فیش حقوقی با موفقیت با شماره ${res.payrollNumber || ''} صادر شد`);
      setIsPayrollModalOpen(false);
      void loadData();
      setActiveTab('payrolls');
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در صدور فیش حقوقی');
    } finally {
      setIsSavingPayroll(false);
    }
  };

  const handleViewPayslip = async (id: number) => {
    try {
      const res = await fetchJson(`/piecework/payrolls/${id}`);
      setViewingPayroll(res);
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در دریافت جزئیات فیش');
    }
  };

  const handleUpdatePayrollStatus = async (id: number, status: 'draft' | 'approved' | 'paid') => {
    try {
      await fetchJson(`/piecework/payrolls/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      hotToast.success('وضعیت پرداخت به‌روزرسانی شد');
      if (viewingPayroll && viewingPayroll.id === id) {
        setViewingPayroll(prev => prev ? { ...prev, status } : null);
      }
      void loadData();
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در به‌روزرسانی وضعیت فیش');
    }
  };

  const handleDeletePayroll = async (id: number) => {
    if (await confirmAction({ title: 'ابطال فیش حقوقی', message: 'آیا از ابطال این فیش حقوقی اطمینان دارید؟ تمامی کارکردهای آن مجدداً به حالت «در انتظار» برمی‌گردند.' })) {
      try {
        await fetchJson(`/piecework/payrolls/${id}`, { method: 'DELETE' });
        hotToast.success('فیش حقوقی با موفقیت ابطال و حذف شد');
        if (viewingPayroll && viewingPayroll.id === id) {
          setViewingPayroll(null);
        }
        void loadData();
      } catch (err) {
        hotToast.error(errorMessageOf(err) || 'خطا در ابطال فیش حقوقی');
      }
    }
  };

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    const safeLogs = Array.isArray(logsList) ? logsList : [];
    return safeLogs.filter(log => {
      const matchPersonnel = selectedPersonnelFilter === 'all' || log.personnelId === Number(selectedPersonnelFilter);
      const matchProject = selectedProjectFilter === 'all' ||
        (selectedProjectFilter === 'none' ? !log.projectId : log.projectId === Number(selectedProjectFilter));
      const matchStatus = statusFilter === 'all' || log.status === statusFilter;
      const matchStart = !startDateFilter || log.date >= (toStorageDate(startDateFilter) || '');
      const matchEnd = !endDateFilter || log.date <= (toStorageDate(endDateFilter) || '');
      const q = logSearchQuery.trim().toLowerCase();
      const matchSearch = !q ||
        (log.personnelName && log.personnelName.toLowerCase().includes(q)) ||
        (log.taskTitle && log.taskTitle.toLowerCase().includes(q)) ||
        (log.projectTitle && log.projectTitle.toLowerCase().includes(q));

      return matchPersonnel && matchProject && matchStatus && matchStart && matchEnd && matchSearch;
    });
  }, [logsList, selectedPersonnelFilter, selectedProjectFilter, statusFilter, startDateFilter, endDateFilter, logSearchQuery]);

  // Project Costs Summary
  const projectCostsSummary = useMemo(() => {
    const safeLogs = Array.isArray(logsList) ? logsList : [];
    const map: Record<string, { projectId: number | null; title: string; totalCost: number; logCount: number; personnelSet: Set<string> }> = {};

    safeLogs.forEach(log => {
      const key = log.projectId ? String(log.projectId) : 'unassigned';
      if (!map[key]) {
        map[key] = {
          projectId: log.projectId || null,
          title: log.projectTitle || (log.projectId ? `پروژه #${log.projectId}` : 'بدون پروژه کارگاهی (عمومی)'),
          totalCost: 0,
          logCount: 0,
          personnelSet: new Set()
        };
      }
      map[key].totalCost += (log.totalAmount || 0);
      map[key].logCount += 1;
      if (log.personnelName) {
        map[key].personnelSet.add(log.personnelName);
      }
    });

    return Object.values(map).sort((a, b) => b.totalCost - a.totalCost);
  }, [logsList]);

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    const safeTasks = Array.isArray(tasksList) ? tasksList : [];
    return safeTasks.filter(t => {
      const matchCat = taskCategoryFilter === 'all' || t.category === taskCategoryFilter;
      const q = taskSearchQuery.trim().toLowerCase();
      const matchSearch = !q ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [tasksList, taskCategoryFilter, taskSearchQuery]);

  // Totals
  const totalLoggedAmount = useMemo(() => {
    const safeLogs = Array.isArray(logsList) ? logsList : [];
    return safeLogs.reduce((sum, l) => sum + (l.totalAmount || 0), 0);
  }, [logsList]);

  const pendingLoggedAmount = useMemo(() => {
    const safeLogs = Array.isArray(logsList) ? logsList : [];
    return safeLogs.filter(l => l.status === 'pending').reduce((sum, l) => sum + (l.totalAmount || 0), 0);
  }, [logsList]);

  return {
    canViewPayrolls,
    canSetLogRate,
    activeTab,
    setActiveTab,
    personnelList,
    tasksList,
    logsList,
    payrollsList,
    projectsList,
    loading,
    loadData,
    selectedPersonnelFilter,
    setSelectedPersonnelFilter,
    selectedProjectFilter,
    setSelectedProjectFilter,
    startDateFilter,
    setStartDateFilter,
    endDateFilter,
    setEndDateFilter,
    statusFilter,
    setStatusFilter,
    logSearchQuery,
    setLogSearchQuery,
    taskCategoryFilter,
    setTaskCategoryFilter,
    taskSearchQuery,
    setTaskSearchQuery,
    taskStatusFilter,
    setTaskStatusFilter,
    handleTaskStatusFilterChange,
    isLogModalOpen,
    setIsLogModalOpen,
    selectedPersonnelForLog,
    setSelectedPersonnelForLog,
    defaultBatchProjectId,
    setDefaultBatchProjectId,
    logDate,
    setLogDate,
    batchLogRows,
    setBatchLogRows,
    editingLog,
    setEditingLog,
    isTaskModalOpen,
    setIsTaskModalOpen,
    isExcelModalOpen,
    setIsExcelModalOpen,
    isHistoryModalOpen,
    setIsHistoryModalOpen,
    selectedTaskForHistory,
    setSelectedTaskForHistory,
    editingTask,
    setEditingTask,
    taskFormData,
    setTaskFormData,
    handleOpenTaskHistoryModal,
    handleOpenGlobalHistoryModal,
    handleCloseHistoryModal,
    handleRestoreTask,
    handleExportTasksExcel,
    handleDownloadTemplate,
    selectedPersonnelForRates,
    setSelectedPersonnelForRates,
    customRatesMap,
    setCustomRatesMap,
    isPayrollModalOpen,
    setIsPayrollModalOpen,
    payrollPersonnelId,
    setPayrollPersonnelId,
    payrollStartDate,
    setPayrollStartDate,
    payrollEndDate,
    setPayrollEndDate,
    payrollTitle,
    setPayrollTitle,
    payrollBonuses,
    setPayrollBonuses,
    payrollDeductions,
    setPayrollDeductions,
    payrollNotes,
    setPayrollNotes,
    payrollFixedIncluded,
    payrollFixedRemainingHint,
    payrollAdvanceDeduction,
    setPayrollAdvanceDeduction,
    viewingPayroll,
    setViewingPayroll,
    taskCategories,
    categoriesList,
    taskSelectOptions,
    personnelSelectOptions,
    projectSelectOptions,
    handleTaskChangeInRow,
    handleAddLogRow,
    handleRemoveLogRow,
    handleOpenAddLogModal,
    handleOpenEditLogModal,
    handleSaveLogs,
    isSavingLog,
    handleDeleteLog,
    handleOpenAddTaskModal,
    handleOpenEditTaskModal,
    handleSaveTask,
    isSavingTask,
    handleDeleteTask,
    handleSelectPersonnelForRates,
    handleSaveCustomRate,
    handleOpenPayrollModal,
    payrollPreviewLogs,
    handleGeneratePayroll,
    isSavingPayroll,
    handleViewPayslip,
    handleUpdatePayrollStatus,
    handleDeletePayroll,
    filteredLogs,
    projectCostsSummary,
    filteredTasks,
    totalLoggedAmount,
    pendingLoggedAmount
  };
}
