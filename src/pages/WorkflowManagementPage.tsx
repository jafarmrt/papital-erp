import React, { useState } from 'react';
import { 
  Workflow, 
  Plus, 
  Clock, 
  Layers, 
  Edit3, 
  CheckCircle, 
  ArrowLeft,
  SlidersHorizontal,
  FileText,
  Boxes,
  RefreshCw,
  X,
  UserCheck
} from 'lucide-react';
import { useWorkflowDefinitionsQuery, useSaveWorkflowDefinitionMutation } from '../hooks/queries/useWorkflowQueries';
import { WorkflowDesignerCanvas } from '../components/workflow/WorkflowDesignerCanvas';
import { WorkflowSlaAnalyticsTab } from '../components/workflow/WorkflowSlaAnalyticsTab';
import { WorkflowDelegationTab } from '../components/workflow/WorkflowDelegationTab';
import { fetchJson } from '../api';
import { toast } from 'react-hot-toast';

export const WorkflowManagementPage: React.FC = () => {
  const { data: definitions, isLoading, refetch } = useWorkflowDefinitionsQuery();
  const saveMutation = useSaveWorkflowDefinitionMutation();

  const [activeTab, setActiveTab] = useState<'list' | 'designer' | 'sla' | 'delegations'>('list');
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<number | null>(null);

  // New Template Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newEntityType, setNewEntityType] = useState('document');
  const [newDescription, setNewDescription] = useState('');

  const handleEditDefinition = (id: number) => {
    setSelectedDefinitionId(id);
    setActiveTab('designer');
  };

  const handleSyncDefaults = async () => {
    try {
      setIsSyncing(true);
      await fetchJson('/workflow/definitions/seed-default', { method: 'POST' });
      toast.success('الگوهای استاندارد ورکفلو با موفقیت همگام‌سازی شدند');
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'خطا در همگام‌سازی الگوها');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateNewDefinitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newCode.trim()) {
      toast.error('عنوان و کد الگوی ورکفلو الزامی هستند');
      return;
    }

    try {
      const result = await saveMutation.mutateAsync({
        title: newTitle.trim(),
        code: newCode.trim().toUpperCase().replace(/\s+/g, '_'),
        entityType: newEntityType,
        description: newDescription.trim(),
        version: 1,
        isActive: 1,
        states: [
          {
            stateKey: 'draft',
            title: 'پیش‌نویس اولیه',
            stateType: 'initial',
            color: 'gray',
            stepOrder: 1,
            slaHours: 24,
            positionX: 100,
            positionY: 180
          },
          {
            stateKey: 'approved',
            title: 'تایید نهایی',
            stateType: 'terminal',
            color: 'emerald',
            stepOrder: 2,
            slaHours: 24,
            positionX: 500,
            positionY: 180
          }
        ],
        transitions: [
          {
            fromStateKey: 'draft',
            toStateKey: 'approved',
            actionKey: 'approve',
            title: 'تایید و تکمیل',
            requiredRole: '',
            approvalRuleType: 'SINGLE'
          }
        ]
      });

      toast.success('الگوی جدید با موفقیت ایجاد شد');
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewCode('');
      setNewDescription('');

      if (result?.data?.id) {
        setSelectedDefinitionId(result.data.id);
        setActiveTab('designer');
      }
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'خطا در ایجاد الگوی جدید');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Workflow className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              طراح گرافیکی ورکفلو و گزارش‌گیری SLA
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              مدیریت الگوها، ترسیم حالت‌ها (States)، شروط متغیرها، تاییدات چندامضایی و سنجش زمان‌بندی فرآیندها
            </p>
          </div>
        </div>

        {/* Tab Buttons & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/60 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'list' 
                  ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs' 
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>الگوهای ورکفلو</span>
            </button>
            <button
              onClick={() => setActiveTab('sla')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'sla' 
                  ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs' 
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>زمان‌سنجی و SLA</span>
            </button>
            <button
              onClick={() => setActiveTab('delegations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'delegations' 
                  ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs' 
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>تفویض اختیارات (Delegation)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tab 1: List of Definitions */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2">
              <Boxes className="w-5 h-5 text-indigo-600" />
              <span>فهرست الگوهای تعریف‌شده سیستم</span>
            </h2>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncDefaults}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
                title="همگام‌سازی چرخه‌های پیش‌فرض مثل چرخه سه‌مرحله‌ای فاکتور"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>همگام‌سازی الگوهای پیش‌فرض</span>
              </button>

              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>تعریف الگوی جدید ورکفلو</span>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-gray-500">در حال دریافت الگوها...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(definitions || []).map((def: any) => (
                <div
                  key={def.id}
                  className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xs hover:border-indigo-300 dark:hover:border-indigo-700 transition-all space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded font-bold">
                        {def.code}
                      </span>
                      <h3 className="font-bold text-base text-gray-900 dark:text-white mt-1">
                        {def.title}
                      </h3>
                    </div>
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded font-mono">
                      v{def.version}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[32px]">
                    {def.description || 'بدون توضیحات تکمیلی...'}
                  </p>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs bg-gray-50 dark:bg-gray-700/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-700/60">
                    <div>
                      <span className="block text-gray-400 text-[10px]">حالت‌ها</span>
                      <span className="font-bold font-mono text-gray-800 dark:text-gray-200">{def.stateCount}</span>
                    </div>
                    <div>
                      <span className="block text-gray-400 text-[10px]">انتقال‌ها</span>
                      <span className="font-bold font-mono text-gray-800 dark:text-gray-200">{def.transitionCount}</span>
                    </div>
                    <div>
                      <span className="block text-gray-400 text-[10px]">در جریان</span>
                      <span className="font-bold font-mono text-indigo-600 dark:text-indigo-400">{def.activeInstancesCount}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
                    <button
                      onClick={() => handleEditDefinition(def.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>طراحی گرافیکی روی بوم</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Visual Designer Canvas */}
      {activeTab === 'designer' && selectedDefinitionId && (
        <WorkflowDesignerCanvas
          definitionId={selectedDefinitionId}
          onBack={() => {
            setActiveTab('list');
            refetch();
          }}
        />
      )}

      {/* Tab 3: SLA Analytics */}
      {activeTab === 'sla' && <WorkflowSlaAnalyticsTab />}

      {/* Tab 4: Delegations */}
      {activeTab === 'delegations' && <WorkflowDelegationTab />}

      {/* Create Workflow Definition Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" />
                <span>تعریف الگوی ورکفلوی جدید</span>
              </h3>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewDefinitionSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  عنوان ورکفلو <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="مثلاً: چرخه خرید و سفارش‌گذاری مواد اولیه"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    کد یکتا (کد سیستمی) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="مثلاً: PURCHASE_WF"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    نوع موجودیت مربوطه
                  </label>
                  <select
                    value={newEntityType}
                    onChange={(e) => setNewEntityType(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="document">فاکتورها و اسناد (Document)</option>
                    <option value="project">پروژه‌ها و سفارشات (Project)</option>
                    <option value="raw_material">مواد اولیه و اقلام انبار (Item)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  توضیحات الگوی فرآیند
                </label>
                <textarea
                  rows={3}
                  placeholder="توضیح مختصر درباره هدف این چرخه و مراحل تایید آن..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
                >
                  {saveMutation.isPending ? 'در حال ایجاد...' : 'ایجاد و ورود به طراح بوم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowManagementPage;

