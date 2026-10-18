import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProductionProject } from '../../../types';
import { useProjectForm } from '../../project-modal/useProjectForm';
import { ProjectGeneralForm } from '../../project-modal/ProjectGeneralForm';
import { ProjectProductsForm } from '../../project-modal/ProjectProductsForm';
import { ProjectManagersField } from '../../project-modal/ProjectManagersField';

interface ProjectSpecsEditorProps {
  /** the project with the version the next save sends (TD-742) */
  project: ProductionProject;
  onSaved: () => void;
  onCancel: () => void;
}

const NO_CUSTOMERS: never[] = [];
const NO_ITEMS: never[] = [];

/**
 * v10.2.x (10.2 package 2, review U3): a project's specs (title, customer, dates, priority, description, managers and
 * products) are edited on its own page, in place of the read-only summary, instead of in a second window over the
 * project window. It is the project form of `useProjectForm` without its stages: stages change only through the stage
 * cards below it (TD-740). While it is open the page counts as holding unsaved changes. The form starts from the
 * project as it was when the editor opened: a reload of the page meanwhile never resets what was typed.
 */
export function ProjectSpecsEditor({ project, onSaved, onCancel }: ProjectSpecsEditorProps) {
  const [opened] = useState(project);
  const form = useProjectForm({
    isOpen: true,
    onClose: onCancel,
    projectToEdit: opened,
    customersList: NO_CUSTOMERS,
    itemsList: NO_ITEMS,
    onSuccess: onSaved,
  });

  useEffect(() => {
    const first = document.getElementById('project-specs-editor');
    first?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);

  return (
    <form id="project-specs-editor" onSubmit={form.handleSubmit} aria-label="ویرایش مشخصات پروژه" className="bg-white rounded-2xl border-2 border-blue-300 p-4 space-y-5 shadow-sm">
      <h3 className="font-bold text-slate-900 text-sm">ویرایش مشخصات پروژه</h3>
      <ProjectGeneralForm
        projectCode={form.projectCode}
        setProjectCode={form.setProjectCode}
        title={form.title}
        setTitle={form.setTitle}
        selectedCustomerId={form.selectedCustomerId}
        selectedCustomer={form.selectedCustomer}
        activeCustomersList={form.activeCustomersList}
        startDate={form.startDate}
        setStartDate={form.setStartDate}
        endDate={form.endDate}
        setEndDate={form.setEndDate}
        priority={form.priority}
        setPriority={form.setPriority}
        description={form.description}
        setDescription={form.setDescription}
        onCustomerSelect={form.handleCustomerSelect}
        attachments={form.attachments}
        setAttachments={form.setAttachments}
      />
      <ProjectManagersField managerIds={form.managerIds} onChange={form.setManagerIds} storedManagers={opened.managers} disabled={form.saving} />
      <ProjectProductsForm
        productsList={form.productsList}
        activeItemsList={form.activeItemsList}
        getOptionalStageNames={form.getOptionalStageNames}
        onAddProductRow={form.handleAddProductRow}
        onUpdateProductRow={form.handleUpdateProductRow}
        onRemoveProductRow={form.handleRemoveProductRow}
      />
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
        <button type="button" onClick={onCancel} disabled={form.saving} className="px-5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50">
          انصراف
        </button>
        <button type="submit" disabled={form.saving} className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer">
          {form.saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          ذخیره مشخصات پروژه
        </button>
      </div>
    </form>
  );
}
