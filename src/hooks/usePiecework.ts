import { useState, useEffect, useMemo, FormEvent } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { fetchJson } from '../api';
import {
  Personnel,
  PieceworkTask,
  PieceworkLog,
  PieceworkPayroll,
  PieceworkPersonnelRate
} from '../types';
import { toast as hotToast } from 'react-hot-toast';
import { parseQuantityOrTime, formatPersianPrice } from '../utils';
import {
  exportPieceworkTasksToExcel,
  downloadPieceworkTemplate
} from '../components/piecework/pieceworkExcelUtils';

export interface BatchLogRow {
  taskId: number | '';
  projectId: number | '';
  quantity: string;
  unitRate: number;
}

export interface TaskFormData {
  title: string;
  category: string;
  unit: string;
  defaultRate: number;
}

export function usePiecework() {
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks' | 'rates' | 'payrolls' | 'project-costs'>('logs');

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
        fetchJson('/piecework/payrolls', { signal }),
        fetchJson('/projects', { signal }).catch((err) => {
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
    loadData(controller.signal);
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

  // Handle task select in batch row
  const handleTaskChangeInRow = (idx: number, taskId: number | '') => {
    const taskObj = tasksList.find(t => t.id === taskId);
    const rate = taskObj ? Number(taskObj.defaultRate || 0) : 0;
    const newRows = [...batchLogRows];
    newRows[idx] = {
      ...newRows[idx],
      taskId: taskId,
      unitRate: rate
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
          unitRate: Number(r.unitRate) || 0
        }));

        await fetchJson('/piecework/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });

        hotToast.success(`${items.length} ردیف کارکرد با موفقیت ثبت شد`);
      }

      setIsLogModalOpen(false);
      loadData();
    } catch (err) {
      hotToast.error(err.message || 'خطا در ثبت کارکرد');
    } finally {
      setIsSavingLog(false);
    }
  };

  const handleDeleteLog = async (id: number) => {
    if (await confirmAction({ title: 'حذف ردیف کارکرد', message: 'آیا از حذف این ردیف کارکرد اطمینان دارید؟' })) {
      try {
        await fetchJson(`/piecework/logs/${id}`, { method: 'DELETE' });
        hotToast.success('ردیف کارکرد حذف شد');
        loadData();
      } catch (err) {
        hotToast.error(err.message || 'خطا در حذف کارکرد');
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
      loadData();
    } catch (err) {
      hotToast.error(err.message || 'خطا در ذخیره عنوان کاری');
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
        loadData();
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
        loadData();
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
      hotToast.error(err.message || 'خطا در دریافت نرخ‌های اختصاصی');
    }
  };

  const handleSelectPersonnelForRates = (id: number | '') => {
    setSelectedPersonnelForRates(id);
    if (id) {
      loadCustomRates(Number(id));
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
      hotToast.error(err.message || 'خطا در ذخیره نرخ اختصاصی');
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
      l.date >= payrollStartDate &&
      l.date <= payrollEndDate
    );
  }, [logsList, payrollPersonnelId, payrollStartDate, payrollEndDate]);

  // V10-4.4: آیا پرسنل انتخاب‌شده برای صدور فیش به سهم حقوق ثابت نیازمند ردیف کارکرد نیست؟
  const selectedPayrollPerson = (personnelList as any[]).find((p: any) => String(p.id) === String(payrollPersonnelId));
  const payrollFixedIncluded =
    selectedPayrollPerson != null &&
    ['monthly_fixed', 'mixed'].includes(String(selectedPayrollPerson.salaryType || 'none'));

  // V1.3.2: سهم باقی‌مانده حقوق ثابت برای ماهِ انتخابی (حقوق ماهانه فقط یک بار در ماه)
  const payrollFixedRemainingHint = useMemo<string | null>(() => {
    if (!payrollFixedIncluded || !selectedPayrollPerson) return null;
    const monthly = Number(selectedPayrollPerson.monthlySalary || 0);
    if (monthly <= 0) return null;
    const monthKey = String(payrollStartDate || '').slice(0, 7);
    if (!monthKey) return null;
    const safePayrollsList = Array.isArray(payrollsList) ? payrollsList : [];
    const sameMonth = safePayrollsList.filter(pr =>
      Number(pr.personnelId) === Number(payrollPersonnelId) &&
      String((pr as any).startDate || '').slice(0, 7) === monthKey
    );
    const alreadyGranted = sameMonth.reduce((s, pr) => s + Number((pr as any).totalFixedAmount || 0), 0);
    if (alreadyGranted <= 0) {
      return `سهم حقوق ثابت این ماه (${formatPersianPrice(monthly)}) به‌طور کامل در این فیش محاسبه می‌شود.`;
    }
    const remaining = Math.max(0, monthly - alreadyGranted);
    if (remaining <= 0) {
      return 'هشدار: سهم حقوق ثابت ماه انتخابی قبلاً در فیش(های) دیگر محاسبه شده است — در این فیش مبلغ ثابتی اضافه نمی‌شود و فقط کارکرد پرکیسی پرداخت خواهد شد.';
    }
    return `سهم حقوق ثابت این ماه قبلاً ${formatPersianPrice(alreadyGranted)} در فیش(های) دیگر محاسبه شده؛ فقط مبلغ باقی‌مانده (${formatPersianPrice(remaining)}) به این فیش اضافه می‌شود.`;
  }, [payrollFixedIncluded, selectedPayrollPerson, payrollsList, payrollPersonnelId, payrollStartDate]);

  const handleGeneratePayroll = async (e: FormEvent) => {
    e.preventDefault();
    if (isSavingPayroll) return;

    if (!payrollPersonnelId || !payrollStartDate || !payrollEndDate) {
      hotToast.error('پرسنل و بازه تاریخی الزامی هستند');
      return;
    }

    // V10-4.4: برای پرسنل با حقوق ثابت/ترکیبی، صدور فیش بدون ردیف کارکرد نیز مجاز است
    // V1.3.2: سهم ثابت فقط یک بار در هر ماه جلالی — مطابق منطق سمت سرور
    const selectedPerson = (personnelList as any[]).find((p: any) => String(p.id) === String(payrollPersonnelId));
    const salaryType = String(selectedPerson?.salaryType || 'none');
    const fixedIncluded = salaryType === 'monthly_fixed' || salaryType === 'mixed';
    const monthly = fixedIncluded ? Number(selectedPerson?.monthlySalary || 0) : 0;
    const monthKey = String(payrollStartDate || '').slice(0, 7);
    const alreadyGranted = fixedIncluded && monthKey
      ? (Array.isArray(payrollsList) ? payrollsList : [])
          .filter(pr => Number(pr.personnelId) === Number(payrollPersonnelId) && String(pr.startDate || '').slice(0, 7) === monthKey)
          .reduce((s, pr) => s + Number(pr.totalFixedAmount || 0), 0)
      : 0;
    const fixedPortion = Math.max(0, monthly - alreadyGranted);

    if (payrollPreviewLogs.length === 0 && fixedPortion <= 0) {
      hotToast.error(alreadyGranted > 0
        ? 'سهم حقوق ثابت این ماه قبلاً در فیش دیگری محاسبه شده و کارکرد پرکیسی معوقی هم در این بازه وجود ندارد'
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
      loadData();
      setActiveTab('payrolls');
    } catch (err) {
      hotToast.error(err.message || 'خطا در صدور فیش حقوقی');
    } finally {
      setIsSavingPayroll(false);
    }
  };

  const handleViewPayslip = async (id: number) => {
    try {
      const res = await fetchJson(`/piecework/payrolls/${id}`);
      setViewingPayroll(res);
    } catch (err) {
      hotToast.error(err.message || 'خطا در دریافت جزئیات فیش');
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
      loadData();
    } catch (err) {
      hotToast.error(err.message || 'خطا در به‌روزرسانی وضعیت فیش');
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
        loadData();
      } catch (err) {
        hotToast.error(err.message || 'خطا در ابطال فیش حقوقی');
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
      const matchStart = !startDateFilter || log.date >= startDateFilter;
      const matchEnd = !endDateFilter || log.date <= endDateFilter;
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
