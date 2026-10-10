import { useState, useMemo } from 'react';
import { 
  useMyTasksQuery,
  useTaskStatsQuery,
  useExecuteTaskMutation,
  WorkflowState,
  WorkflowInstance
} from '../hooks/queries';
import { 
  Inbox, 
  CheckCircle2, 
  Clock, 
  FileText, 
  FolderKanban, 
  Package, 
  Search,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckSquare,
  UserCheck,
  User,
  Banknote,
  Layers,
} from 'lucide-react';
import { formatPersianDate, formatPersianPrice, formatPersianNumber } from '../utils';
import { useApprovalTaskEntity } from '../hooks/useApprovalTaskEntity';
import { workflowEntityTypeLabel } from '../lib/workflow/workflowEntityLabels';
// V9 Phase 5.2: مودال‌های مودولار کارتابل — استخراج از بدنه صفحه (FE-003)
import TaskExecuteModal, { type ApprovalRejectOption } from '../components/approval/TaskExecuteModal';
import PrintDocModal from '../components/approval/PrintDocModal';
import type { ApprovalDocumentDetails } from '../components/approval/DocumentDetailsPreview';
import { PHONE_TAP_TARGET } from '../lib/pwa/phoneLayout';
import { PillBadge, type PillBadgeVariant, type PillBadgeVariants } from '../components/common/PillBadge';

type DocumentDetails = ApprovalDocumentDetails;

interface EntityContextData {
  priority?: string;
  amount?: number;
  totalAmount?: number;
  refNumber?: string;
  buyerName?: string;
  buyerCity?: string;
  createdByName?: string;
  currency?: string;
  notes?: string;
  [key: string]: unknown;
}

interface TaskItem {
  id: number;
  instanceId?: number;
  workflowInstanceId?: number;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  assigneeId?: number;
  delegatedToId?: number;
  dueAt?: string;
  /** v9.0.41 (TD-448): تأخیر از زمان پایگاه‌داده */
  isOverdue?: boolean;
  createdAt: string;
  completedAt?: string;
  instance?: WorkflowInstance;
  currentState?: WorkflowState;
  entityType?: string;
  entityId?: string | number;
  entity_type?: string;
  entity_id?: string | number;
  entityContext?: EntityContextData;
  refNumber?: string;
  buyerName?: string;
  amount?: number;
  totalAmount?: number;
  currency?: string;
  notes?: string;
  /** TD-465: عنوان گام جاری از تصویر فرایند */
  currentStepTitle?: string;
  /** TD-465: تفویضی که کار را به کاربر رسانده */
  delegationInfo?: { delegatedFromUserId?: number; delegationScope?: string | null } | null;
  /** TD-463: اقدام‌های «رد» گام جاری */
  rejectTransitions?: ApprovalRejectOption[];
}


// v7.0.86 (TD-108): نشان اولویت کارتابل؛ برچسب‌های فارسی هم پذیرفته می‌شوند
const APPROVAL_PRIORITY_BASE = 'px-2 py-0.5 rounded-md text-[10px] font-bold border';
const approvalCritical: PillBadgeVariant = { label: 'اولویت بسیار بالا', className: `${APPROVAL_PRIORITY_BASE} bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800` };
const approvalHigh: PillBadgeVariant = { label: 'اولویت بالا', className: `${APPROVAL_PRIORITY_BASE} bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800` };
const approvalUrgent: PillBadgeVariant = { label: 'اولویت فوری', className: `${APPROVAL_PRIORITY_BASE} bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800` };
const approvalNormal: PillBadgeVariant = { label: 'اولویت عادی', className: `${APPROVAL_PRIORITY_BASE} bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200 dark:border-sky-800` };
const approvalLow: PillBadgeVariant = { label: 'اولویت پایین', className: `${APPROVAL_PRIORITY_BASE} bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700` };
const APPROVAL_PRIORITY_BADGES: PillBadgeVariants = {
  critical: approvalCritical, 'خیلی زیاد': approvalCritical,
  high: approvalHigh, 'بالا': approvalHigh, 'زیاد': approvalHigh,
  low: approvalLow, 'پایین': approvalLow, 'کم': approvalLow,
  // v10.0.149 (TD-1178): the purchase requisition priorities (REQUISITION_PRIORITIES); «normal» showed as «متوسط»
  urgent: approvalUrgent, 'فوری': approvalUrgent,
  normal: approvalNormal, 'عادی': approvalNormal,
};
const APPROVAL_PRIORITY_FALLBACK: PillBadgeVariant = { label: 'اولویت متوسط', className: `${APPROVAL_PRIORITY_BASE} bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800` };

