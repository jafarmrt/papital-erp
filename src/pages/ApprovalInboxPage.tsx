import React, { useState, useEffect } from 'react';
import { 
  useWorkflowInboxQuery, 
  useExecuteTransitionMutation,
  useMyTasksQuery,
  useTaskStatsQuery,
  useExecuteTaskMutation,
  WorkflowTransition,
  WorkflowState,
  WorkflowInstance
} from '../hooks/queries';
import { 
  Inbox, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Filter, 
  FileText, 
  FolderKanban, 
  Package, 
  Send, 
  MessageSquare,
  Search,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Users,
  CheckSquare,
  UserCheck,
  User,
  Banknote,
  Flag,
  Layers,
  Printer,
  X,
  ExternalLink,
  MapPin,
  Phone
} from 'lucide-react';
import { formatPersianDate, formatPersianPrice, formatPersianNumber } from '../utils';
import { fetchJson } from '../api';
import toast from 'react-hot-toast';
// V9 Phase 5.2: مودال‌های مودولار کارتابل — استخراج از بدنه صفحه (FE-003)
import TaskExecuteModal, { ApprovalTaskAction } from '../components/approval/TaskExecuteModal';
import TransitionExecuteModal from '../components/approval/TransitionExecuteModal';
import PrintDocModal from '../components/approval/PrintDocModal';
import type { ApprovalDocumentDetails } from '../components/approval/DocumentDetailsPreview';

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
  isDelegated?: boolean;
  dueAt?: string;
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
}

interface InboxItem {
  instance: WorkflowInstance;
  definition?: {
    id: number;
    code: string;
    title: string;
    entityType: string;
  };
  currentState?: WorkflowState;
  availableTransitions?: WorkflowTransition[];
  entityContext?: EntityContextData;
  entityType?: string;
  entityId?: string | number;
  id?: number;
  createdAt?: string | Date;
}

