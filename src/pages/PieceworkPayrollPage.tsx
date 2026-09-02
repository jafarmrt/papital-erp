import React from 'react';
import { Calculator } from 'lucide-react';
import { usePiecework } from '../hooks/usePiecework';
import { PieceworkStatsCards } from '../components/piecework/PieceworkStatsCards';
import { PieceworkTabsNav } from '../components/piecework/PieceworkTabsNav';
import { PieceworkLogsTab } from '../components/piecework/PieceworkLogsTab';
import { PieceworkTasksTab } from '../components/piecework/PieceworkTasksTab';
import { PieceworkRatesTab } from '../components/piecework/PieceworkRatesTab';
import { PieceworkPayrollsTab } from '../components/piecework/PieceworkPayrollsTab';
import { PieceworkProjectCostsTab } from '../components/piecework/PieceworkProjectCostsTab';
import { PieceworkLogModal } from '../components/piecework/PieceworkLogModal';
import { PieceworkTaskModal } from '../components/piecework/PieceworkTaskModal';
import { PieceworkPayrollModal } from '../components/piecework/PieceworkPayrollModal';
import { PieceworkPayslipModal } from '../components/piecework/PieceworkPayslipModal';

export function PieceworkPayrollPage() {
  const {
    activeTab,
    setActiveTab,
    tasksList,
    logsList,
    payrollsList,
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
    editingTask,
    taskFormData,
    setTaskFormData,
    selectedPersonnelForRates,
    customRatesMap,
    isPayrollModalOpen,
    setIsPayrollModalOpen,
    payrollPersonnelId,
    setPayrollPersonnelId,
    payrollStartDate,
    setPayrollStartDate,
    payrollEndDate,
    setPayrollEndDate,
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
  } = usePiecework();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto font-farsi text-slate-800 dir-rtl">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
            <Calculator size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">حقوق و دستمزد (Piecework & Payroll)</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              ثبت روزانه کارکرد، مدیریت عناوین و نرخ‌ها، تسهیم هزینه بر پروژه‌ها و صدور فیش رسمی حقوق
            </p>
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <PieceworkStatsCards
        totalLoggedAmount={totalLoggedAmount}
        pendingLoggedAmount={pendingLoggedAmount}
        payrollsCount={payrollsList.length}
        tasksCount={tasksList.length}
      />

      {/* Tab Navigation */}
      <PieceworkTabsNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        logsCount={logsList.length}
        tasksCount={tasksList.length}
        payrollsCount={payrollsList.length}
      />

      {/* TAB 1: WORK LOGS */}
      {activeTab === 'logs' && (
        <PieceworkLogsTab
          logsList={filteredLogs}
          loading={loading}
          searchQuery={logSearchQuery}
          onSearchChange={setLogSearchQuery}
          selectedPersonnelFilter={selectedPersonnelFilter}
          onPersonnelFilterChange={setSelectedPersonnelFilter}
          selectedProjectFilter={selectedProjectFilter}
          onProjectFilterChange={setSelectedProjectFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          startDateFilter={startDateFilter}
          onStartDateChange={setStartDateFilter}
          endDateFilter={endDateFilter}
          onEndDateChange={setEndDateFilter}
          personnelSelectOptions={personnelSelectOptions}
          projectSelectOptions={projectSelectOptions}
          onOpenAddModal={handleOpenAddLogModal}
          onEditLog={handleOpenEditLogModal}
          onDeleteLog={handleDeleteLog}
        />
      )}

      {/* TAB 2: TASKS CATALOG */}
      {activeTab === 'tasks' && (
        <PieceworkTasksTab
          tasksList={filteredTasks}
          categoriesList={categoriesList}
          categoryFilter={taskCategoryFilter}
          onCategoryFilterChange={setTaskCategoryFilter}
          searchQuery={taskSearchQuery}
          onSearchChange={setTaskSearchQuery}
          onOpenAddTaskModal={handleOpenAddTaskModal}
          onEditTask={handleOpenEditTaskModal}
          onDeleteTask={handleDeleteTask}
        />
      )}

      {/* TAB 3: CUSTOM PERSONNEL RATES */}
      {activeTab === 'rates' && (
        <PieceworkRatesTab
          personnelSelectOptions={personnelSelectOptions}
          selectedPersonnelForRates={selectedPersonnelForRates}
          onSelectPersonnel={handleSelectPersonnelForRates}
          tasksList={tasksList}
          customRatesMap={customRatesMap}
          onSaveCustomRate={handleSaveCustomRate}
        />
      )}

      {/* TAB 4: PAYROLLS & SETTLEMENTS */}
      {activeTab === 'payrolls' && (
        <PieceworkPayrollsTab
          payrollsList={payrollsList}
          onOpenPayrollModal={handleOpenPayrollModal}
          onViewPayslip={handleViewPayslip}
          onUpdateStatus={handleUpdatePayrollStatus}
          onDeletePayroll={handleDeletePayroll}
          onReload={loadData}
        />
      )}

      {/* TAB 5: PROJECT LABOR COSTS */}
      {activeTab === 'project-costs' && (
        <PieceworkProjectCostsTab
          projectCostsSummary={projectCostsSummary}
          totalLoggedAmount={totalLoggedAmount}
        />
      )}

      {/* MODAL 1: CREATE / EDIT WORK LOG */}
      <PieceworkLogModal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        onSubmit={handleSaveLogs}
        editingLog={editingLog}
        setEditingLog={setEditingLog}
        selectedPersonnelForLog={selectedPersonnelForLog}
        setSelectedPersonnelForLog={setSelectedPersonnelForLog}
        defaultBatchProjectId={defaultBatchProjectId}
        setDefaultBatchProjectId={setDefaultBatchProjectId}
        logDate={logDate}
        setLogDate={setLogDate}
        batchLogRows={batchLogRows}
        setBatchLogRows={setBatchLogRows}
        tasksList={tasksList}
        personnelSelectOptions={personnelSelectOptions}
        projectSelectOptions={projectSelectOptions}
        taskSelectOptions={taskSelectOptions}
        onTaskChangeInRow={handleTaskChangeInRow}
        onAddLogRow={handleAddLogRow}
        onRemoveLogRow={handleRemoveLogRow}
        isSaving={isSavingLog}
      />

      {/* MODAL 2: CREATE / EDIT TASK */}
      <PieceworkTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onSubmit={handleSaveTask}
        editingTask={editingTask}
        taskFormData={taskFormData}
        setTaskFormData={setTaskFormData}
        isSaving={isSavingTask}
      />

      {/* MODAL 3: PAYROLL GENERATION MODAL */}
      <PieceworkPayrollModal
        isOpen={isPayrollModalOpen}
        onClose={() => setIsPayrollModalOpen(false)}
        onSubmit={handleGeneratePayroll}
        personnelSelectOptions={personnelSelectOptions}
        payrollPersonnelId={payrollPersonnelId}
        setPayrollPersonnelId={setPayrollPersonnelId}
        payrollStartDate={payrollStartDate}
        setPayrollStartDate={setPayrollStartDate}
        payrollEndDate={payrollEndDate}
        setPayrollEndDate={setPayrollEndDate}
        payrollBonuses={payrollBonuses}
        setPayrollBonuses={setPayrollBonuses}
        payrollDeductions={payrollDeductions}
        setPayrollDeductions={setPayrollDeductions}
        payrollNotes={payrollNotes}
        setPayrollNotes={setPayrollNotes}
        payrollPreviewLogs={payrollPreviewLogs}
        allowNoLogs={payrollFixedIncluded}
        fixedRemainingHint={payrollFixedRemainingHint}
        advanceDeduction={payrollAdvanceDeduction}
        setAdvanceDeduction={setPayrollAdvanceDeduction}
        isSaving={isSavingPayroll}
      />

      {/* MODAL 4: VIEW PAYSLIP & PRINT */}
      <PieceworkPayslipModal
        viewingPayroll={viewingPayroll}
        onClose={() => setViewingPayroll(null)}
        onUpdateStatus={handleUpdatePayrollStatus}
        onDeletePayroll={handleDeletePayroll}
        onReload={loadData}
      />
    </div>
  );
}

export default PieceworkPayrollPage;

