import { X, FolderKanban, Loader2 } from 'lucide-react';
import { ProjectModalProps } from './project-modal/types';
import { useProjectForm } from './project-modal/useProjectForm';
import { ProjectGeneralForm } from './project-modal/ProjectGeneralForm';
import { ProjectProductsForm } from './project-modal/ProjectProductsForm';
import { ProjectStagesForm } from './project-modal/ProjectStagesForm';

export default function ProjectModal(props: ProjectModalProps) {
  const { isOpen, onClose, projectToEdit } = props;

  const {
    projectCode,
    setProjectCode,
    title,
    setTitle,
    selectedCustomerId,
    selectedCustomer,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    priority,
    setPriority,
    description,
    setDescription,
    attachments,
    setAttachments,
    productsList,
    stages,
    preset,
    saving,
    availablePresets,
    activeCustomersList,
    activeItemsList,
    getOptionalStageNames,
    handleAddProductRow,
    handleUpdateProductRow,
    handleRemoveProductRow,
    handleSelectPreset,
    handleAddStage,
    handleRemoveStage,
    handleStageTitleChange,
    handleMoveStage,
    handleCustomerSelect,
    handleSubmit
  } = useProjectForm(props);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <FolderKanban size={20} />
            </div>
            <div>
              <h2 className="text-base font-black">
                {projectToEdit ? 'ویرایش پروژه تولید' : 'تعریف پروژه تولید جدید'}
              </h2>
              <p className="text-2xs text-slate-400 mt-0.5">
                ثبت سفارش، انتخاب فرآیند تولید و زمان‌بندی تحویل کارگاهی
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <ProjectGeneralForm
            projectCode={projectCode}
            setProjectCode={setProjectCode}
            title={title}
            setTitle={setTitle}
            selectedCustomerId={selectedCustomerId}
            selectedCustomer={selectedCustomer}
            activeCustomersList={activeCustomersList}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            priority={priority}
            setPriority={setPriority}
            description={description}
            setDescription={setDescription}
            onCustomerSelect={handleCustomerSelect}
            attachments={attachments}
            setAttachments={setAttachments}
          />

          <ProjectProductsForm
            productsList={productsList}
            activeItemsList={activeItemsList}
            getOptionalStageNames={getOptionalStageNames}
            onAddProductRow={handleAddProductRow}
            onUpdateProductRow={handleUpdateProductRow}
            onRemoveProductRow={handleRemoveProductRow}
          />

          <ProjectStagesForm
            stages={stages}
            preset={preset}
            availablePresets={availablePresets}
            onSelectPreset={handleSelectPreset}
            onAddStage={handleAddStage}
            onRemoveStage={handleRemoveStage}
            onStageTitleChange={handleStageTitleChange}
            onMoveStage={handleMoveStage}
          />

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-lg shadow-blue-600/30 hover:shadow-none transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              {projectToEdit ? 'ذخیره تغییرات پروژه' : 'ثبت و شروع فرآیند تولید'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