const getPriorityBadge = (priority?: string) => {
  const p = (priority || 'medium').toLowerCase();
  switch (p) {
    case 'critical':
    case 'خیلی زیاد':
      return { label: 'اولویت بسیار بالا', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
    case 'high':
    case 'بالا':
    case 'زیاد':
      return { label: 'اولویت بالا', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
    case 'low':
    case 'پایین':
    case 'کم':
      return { label: 'اولویت عادی', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700' };
    default:
      return { label: 'اولویت متوسط', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
  }
};

export const ApprovalInboxPage: React.FC = () => {
  const [inboxView, setInboxView] = useState<'tasks' | 'instances'>('tasks');
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('pending');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<{ item: InboxItem; transition: WorkflowTransition } | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [taskAction, setTaskAction] = useState<'approve' | 'reject'>('approve');
  const [comment, setComment] = useState<string>('');
  
  // Document details state for rich preview in modal
  const [docDetails, setDocDetails] = useState<DocumentDetails | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false);
  const [printDoc, setPrintDoc] = useState<DocumentDetails | null>(null);

  const { data: inboxData, isLoading, refetch, isFetching } = useWorkflowInboxQuery();
  const { data: myTasksData, isLoading: isTasksLoading, refetch: refetchTasks } = useMyTasksQuery(taskStatusFilter);
  const { data: taskStats, refetch: refetchStats } = useTaskStatsQuery();

  const executeTransitionMutation = useExecuteTransitionMutation();
  const executeTaskMutation = useExecuteTaskMutation();

  const rawItems = Array.isArray(inboxData) ? inboxData : (Array.isArray(inboxData?.data) ? inboxData.data : []);
  const items: InboxItem[] = rawItems;
  const rawTasks = Array.isArray(myTasksData) ? myTasksData : (Array.isArray(myTasksData?.data) ? myTasksData.data : []);
  const myTasks: TaskItem[] = rawTasks;

  // Fetch document details when a task or transition item is opened
  useEffect(() => {
    const itemObj = selectedTask || selectedItem?.item;
    const entityType = selectedTask?.instance?.entityType || selectedTask?.entityType || selectedTask?.entity_type || selectedItem?.item?.instance?.entityType || selectedItem?.item?.entityType || 'document';
    const entityId = selectedTask?.instance?.entityId || selectedTask?.entityId || selectedTask?.entity_id || selectedItem?.item?.instance?.entityId || selectedItem?.item?.entityId;

    const isDoc = entityType === 'document' || entityType === 'doc' || entityType === 'invoice' || entityType === 'proforma';

    if (isDoc && entityId) {
      setIsLoadingDoc(true);

      // Prepopulate with cached context from task/item if available
      const cachedContext = itemObj?.entityContext;
      if (cachedContext && (cachedContext.buyerName || cachedContext.refNumber || cachedContext.amount)) {
        setDocDetails({
          ref_number: cachedContext.refNumber || itemObj?.refNumber || String(entityId),
          buyer_name: cachedContext.buyerName || itemObj?.buyerName || '',
          buyer_city: cachedContext.buyerCity || '',
          total_amount: cachedContext.amount || cachedContext.totalAmount || itemObj?.amount || 0,
          currency: cachedContext.currency || 'IRR',
          notes: cachedContext.notes || '',
          items: []
        });
      }

      fetchJson<DocumentDetails>(`/documents/${entityId}`)
        .then((res) => {
          const doc = (res as { data?: DocumentDetails })?.data ? (res as { data: DocumentDetails }).data : (res as DocumentDetails);
          if (doc && (doc.id || doc.refNumber || doc.ref_number)) {
            setDocDetails(doc);
          } else if (cachedContext && (cachedContext.buyerName || cachedContext.amount)) {
            setDocDetails({
              ref_number: cachedContext.refNumber || itemObj?.refNumber || String(entityId),
              buyer_name: cachedContext.buyerName || itemObj?.buyerName || '',
              buyer_city: cachedContext.buyerCity || '',
              total_amount: cachedContext.amount || cachedContext.totalAmount || itemObj?.amount || 0,
              currency: cachedContext.currency || 'IRR',
              items: []
            });
          }
        })
        .catch((err) => {
          console.error('Could not load document details:', err);
          if (cachedContext && (cachedContext.buyerName || cachedContext.amount)) {
            setDocDetails({
              ref_number: cachedContext.refNumber || itemObj?.refNumber || String(entityId),
              buyer_name: cachedContext.buyerName || itemObj?.buyerName || '',
              buyer_city: cachedContext.buyerCity || '',
              total_amount: cachedContext.amount || cachedContext.totalAmount || itemObj?.amount || 0,
              currency: cachedContext.currency || 'IRR',
              items: []
            });
          } else {
            setDocDetails(null);
            toast.error('خطا در دریافت جزئیات سند کارتابل');
          }
        })
        .finally(() => {
          setIsLoadingDoc(false);
        });
    } else {
      setDocDetails(null);
      setIsLoadingDoc(false);
    }
  }, [selectedTask, selectedItem]);

  const handleRefreshAll = () => {
    refetch();
    refetchTasks();
    refetchStats();
  };

  const filteredItems = items.filter((item) => {
    if (!item) return false;
    const itemEntityType = item.instance?.entityType || item.entityType || 'document';
    const itemEntityId = item.instance?.entityId || item.entityId || '';
    if (activeTab !== 'all' && itemEntityType !== activeTab) {
      return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const entityIdMatch = String(itemEntityId).toLowerCase().includes(q);
      const defMatch = item.definition?.title?.toLowerCase().includes(q);
      const stateMatch = item.currentState?.title?.toLowerCase().includes(q);
      return entityIdMatch || defMatch || stateMatch;
    }
    return true;
  });

  const filteredTasks = myTasks.filter((t) => {
    if (!t) return false;
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

  const handleExecuteTransition = () => {
    if (!selectedItem) return;
    const instId = selectedItem.item?.instance?.id || selectedItem.item?.id || 0;
    const entType = selectedItem.item?.instance?.entityType || selectedItem.item?.entityType || 'document';
    const entId = selectedItem.item?.instance?.entityId || selectedItem.item?.entityId;

    executeTransitionMutation.mutate(
      {
        instanceId: instId,
        transitionId: selectedItem.transition?.id,
        comment,
        entityType: entType,
        entityId: entId
      },
      {
        onSuccess: () => {
          setSelectedItem(null);
          setComment('');
          handleRefreshAll();
        }
      }
    );
  };

  const handleExecuteTask = () => {
    if (!selectedTask) return;
    executeTaskMutation.mutate(
      {
        taskId: selectedTask.id,
        action: taskAction,
        comment
      },
      {
        onSuccess: () => {
          setSelectedTask(null);
          setComment('');
          setTaskAction('approve');
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
        return { label: type, icon: FileText, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' };
    }
  };

  const getStateColorClass = (color: string) => {
    switch (color) {
      case 'emerald':
      case 'green':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'amber':
      case 'yellow':
        return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400';
      case 'rose':
      case 'red':
        return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400';
      case 'sky':
      case 'indigo':
      case 'blue':
        return 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const isOverdue = (dueAt?: string) => {
    if (!dueAt) return false;
    return new Date(dueAt).getTime() < new Date().getTime();
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
                کارتابل متمرکز تاییدات و وظایف
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                مدیریت وظایف تایید، پایش مهلت‌های SLA و تفویض اختیارات سازمانی
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
          onClick={() => { setTaskStatusFilter('pending'); setInboxView('tasks'); }}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'pending' && inboxView === 'tasks'
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
          onClick={() => { setTaskStatusFilter('overdue'); setInboxView('tasks'); }}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'overdue' && inboxView === 'tasks'
              ? 'ring-2 ring-rose-500 border-rose-500 bg-rose-50/20 dark:bg-rose-950/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-rose-300'
          }`}
        >
          <div>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 block">دارای تاخیر (SLA)</span>
            <span className="text-2xl font-black text-rose-600 dark:text-rose-400">{formatPersianNumber(taskStats?.overdueCount ?? 0)}</span>
          </div>
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => { setTaskStatusFilter('delegated'); setInboxView('tasks'); }}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'delegated' && inboxView === 'tasks'
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
          onClick={() => { setTaskStatusFilter('completed'); setInboxView('tasks'); }}
          className={`bg-white dark:bg-gray-800 rounded-xl p-4 border shadow-sm flex items-center justify-between text-right transition-all cursor-pointer ${
            taskStatusFilter === 'completed' && inboxView === 'tasks'
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInboxView('tasks')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                inboxView === 'tasks'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              نمایش بر اساس وظایف کارتابل
            </button>
            <button
              onClick={() => setInboxView('instances')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                inboxView === 'instances'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              نمایش بر اساس نمونه‌های ورکفلو
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو بر اساس شماره یا عنوان..."
              className="w-full pl-3 pr-9 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

      {/* View Mode 1: Tasks Inbox (workflow_tasks) */}
      {inboxView === 'tasks' && (
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
                  ? 'هیچ وظیفه دارای تاخیری یافت نشد!'
                  : taskStatusFilter === 'delegated'
                  ? 'هیچ وظیفه تفویض‌شده‌ای یافت نشد!'
                  : 'هیچ وظیفه معلقی در کارتابل شما یافت نشد!'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                {taskStatusFilter === 'completed'
                  ? 'سوابق تاییدات قبلی شما پس از تعیین تکلیف وظایف در این بخش نمایش داده می‌شوند.'
                  : 'کلیه وظایف تایید ارجاع شده به نقش یا کاربری شما با موفقیت به اتمام رسیده‌اند.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((t) => {
                const typeMeta = getEntityTypeLabel(t.instance?.entityType || 'document');
                const TypeIcon = typeMeta.icon;
                const overdue = isOverdue(t.dueAt);
                const priorityMeta = getPriorityBadge(t.priority || t.entityContext?.priority);
                const amount = t.entityContext?.amount || t.entityContext?.totalAmount;
                const requesterName = t.instance?.startedByName || t.entityContext?.buyerName || t.entityContext?.createdByName || 'ثبت‌کننده سیستم';
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
                          <span>{typeMeta.label} #{formatPersianNumber(t.instance?.entityId)}</span>
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
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${priorityMeta.color}`}>
                              {priorityMeta.label}
                            </span>
                          )}

                          {t.isDelegated && (
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

                        {amount !== undefined && amount !== null && (
                          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                            <Banknote className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="truncate">ارزش: <strong className="text-emerald-700 dark:text-emerald-400">{formatPersianPrice(amount)}</strong></span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 col-span-2">
                          <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="truncate">گام جاری: <strong className="text-indigo-700 dark:text-indigo-300">{t.currentState?.title || t.title}</strong></span>
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
                              ? 'مهلت تایید (SLA) منقضی شده است!'
                              : `مهلت تایید: ${formatPersianDate(t.dueAt)}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                      <button
                        onClick={() => setSelectedTask(t)}
                        className={`flex items-center gap-1 px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-sm ${
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
      )}

      {/* View Mode 2: Classic Instances Inbox */}
      {inboxView === 'instances' && (
        <>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 animate-pulse">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3"></div>
                  <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-2/3 mb-4"></div>
                  <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded w-full"></div>
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base mb-1">
                کارتابل نمونه‌های شما خالی است!
              </h3>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item, idx) => {
                const itemEntityType = item?.instance?.entityType || item?.entityType || 'document';
                const itemEntityId = item?.instance?.entityId || item?.entityId || '';
                const typeMeta = getEntityTypeLabel(itemEntityType);
                const TypeIcon = typeMeta.icon;
                const currentState = item?.currentState;
                const priorityMeta = getPriorityBadge(item?.entityContext?.priority);
                const amount = item?.entityContext?.amount || item?.entityContext?.totalAmount;
                const requesterName = item?.instance?.startedByName || item?.entityContext?.buyerName || item?.entityContext?.createdByName || 'ثبت‌کننده سیستم';
                const itemKey = item?.instance?.id || item?.id || idx;

                return (
                  <div
                    key={itemKey}
                    className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow flex flex-col justify-between"
                  >
                    <div>
                      {/* Badges Bar */}
                      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${typeMeta.color}`}>
                          <TypeIcon className="w-3.5 h-3.5" />
                          <span>{typeMeta.label} #{formatPersianNumber(itemEntityId)}</span>
                        </span>

                        <div className="flex items-center gap-1">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${priorityMeta.color}`}>
                            {priorityMeta.label}
                          </span>

                          {currentState && (
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStateColorClass(currentState.color)}`}>
                              {currentState.title}
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className="font-bold text-gray-900 dark:text-white text-sm mb-1">
                        {item?.definition?.title || 'گردش کار'}
                      </h3>

                      {/* Context Grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 dark:bg-gray-700/40 p-2.5 rounded-lg mb-3">
                        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                          <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="truncate">متقاضی: <strong className="text-gray-800 dark:text-gray-100">{requesterName}</strong></span>
                        </div>

                        {amount !== undefined && amount !== null && (
                          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                            <Banknote className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="truncate">ارزش: <strong className="text-emerald-700 dark:text-emerald-400">{formatPersianPrice(amount)}</strong></span>
                          </div>
                        )}
                      </div>

                      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 mb-4">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          <span>تاریخ ثبت: {formatPersianDate(item?.instance?.createdAt || item?.createdAt || new Date())}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                      <span className="block text-[11px] text-gray-400 mb-2">اقدامات قابل انجام:</span>
                      <div className="flex flex-wrap gap-2">
                        {item.availableTransitions && item.availableTransitions.length > 0 ? (
                          item.availableTransitions.map((tr) => (
                            <button
                              key={tr.id}
                              onClick={() => setSelectedItem({ item, transition: tr })}
                              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all shadow-sm ${
                                tr.actionKey === 'approve' || tr.actionKey === 'qc_pass' || tr.actionKey === 'approve_material'
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                                  : tr.actionKey === 'reject' || tr.actionKey === 'qc_fail' || tr.actionKey === 'reject_material'
                                  ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600'
                                  : 'bg-gray-50 dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              <span>{tr.title}</span>
                            </button>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400 italic">اقدام ارجاع‌شده‌ای در این گام برای شما فعال نیست</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* V9 Phase 5.2: مودال‌های مودولار استخراج‌شده */}
      <TaskExecuteModal
        selectedTask={selectedTask}
        onClose={() => setSelectedTask(null)}
        docDetails={docDetails}
        isLoadingDoc={isLoadingDoc}
        onPrintDoc={setPrintDoc}
        taskAction={taskAction}
        onTaskActionChange={setTaskAction}
        comment={comment}
        onCommentChange={setComment}
        onExecute={handleExecuteTask}
        isExecuting={executeTaskMutation.isPending}
      />

      <TransitionExecuteModal
        selectedItem={selectedItem}
        onClose={() => setSelectedItem(null)}
        docDetails={docDetails}
        isLoadingDoc={isLoadingDoc}
        onPrintDoc={setPrintDoc}
        comment={comment}
        onCommentChange={setComment}
        onExecute={handleExecuteTransition}
        isExecuting={executeTransitionMutation.isPending}
      />

      <PrintDocModal printDoc={printDoc} onClose={() => setPrintDoc(null)} />

    </div>
  );
};


export default ApprovalInboxPage;

