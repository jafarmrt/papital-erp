import { useState, useEffect, useMemo, useCallback, useRef, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmAction } from '../components/ConfirmDialogHost';
import { fetchJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { usePieceworkPermissions } from './usePieceworkPermissions';
import { usePayrollPreviewLogs, usePieceworkLogList } from './usePieceworkLogList';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions';
import { QUERY_KEYS } from '../lib/queryKeys';
import { invalidateAfterTreasuryChange } from './accounting/accountingInvalidation';
import { usePersonnelListQuery } from './queries/usePersonnelQueries';
import { useProjectPickQuery } from './queries/useProjectQueries';
import {
  personnelRateMap,
  usePieceworkCategoriesQuery,
  usePieceworkPayrollsQuery,
  usePieceworkPersonnelRatesQuery,
  usePieceworkTasksQuery,
} from './queries/usePieceworkQueries';
import { pieceworkPayrollQuery, usePieceworkPayrollQuery } from './queries/usePayrollWindowQueries';
import {
  Personnel,
  PieceworkTask,
  PieceworkLog,
  PieceworkPayroll
} from '../types';
import { toast as hotToast } from 'react-hot-toast';
import { parseQuantityOrTime, formatPersianPrice, errorMessageOf, toStorageDate, getTodayIsoDate } from '../utils';
import { computeFixedSalaryShares, priorFixedGrantsOf } from '../lib/payroll/fixedSalaryProration';
import { fixedSalaryPeriodEnd, fixedSalaryPeriodStart, payrollPrepaymentError, serviceEndOf, serviceStartOf } from '../lib/payroll/payrollPeriod';
import { refreshSuggestedRates, submittedRate, suggestedRate } from '../lib/payroll/workLogRate';
import { EMPTY_STATUTORY_ENTRY, statutoryPayloadOf, type PayrollStatutoryEntry } from '../lib/payroll/statutoryForm';
import { withRowKey, withRowKeys, type KeyedRow } from '../lib/rowKey';
import { idempotentReplayMessage, isIdempotentReplay } from '../lib/idempotentReplay';
import {
  exportPieceworkTasksToExcel,
  downloadPieceworkTemplate
} from '../components/piecework/pieceworkExcelUtils';

export interface BatchLogRow extends KeyedRow {
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

const NO_PERSONNEL: Personnel[] = [];
const NO_TASKS: PieceworkTask[] = [];
const NO_PAYROLLS: PieceworkPayroll[] = [];
const NO_ROWS: any[] = [];
const NO_RATES: Record<number, number> = {};

export function usePiecework() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks' | 'rates' | 'payrolls' | 'project-costs'>('logs');

  // v7.0.59 (TD-223، تصمیم مالک محصول): مبالغ فیش‌ها فقط برای دارندگان مجوز فیش (همان گارد API)
  const { userPermissions } = useAuth();
  const canViewPayrolls = Boolean(
    userPermissions?.isAdmin ||
    (Array.isArray(userPermissions?.permissions) &&
      READ_PERMISSIONS.payrolls.some(p => userPermissions.permissions.includes(p)))
  );
  // حوزه H (TD-300): نرخ دستی کارکرد فقط برای مدیر تعرفه‌ها (همان قاعده سرور، در ثبت و ویرایش؛ v9.0.320، TD-805)
  const { canManageTasks: canSetLogRate } = usePieceworkPermissions();

  // Filters for Tasks
  const [taskCategoryFilter, setTaskCategoryFilter] = useState<string>('all');
  const [taskSearchQuery, setTaskSearchQuery] = useState<string>('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<'active' | 'archived' | 'all'>('active');

  // Core Data Lists. v10.2 package 11 part 5c (TD-1361, OBS-R2-102): React Query reads, each opening of the page reads
  // the personnel, titles, categories and payslips again; the project pick list is the cache of the other forms
  const personnelQuery = usePersonnelListQuery({ refetchOnMount: 'always' });
  const tasksQuery = usePieceworkTasksQuery(taskStatusFilter);
  const payrollsQuery = usePieceworkPayrollsQuery(canViewPayrolls);
  const projectsQuery = useProjectPickQuery();
  const categoriesQuery = usePieceworkCategoriesQuery();
  const personnelList = personnelQuery.data ?? NO_PERSONNEL;
  const tasksList = tasksQuery.data ?? NO_TASKS;
  const payrollsList = canViewPayrolls ? (payrollsQuery.data ?? NO_PAYROLLS) : NO_PAYROLLS;
  const projectsList: any[] = projectsQuery.data ?? NO_ROWS;
  // a category list that cannot be read leaves the categories of the titles, as before
  const taskCategories = categoriesQuery.data ?? NO_ROWS;
  const loading = personnelQuery.isPending || tasksQuery.isPending || (canViewPayrolls && payrollsQuery.isPending);
  const loadError = personnelQuery.error || tasksQuery.error || (canViewPayrolls ? payrollsQuery.error : null);
  useEffect(() => {
    if (!loadError) return;
    // v10.2.38 (#355 review): a title list that cannot be read is named, as before v10.2.37
    if (loadError === tasksQuery.error) hotToast.error('خطا در دریافت عناوین کاری: ' + (errorMessageOf(loadError) || ''));
    else hotToast.error(errorMessageOf(loadError) || 'خطا در دریافت اطلاعات کارمزدی');
  }, [loadError, tasksQuery.error]);

  // v9.0.330 (TD-811): فهرست کارکرد، فیلترها و جمع‌ها از سرور؛ پس از هر ثبت، ویرایش یا حذف دوباره خوانده می‌شوند
  const logList = usePieceworkLogList();

  // Modal 1: Create / Edit Work Logs
  const [isLogModalOpen, setIsLogModalOpen] = useState<boolean>(false);
  const [selectedPersonnelForLog, setSelectedPersonnelForLog] = useState<number | ''>('');
  const [defaultBatchProjectId, setDefaultBatchProjectId] = useState<number | ''>('');
  const [logDate, setLogDate] = useState<string>('');
  const [batchLogRows, setBatchLogRows] = useState<BatchLogRow[]>(() => withRowKeys<BatchLogRow>([
    { taskId: '', projectId: '', quantity: '1', unitRate: 0 }
  ]));
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

  // Tab 3: Custom Rates
  const [selectedPersonnelForRates, setSelectedPersonnelForRates] = useState<number | ''>('');
  const ratesTabQuery = usePieceworkPersonnelRatesQuery(selectedPersonnelForRates ? Number(selectedPersonnelForRates) : null);
  const customRatesMap = useMemo(
    () => (selectedPersonnelForRates && ratesTabQuery.data ? personnelRateMap(ratesTabQuery.data) : NO_RATES),
    [selectedPersonnelForRates, ratesTabQuery.data],
  );
  useEffect(() => {
    if (ratesTabQuery.error) hotToast.error(errorMessageOf(ratesTabQuery.error) || 'خطا در دریافت نرخ‌های اختصاصی');
  }, [ratesTabQuery.error]);

  // Modal 3: Payroll Generation Modal
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState<boolean>(false);
  const [payrollPersonnelId, setPayrollPersonnelId] = useState<number | ''>('');
  const [payrollStartDate, setPayrollStartDate] = useState<string>('');
  const [payrollEndDate, setPayrollEndDate] = useState<string>('');
  const [payrollTitle, setPayrollTitle] = useState<string>('');
  const [payrollBonuses, setPayrollBonuses] = useState<number>(0);
  const [payrollDeductions, setPayrollDeductions] = useState<number>(0);
  // v9.0.329 (TD-861): شرح «سایر کسورات»؛ کسورات بالای صفر بی آن صادر نمی‌شود
  const [payrollDeductionsDescription, setPayrollDeductionsDescription] = useState<string>('');
  // V1.9.0: کسر از مساعده/وام پرسنلی — بستانکار حساب مساعده در سند تسویه
  const [payrollAdvanceDeduction, setPayrollAdvanceDeduction] = useState<number>(0);
  const [payrollNotes, setPayrollNotes] = useState<string>('');
  // v10.0.199 (TD-1085): فیش پیش‌پرداخت دوره آینده، فقط حقوق ثابت، با دلیل الزامی
  const [payrollIsPrepayment, setPayrollIsPrepayment] = useState<boolean>(false);
  const [payrollPrepaymentReason, setPayrollPrepaymentReason] = useState<string>('');
  // v10.0.210 (TD-1087): بیمه و مالیات نوشته‌شده؛ کادر خالی یعنی پیشنهاد سرور
  const [payrollStatutory, setPayrollStatutory] = useState<PayrollStatutoryEntry>(EMPTY_STATUTORY_ENTRY);
  const [isSavingPayroll, setIsSavingPayroll] = useState<boolean>(false);

  // Modal 4: View Payslip. 10.3 (ARCH review finding 3, part 15): the window shows its payslip's cache entry, so a payment,
  // approval or return to draft made from it shows at once; before, it kept the figures it opened with (a paid slip still
  // offered «بازگشت به پیش‌نویس» and its old remainder) until it was opened again
  const [viewingPayrollId, setViewingPayrollId] = useState<number | null>(null);
  const viewingPayrollRead = usePieceworkPayrollQuery(viewingPayrollId);
  const viewingPayroll = viewingPayrollId === null ? null : viewingPayrollRead.data ?? null;
  /** the slip on screen while it is read again after a write, or when that read failed: its writes wait */
  const viewingPayrollFreshness = viewingPayrollRead.isFetching
    ? 'refreshing' as const
    : viewingPayrollRead.errorUpdatedAt > viewingPayrollRead.dataUpdatedAt ? 'failed' as const : 'current' as const;
  /** the payslip last clicked: an earlier click's late answer never opens its window over it */
  const askedPayslip = useRef<number | null>(null);

  /** Reads every piecework list of the page again (titles, categories, payslips, work logs, rates) */
  const reloadAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all });
  }, [queryClient]);

  /**
   * A payslip issue, approval, draft edit, delete, payment or payment void writes a voucher and, for a payment, a
   * treasury row: the page and the accounting and treasury screens read them again (the `piecework` domain included).
   */
  const reloadAfterPayrollChange = useCallback(() => {
    void invalidateAfterTreasuryChange(queryClient);
  }, [queryClient]);

  /** the titles of another status come from their own cache entry, so a late answer never shows under another status */
  const handleTaskStatusFilterChange = (status: 'active' | 'archived' | 'all') => {
    setTaskStatusFilter(status);
  };

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
  const logRatesPersonnel = isLogModalOpen && !editingLog && selectedPersonnelForLog ? Number(selectedPersonnelForLog) : null;
  const logRatesQuery = usePieceworkPersonnelRatesQuery(logRatesPersonnel);
  const logRatesData = logRatesPersonnel !== null ? logRatesQuery.data : undefined;
  useEffect(() => {
    if (!logRatesData) {
      setLogPersonnelRates({});
      return;
    }
    const map = personnelRateMap(logRatesData);
    setLogPersonnelRates(map);
    setBatchLogRows(rows => refreshSuggestedRates(rows, tasksList, map));
  }, [logRatesData, tasksList]);

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
      withRowKey<BatchLogRow>({ taskId: '', projectId: defaultBatchProjectId || '', quantity: '1', unitRate: 0 })
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
    setBatchLogRows(withRowKeys<BatchLogRow>([{ taskId: '', projectId: '', quantity: '1', unitRate: 0 }]));
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
      reloadAll();
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
        reloadAll();
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
      reloadAll();
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
        reloadAll();
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
        reloadAll();
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
  const handleSelectPersonnelForRates = (id: number | '') => {
    setSelectedPersonnelForRates(id);
  };

  const handleSaveCustomRate = async (taskId: number, customRate: string) => {
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
      // v9.0.284 (TD-809): نرخ نمایش‌داده همان است که سرور ذخیره کرد و کارکرد می‌گیرد
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.personnelRates(Number(selectedPersonnelForRates)) });
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
    setPayrollDeductionsDescription('');
    // OBS-R2-51: the previous payslip's advance deduction never carries over to the next one
    setPayrollAdvanceDeduction(0);
    setPayrollNotes('');
    setPayrollIsPrepayment(false);
    setPayrollPrepaymentReason('');
    setPayrollStatutory(EMPTY_STATUTORY_ENTRY);
    setIsPayrollModalOpen(true);
  };

  // Preview pending logs for payroll issuance (v9.0.330، TD-811: از سرور)
  const payrollPreviewLogs = usePayrollPreviewLogs(isPayrollModalOpen, payrollPersonnelId, payrollStartDate, payrollEndDate);

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
    // v9.0.268 (TD-808): حقوق ثابت فقط تا پایان همکاری — همان قاعده سرور
    const fixedEnd = fixedSalaryPeriodEnd(startIso, endIso, serviceEndOf(selectedPayrollPerson));
    if (fixedEnd === null) return null;
    // v10.0.199 (TD-1086): حقوق ثابت از «آغاز همکاری» — همان قاعده سرور
    const fixedStart = fixedSalaryPeriodStart(startIso, fixedEnd, serviceStartOf(selectedPayrollPerson));
    if (fixedStart === null) return null;
    const personPayrolls = (Array.isArray(payrollsList) ? payrollsList : []).filter(pr => Number(pr.personnelId) === Number(payrollPersonnelId));
    return computeFixedSalaryShares(selectedPayrollPerson.monthlySalary, fixedStart, fixedEnd, personPayrolls.flatMap(priorFixedGrantsOf));
  }, [payrollFixedIncluded, selectedPayrollPerson, payrollsList, payrollPersonnelId, payrollStartDate, payrollEndDate]);

  const payrollFixedRemainingHint = useMemo<string | null>(() => {
    if (!payrollFixedShares || payrollFixedShares.months.length === 0) return null;
    if (!payrollFixedShares.total.isPositive()) {
      return 'هشدار: سهم حقوق ثابت این بازه قبلاً در فیش(های) دیگر محاسبه شده است — در این فیش مبلغ ثابتی اضافه نمی‌شود و فقط کارکرد کارمزدی پرداخت خواهد شد.';
    }
    const parts = payrollFixedShares.months.map(m => `${m.month}: ${m.days} از ${m.monthDays} روز (${formatPersianPrice(Number(m.amount))})`);
    return `سهم حقوق ثابت این فیش ${formatPersianPrice(payrollFixedShares.total.toNumber())} است — ${parts.join('، ')}.`;
  }, [payrollFixedShares]);

  // v10.0.210 (TD-1087): ناخالص فیش برای پیشنهاد بیمه و مالیات — کارکرد (جز پیش‌پرداخت) + سهم حقوق ثابت + پاداش، همان جمع سرور
  const payrollStatutoryGross = useMemo(() => {
    const piecework = payrollIsPrepayment ? 0 : payrollPreviewLogs.reduce((sum, l) => sum + Number(l.totalAmount || 0), 0);
    return piecework + (payrollFixedShares?.total.toNumber() ?? 0) + Number(payrollBonuses || 0);
  }, [payrollIsPrepayment, payrollPreviewLogs, payrollFixedShares, payrollBonuses]);

  const handleGeneratePayroll = async (e: FormEvent) => {
    e.preventDefault();
    if (isSavingPayroll) return;

    if (!payrollPersonnelId || !payrollStartDate || !payrollEndDate) {
      hotToast.error('پرسنل و بازه تاریخی الزامی هستند');
      return;
    }
    // v9.0.268 (TD-808)، v10.0.199 (TD-1085): دوره آینده فقط با «فیش پیش‌پرداخت» و دلیل — همان قاعده و پیام سرور
    const periodRefusal = payrollPrepaymentError(toStorageDate(payrollEndDate) || '', getTodayIsoDate(), { isPrepayment: payrollIsPrepayment, prepaymentReason: payrollPrepaymentReason });
    if (periodRefusal) {
      hotToast.error(periodRefusal.message);
      return;
    }

    // V10-4.4: برای پرسنل با حقوق ثابت/ترکیبی، صدور فیش بدون ردیف کارکرد نیز مجاز است
    // v8.0.30 (TD-284): سهم ثابت هر ماه شمسیِ بازه به نسبت روزها — مطابق منطق سمت سرور
    if ((payrollIsPrepayment || payrollPreviewLogs.length === 0) && !(payrollFixedShares?.total.isPositive() ?? false)) {
      hotToast.error(payrollFixedShares && payrollFixedShares.months.length > 0
        ? 'سهم حقوق ثابت این بازه قبلاً در فیش دیگری محاسبه شده و کارکرد کارمزدی معوقی هم در این بازه وجود ندارد'
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
        deductionsDescription: payrollDeductions > 0 ? payrollDeductionsDescription.trim() : undefined,
        advanceDeduction: payrollAdvanceDeduction || 0,
        notes: payrollNotes || undefined,
        isPrepayment: payrollIsPrepayment || undefined,
        prepaymentReason: payrollIsPrepayment ? payrollPrepaymentReason.trim() : undefined,
        ...statutoryPayloadOf(payrollStatutory)
      };

      const res = await fetchJson('/piecework/payrolls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        acceptReplay: true,
      });

      // v10.2.34 (#351 review L1): a repeat of an issue that already ran has no payslip number; the list shows the payslip
      if (isIdempotentReplay(res)) {
        hotToast(idempotentReplayMessage(res), { icon: 'ℹ️' });
      } else {
        hotToast.success(`فیش حقوقی شماره ${res.payrollNumber || ''} پیش‌نویس صادر شد؛ پرداخت آن پس از تأیید کاربر دیگری است.`);
        if (res.statutoryWarning) hotToast(res.statutoryWarning, { icon: '⚠️' });
        if (res.eidiWarning) hotToast(res.eidiWarning, { icon: '⚠️' });
      }
      setIsPayrollModalOpen(false);
      reloadAfterPayrollChange();
      setActiveTab('payrolls');
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در صدور فیش حقوقی');
    } finally {
      setIsSavingPayroll(false);
    }
  };

  const handleViewPayslip = async (id: number) => {
    askedPayslip.current = id;
    try {
      await queryClient.fetchQuery({ ...pieceworkPayrollQuery(id), staleTime: 0 });
      if (askedPayslip.current === id) setViewingPayrollId(id);
    } catch (err) {
      if (askedPayslip.current === id) hotToast.error(errorMessageOf(err) || 'خطا در دریافت جزئیات فیش');
    }
  };

  const closePayslip = () => {
    askedPayslip.current = null;
    setViewingPayrollId(null);
  };

  const handleUpdatePayrollStatus = async (id: number, status: 'draft' | 'approved' | 'paid') => {
    try {
      await fetchJson(`/piecework/payrolls/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      hotToast.success(status === 'approved' ? 'فیش تأیید شد و آماده پرداخت است.' : 'فیش به پیش‌نویس برگشت.');
      reloadAfterPayrollChange();
    } catch (err) {
      hotToast.error(errorMessageOf(err) || 'خطا در به‌روزرسانی وضعیت فیش');
    }
  };

  const handleDeletePayroll = async (id: number) => {
    if (await confirmAction({ title: 'ابطال فیش حقوقی', message: 'آیا از ابطال این فیش حقوقی اطمینان دارید؟ تمامی کارکردهای آن مجدداً به حالت «در انتظار» برمی‌گردند.' })) {
      try {
        await fetchJson(`/piecework/payrolls/${id}`, { method: 'DELETE' });
        hotToast.success('فیش حقوقی با موفقیت ابطال و حذف شد');
        if (viewingPayrollId === id) closePayslip();
        // the slip is gone: its window's entry is dropped first, so the refresh never reads it again
        queryClient.removeQueries({ queryKey: QUERY_KEYS.piecework.payroll(id), exact: true });
        reloadAfterPayrollChange();
      } catch (err) {
        hotToast.error(errorMessageOf(err) || 'خطا در ابطال فیش حقوقی');
      }
    }
  };

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

  return {
    canViewPayrolls,
    canSetLogRate,
    activeTab,
    setActiveTab,
    personnelList,
    tasksList,
    payrollsList,
    projectsList,
    loading,
    loadData: reloadAll,
    reloadAfterPayrollChange,
    ...logList,
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
    payrollDeductionsDescription,
    setPayrollDeductionsDescription,
    payrollNotes,
    setPayrollNotes,
    payrollIsPrepayment,
    payrollStatutory,
    setPayrollStatutory,
    payrollStatutoryGross,
    setPayrollIsPrepayment,
    payrollPrepaymentReason,
    setPayrollPrepaymentReason,
    payrollFixedIncluded,
    payrollFixedRemainingHint,
    payrollAdvanceDeduction,
    setPayrollAdvanceDeduction,
    viewingPayroll,
    viewingPayrollFreshness,
    closePayslip,
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
    filteredTasks
  };
}