/** The entity's own number (document number, requisition code); a bare numeric value gets Persian digits */
function inboxEntityRef(refNumber: unknown, entityId: unknown): string {
  const ref = String(refNumber ?? '').trim() || String(entityId ?? '').trim();
  return /^\d+$/.test(ref) ? formatPersianNumber(Number(ref)) : ref;
}

function ApprovalPriorityBadge({ priority }: { priority?: string }) {
  return <PillBadge variants={APPROVAL_PRIORITY_BADGES} value={(priority || 'medium').toLowerCase()} fallback={APPROVAL_PRIORITY_FALLBACK} />;
}

export function ApprovalInboxPage() {
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('pending');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [taskAction, setTaskAction] = useState<'approve' | 'reject'>('approve');
  const [comment, setComment] = useState<string>('');
  const [rejectTransitionId, setRejectTransitionId] = useState<number | null>(null);
  
  const [printDoc, setPrintDoc] = useState<DocumentDetails | null>(null);
  const { docDetails, isLoadingDoc, requisitionDetails, isLoadingRequisition } = useApprovalTaskEntity(selectedTask);

  const { data: myTasksData, isLoading: isTasksLoading, isFetching, refetch: refetchTasks } = useMyTasksQuery(taskStatusFilter);
  const { data: taskStats, refetch: refetchStats } = useTaskStatsQuery();

  const executeTaskMutation = useExecuteTaskMutation();

  const rawTasks = Array.isArray(myTasksData) ? myTasksData : (Array.isArray(myTasksData?.data) ? myTasksData.data : []);
  const myTasks: TaskItem[] = rawTasks;

  const handleRefreshAll = () => {
    void refetchTasks();
    void refetchStats();
  };

  const filteredTasks = useMemo(() => {
    const seenInstances = new Set<number | string>();
    return myTasks.filter((t) => {
      if (!t) return false;
      const instId = t.instanceId || t.instance?.id;
      if (instId && seenInstances.has(instId)) {
        return false;
      }
      if (instId) seenInstances.add(instId);

      const tEntityType = t.instance?.entityType || t.entityType || 'document';
      const tEntityId = t.instance?.entityId || t.entityId || '';
      if (activeTab !== 'all' && tEntityType !== activeTab) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const titleMatch = t.title?.toLowerCase().includes(q);
        const descMatch = t.description?.toLowerCase().includes(q);
        const entityIdMatch = String(tEntityId).toLowerCase().includes(q);
        return titleMatch || descMatch || entityIdMatch;
      }
      return true;
    });
  }, [myTasks, activeTab, search]);

  // TD-462 (یافته B14-20): هر بار باز یا بسته شدن کار، تصمیم و توضیح از نو آغاز می‌شوند؛ پیش‌تر «رد» و دلیلِ کاری
  // که انصراف خورده بود برای کار بعدی از پیش انتخاب‌شده می‌ماند و ثبت، کار دوم را با دلیل کار اول رد می‌کرد
  const resetDecision = () => {
    setTaskAction('approve');
    setComment('');
    setRejectTransitionId(null);
  };
  const openTask = (task: TaskItem) => {
    resetDecision();
    setSelectedTask(task);
  };
  const closeTask = () => {
    resetDecision();
    setSelectedTask(null);
  };

  const handleExecuteTask = () => {
    if (!selectedTask) return;
    executeTaskMutation.mutate(
      {
        taskId: selectedTask.id,
        action: taskAction,
        comment,
        // TD-463 (یافته B14-21): اقدام «رد» انتخابی وقتی گام بیش از یکی دارد
        ...(taskAction === 'reject' && rejectTransitionId !== null ? { transitionId: rejectTransitionId } : {})
      },
      {
        onSuccess: () => {
          closeTask();
          handleRefreshAll();
        }
      }
    );
  };

  const getEntityTypeLabel = (type: string) => {
    switch (type) {
      case 'document':
        return { label: 'فاکتور / سند انبار', icon: FileText, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
      case 'project':
        return { label: 'پروژه تولید', icon: FolderKanban, color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' };
      case 'pending_material':
        return { label: 'ماده اولیه معلق', icon: Package, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' };
      default:
        return { label: workflowEntityTypeLabel(type), icon: FileText, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' };
    }
  };


  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl text-indigo-600 dark:text-indigo-400">
              <Inbox className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                کارتابل تأییدها و کارها
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                کارهای تأیید، مهلت انجام و تفویض اختیار
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleRefreshAll}
          disabled={isFetching || isTasksLoading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg transition-colors shadow-sm self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching || isTasksLoading ? 'animate-spin' : ''}`} />
          <span>به‌روزرسانی کارتابل</span>
        </button>
      </div>

      {/* Task Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <button
          type="button"
          onClick={() => setTaskStatusFilter('pending')}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'pending'
              ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50/20 dark:bg-blue-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
          }`}
        >
          <div>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block">وظایف معلق</span>
            <span className="text-2xl font-black text-gray-900 dark:text-white">{formatPersianNumber(taskStats?.pendingCount ?? 0)}</span>
          </div>
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
            <CheckSquare className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setTaskStatusFilter('overdue')}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'overdue'
              ? 'ring-2 ring-rose-500 border-rose-500 bg-rose-50/20 dark:bg-rose-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-rose-300'
          }`}
        >
          <div>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block">دارای تأخیر</span>
            <span className="text-2xl font-black text-rose-600 dark:text-rose-400">{formatPersianNumber(taskStats?.overdueCount ?? 0)}</span>
          </div>
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setTaskStatusFilter('delegated')}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'delegated'
              ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'
          }`}
        >
          <div>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block">دریافتی از تفویض</span>
            <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{formatPersianNumber(taskStats?.delegatedCount ?? 0)}</span>
          </div>
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <UserCheck className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setTaskStatusFilter('completed')}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'completed'
              ? 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300'
          }`}
        >
          <div>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block">تکمیل‌شده</span>
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{formatPersianNumber(taskStats?.completedCount ?? 0)}</span>
          </div>
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </button>
      </div>

      {/* Main Mode View Toggle */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو بر اساس شماره یا عنوان..."
              className="w-full pl-3 pr-9 py-2.5 sm:py-1.5 text-sm sm:text-xs rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Sub Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto w-full mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          {[
            { id: 'all', label: 'همه موجودیت‌ها', icon: Inbox },
            { id: 'document', label: 'اسناد و فاکتورها', icon: FileText },
            { id: 'project', label: 'پروژه‌ها', icon: FolderKanban },
            { id: 'pending_material', label: 'مواد اولیه معلق', icon: Package }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-bold'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* کارتابل کارها (workflow_tasks)؛ v9.0.42 (TD-449، ت۷ الف): «نمای نمونه‌ها» حذف شد */}
      <>
          {isTasksLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 animate-pulse">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3"></div>
                  <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-2/3 mb-4"></div>
                  <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded w-full"></div>
                </div>
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base mb-1">
                {taskStatusFilter === 'completed'
                  ? 'هیچ وظیفه تکمیل‌شده‌ای در کارتابل شما یافت نشد!'
                  : taskStatusFilter === 'overdue'
                  ? 'هیچ کار دارای تأخیری نیست.'
                  : taskStatusFilter === 'delegated'
                  ? 'هیچ وظیفه تفویض‌شده‌ای یافت نشد!'
                  : 'هیچ وظیفه معلقی در کارتابل شما یافت نشد!'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                {taskStatusFilter === 'completed'
                  ? 'کارهایی که انجام دهید این‌جا نشان داده می‌شوند.'
                  : 'کاری برای تأیید شما در انتظار نیست.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((t) => {
                const typeMeta = getEntityTypeLabel(t.instance?.entityType || 'document');
                const TypeIcon = typeMeta.icon;
                const overdue = t.isOverdue === true;
                // TD-465 (یافته B14-23): فیلدهایی که ردیف کارتابل واقعاً دارد؛ مبلغ ریالی است
                const amount = Number(t.amount) || 0;
                const requesterName = t.instance?.startedByName || 'نامشخص';
                const stepTitle = t.currentStepTitle || t.currentState?.title || t.title;
                const isCompletedTask = t.status === 'approved' || t.status === 'rejected' || t.status === 'completed';

                return (
                  <div
                    key={t.id}
                    className={`bg-white dark:bg-gray-800 rounded-xl border p-4 hover:shadow-md transition-shadow flex flex-col justify-between ${
                      overdue && !isCompletedTask ? 'border-rose-300 dark:border-rose-800 bg-rose-50/10' : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div>
                      {/* Top Badges: Entity, Priority & Delegation */}
                      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${typeMeta.color}`}>
                          <TypeIcon className="w-3.5 h-3.5" />
                          {/* v10.0.149 (TD-1178): the entity's own number from the row, never its database id */}
                          <span>{typeMeta.label} {inboxEntityRef(t.refNumber, t.instance?.entityId)}</span>
                        </span>

                        <div className="flex items-center gap-1">
                          {isCompletedTask ? (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                              t.status === 'approved' 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' 
                                : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                            }`}>
                              {t.status === 'approved' ? 'تکمیل شده (تایید)' : 'تکمیل شده (رد)'}
                            </span>
                          ) : (
                            <ApprovalPriorityBadge priority={t.priority || t.entityContext?.priority} />
                          )}

                          {t.delegationInfo && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              <span>از تفویض</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Task Title & Description */}
                      <h3 className="font-bold text-gray-900 dark:text-white text-sm mb-1">
                        {t.title}
                      </h3>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mb-3 line-clamp-2">
                        {t.description}
                      </p>

                      {/* Key Context Grid: Requester, Amount, Step, SLA */}
                      <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 dark:bg-gray-700/40 p-2.5 rounded-lg mb-3">
                        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                          <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="truncate">متقاضی: <strong className="text-gray-800 dark:text-gray-100">{requesterName}</strong></span>
                        </div>

                        {amount > 0 && (
                          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                            <Banknote className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="truncate">ارزش: <strong className="text-emerald-700 dark:text-emerald-400">{formatPersianPrice(amount, 'IRR')}</strong></span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 col-span-2">
                          <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="truncate">گام جاری: <strong className="text-indigo-700 dark:text-indigo-300">{stepTitle}</strong></span>
                        </div>
                      </div>

                      {/* SLA Due Badge */}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        <div className="flex items-center gap-1">
                          <Clock className={`w-3.5 h-3.5 ${overdue && !isCompletedTask ? 'text-rose-500' : 'text-gray-400'}`} />
                          <span className={overdue && !isCompletedTask ? 'text-rose-600 font-bold dark:text-rose-400' : ''}>
                            {isCompletedTask && t.completedAt
                              ? `تاریخ تکمیل: ${formatPersianDate(t.completedAt)}`
                              : overdue
                              ? 'مهلت تأیید گذشته است.'
                              : `مهلت تأیید: ${formatPersianDate(t.dueAt)}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                      <button
                        onClick={() => openTask(t)}
                        className={`w-full sm:w-auto ${PHONE_TAP_TARGET} flex items-center justify-center gap-1 px-4 py-2 text-sm sm:text-xs font-bold rounded-xl transition-all shadow-sm ${
                          isCompletedTask
                            ? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        {isCompletedTask ? <FileText className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        <span>{isCompletedTask ? 'مشاهده جزئیات و سوابق' : 'بررسی و تعیین تکلیف وظیفه'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </>

      {/* V9 Phase 5.2: مودال‌های مودولار استخراج‌شده */}
      {selectedTask && (
        <TaskExecuteModal
          selectedTask={selectedTask}
          onClose={closeTask}
          docDetails={docDetails}
          isLoadingDoc={isLoadingDoc}
          requisitionDetails={requisitionDetails}
          isLoadingRequisition={isLoadingRequisition}
          onPrintDoc={setPrintDoc}
          taskAction={taskAction}
          onTaskActionChange={setTaskAction}
          comment={comment}
          onCommentChange={setComment}
          rejectOptions={selectedTask.rejectTransitions ?? []}
          rejectTransitionId={rejectTransitionId}
          onRejectTransitionChange={setRejectTransitionId}
          onExecute={handleExecuteTask}
          isExecuting={executeTaskMutation.isPending}
        />
      )}

      {printDoc && <PrintDocModal printDoc={printDoc} onClose={() => setPrintDoc(null)} />}

    </div>
  );
};


export default ApprovalInboxPage;

