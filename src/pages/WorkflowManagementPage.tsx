import React, { useState } from 'react';
import { Workflow, Clock, Layers, UserCheck } from 'lucide-react';
import { useWorkflowDefinitionsQuery } from '../hooks/queries/useWorkflowQueries';
import { WorkflowDesignerCanvas } from '../components/workflow/WorkflowDesignerCanvas';
import { WorkflowSlaAnalyticsTab } from '../components/workflow/WorkflowSlaAnalyticsTab';
import { WorkflowDelegationTab } from '../components/workflow/WorkflowDelegationTab';
import { WorkflowVersionHistoryModal } from '../components/workflow/WorkflowVersionHistoryModal';
import { WorkflowDefinitionList } from '../components/workflow/WorkflowDefinitionList';
import { WorkflowCreateModal } from '../components/workflow/WorkflowCreateModal';

export const WorkflowManagementPage: React.FC = () => {
  const { data: definitions, isLoading, refetch } = useWorkflowDefinitionsQuery();

  const [activeTab, setActiveTab] = useState<'list' | 'designer' | 'sla' | 'delegations'>('list');
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<number | null>(null);
  const [historyDefinition, setHistoryDefinition] = useState<{ id: number; title: string } | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const handleEditDefinition = (id: number) => {
    setSelectedDefinitionId(id);
    setActiveTab('designer');
  };

  const handleCreated = (id: number) => {
    setIsCreateModalOpen(false);
    handleEditDefinition(id);
    void refetch();
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
              طراحی گردش کار و گزارش مهلت انجام
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              مدیریت الگوها، طراحی گام‌ها و شرط‌ها، تأیید چندامضایی و سنجش مهلت انجام
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
              <span>الگوهای گردش کار</span>
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
              <span>مهلت انجام</span>
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
              <span>تفویض اختیار</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tab 1: List of Definitions */}
      {activeTab === 'list' && (
        <WorkflowDefinitionList
          definitions={definitions || []}
          isLoading={isLoading}
          onCreate={() => setIsCreateModalOpen(true)}
          onEdit={handleEditDefinition}
          onHistory={setHistoryDefinition}
        />
      )}

      {/* Tab 2: Visual Designer Canvas */}
      {activeTab === 'designer' && selectedDefinitionId && (
        <WorkflowDesignerCanvas
          definitionId={selectedDefinitionId}
          onBack={() => {
            setActiveTab('list');
            void refetch();
          }}
        />
      )}

      {/* Tab 3: SLA Analytics */}
      {activeTab === 'sla' && <WorkflowSlaAnalyticsTab />}

      {/* Tab 4: Delegations */}
      {activeTab === 'delegations' && <WorkflowDelegationTab />}

      {historyDefinition && (
        <WorkflowVersionHistoryModal
          definitionId={historyDefinition.id}
          title={historyDefinition.title}
          onClose={() => setHistoryDefinition(null)}
        />
      )}

      {isCreateModalOpen && (
        <WorkflowCreateModal onClose={() => setIsCreateModalOpen(false)} onCreated={handleCreated} />
      )}
    </div>
  );
};

export default WorkflowManagementPage;

