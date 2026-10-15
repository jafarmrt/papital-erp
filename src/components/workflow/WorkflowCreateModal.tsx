import React, { useState } from 'react';
import { LayoutTemplate, Plus, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useCreateWorkflowFromTemplateMutation, useSaveWorkflowDefinitionMutation } from '../../hooks/queries/useWorkflowQueries';
import { NEW_WORKFLOW_SAVED_INACTIVE } from '../../lib/workflow/workflowLifecycle';
import { WORKFLOW_ENTITY_TYPES, workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels';
import { TEMPLATE_DEFINITION_SAVED_INACTIVE, WORKFLOW_TEMPLATES, type WorkflowTemplateId } from '../../lib/workflow/workflowTemplates';
import { toPersianDigits } from '../../utils/persianNumber';
import { getErrorMessage } from '../../utils';

type CreateMode = 'template' | 'blank';

const INPUT_CLASS = 'w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500';
const LABEL_CLASS = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

/** Two steps from start to end: the blank design a new definition starts with */
function blankDesign() {
  return {
    states: [
      { stateKey: 'draft', title: 'پیش‌نویس اولیه', stateType: 'initial', color: 'gray', stepOrder: 1, slaHours: 24, positionX: 100, positionY: 180 },
      { stateKey: 'approved', title: 'تأیید نهایی', stateType: 'terminal', color: 'emerald', stepOrder: 2, slaHours: 24, positionX: 500, positionY: 180 },
    ],
    transitions: [
      { fromStateKey: 'draft', toStateKey: 'approved', actionKey: 'approve', title: 'تأیید و تکمیل', requiredRole: '', approvalRuleType: 'SINGLE' },
    ],
  };
}

/**
 * v10.1.10 (TD-1229 / TD-1263, D-06 part B): the new definition window. «از الگو» makes an inactive definition from one
 * of the four ready-made templates (decisions ت۴ / ت۵); «طرح خالی» starts a two-step design. The record type comes only
 * from `WORKFLOW_ENTITY_TYPES` (OBS-R2-76), never a type no workflow starts on.
 */
export function WorkflowCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (definitionId: number) => void }) {
  const saveMutation = useSaveWorkflowDefinitionMutation();
  const templateMutation = useCreateWorkflowFromTemplateMutation();
  const [mode, setMode] = useState<CreateMode>('template');
  const [templateId, setTemplateId] = useState<WorkflowTemplateId>(WORKFLOW_TEMPLATES[0].id);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [entityType, setEntityType] = useState(WORKFLOW_ENTITY_TYPES[0].id);
  const [description, setDescription] = useState('');
  const isSaving = saveMutation.isPending || templateMutation.isPending;

  const createFromTemplate = async () => {
    try {
      const result = await templateMutation.mutateAsync(templateId);
      toast(TEMPLATE_DEFINITION_SAVED_INACTIVE, { duration: 8000 });
      const id = Number(result?.data?.id);
      if (id > 0) onCreated(id);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) || 'گردش کار از الگو ساخته نشد؛ دوباره تلاش کنید.');
    }
  };

  const createBlank = async () => {
    if (!title.trim() || !code.trim()) {
      toast.error('عنوان و کد گردش کار را وارد کنید.');
      return;
    }
    try {
      const result = await saveMutation.mutateAsync({
        title: title.trim(),
        code: code.trim().toUpperCase().replace(/\s+/g, '_'),
        entityType,
        description: description.trim(),
        version: 1,
        ...blankDesign(),
      });
      // v10.1.7 (TD-1229, decision ت۲۷): a new workflow is active only when its record type has none
      if (Number(result?.data?.isActive) !== 1) toast(NEW_WORKFLOW_SAVED_INACTIVE, { duration: 8000 });
      const id = Number(result?.data?.id);
      if (id > 0) onCreated(id);
    } catch {
      // the mutation shows the server's message
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (mode === 'template' ? createFromTemplate() : createBlank());
  };

  const modeButton = (value: CreateMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        mode === value ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-label="گردش کار تازه" className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-600" />
            <span>گردش کار تازه</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="بستن" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/60 p-1 rounded-xl">
              {modeButton('template', 'ساخت از الگو')}
              {modeButton('blank', 'طرح خالی')}
            </div>

            {mode === 'template' ? (
              <fieldset className="space-y-2">
                <legend className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  گردش کار از الگو غیرفعال ساخته می‌شود تا آن را در طراح ببینید و سپس فعال کنید.
                </legend>
                {WORKFLOW_TEMPLATES.map(template => (
                  <label
                    key={template.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      templateId === template.id ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="workflow-template"
                      value={template.id}
                      checked={templateId === template.id}
                      onChange={() => setTemplateId(template.id)}
                      className="mt-1"
                    />
                    <span className="space-y-1">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                        <LayoutTemplate className="w-3.5 h-3.5 text-indigo-600" />
                        {workflowEntityTypeLabel(template.entityType)}
                      </span>
                      <span className="block text-xs text-gray-700 dark:text-gray-300">{template.title}</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                        {`${toPersianDigits(template.states.length)} گام و ${toPersianDigits(template.transitions.length)} اقدام؛ ${template.description}`}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                <div>
                  <label htmlFor="wf-new-title" className={LABEL_CLASS}>عنوان گردش کار <span className="text-rose-500">*</span></label>
                  <input id="wf-new-title" type="text" required placeholder="مثلاً: تأیید درخواست خرید مواد اولیه" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="wf-new-code" className={LABEL_CLASS}>کد یکتا (حروف لاتین) <span className="text-rose-500">*</span></label>
                    <input id="wf-new-code" type="text" required placeholder="PURCHASE_WF" value={code} onChange={(e) => setCode(e.target.value)} className={`${INPUT_CLASS} font-mono`} />
                  </div>
                  <div>
                    <label htmlFor="wf-new-entity" className={LABEL_CLASS}>نوع پرونده</label>
                    <select id="wf-new-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} className={INPUT_CLASS}>
                      {WORKFLOW_ENTITY_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="wf-new-description" className={LABEL_CLASS}>توضیحات</label>
                  <textarea id="wf-new-description" rows={3} placeholder="توضیح کوتاه درباره هدف این گردش کار و گام‌های تأیید آن" value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLASS} />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl">
              انصراف
            </button>
            <button type="submit" disabled={isSaving} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-xl shadow-xs transition-colors">
              {isSaving ? 'در حال ساخت…' : mode === 'template' ? 'ساخت از الگو و ورود به طراح' : 'ساخت و ورود به طراح'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
