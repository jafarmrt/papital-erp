import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BarChart2, Layers, Package, Sparkles } from 'lucide-react';
import type { FinancialAttachment, Personnel, ProductionProject } from '../../../types';
import { fetchJson } from '../../../api';
import { errorMessageOf, formatPersianDate, formatPersianNumber } from '../../../utils';
import { hasMatrixProducts } from '../../../lib/projects/progressMatrix';
import { FinancialAttachmentUploader } from '../../accounting/FinancialAttachmentUploader';
import { AddStageForm } from '../ProjectStageActions';
import ProjectGanttTab from '../ProjectGanttTab';
import { ProjectStageCard } from './ProjectStageCard';
import { ProjectSpecsEditor } from './ProjectSpecsEditor';
import type { ProjectWriteBase } from '../../../lib/projects/projectParts';

interface ProjectOverviewTabProps {
  project: ProductionProject;
  /** the version and part tokens the next project save sends (TD-742 / TD-1342) */
  writeBase: ProjectWriteBase;
  rememberVersion: (response: unknown) => void;
  personnel: readonly Personnel[];
  canEdit: boolean;
  editingSpecs: boolean;
  onCloseSpecs: () => void;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

/** V3.1.0: a project without products shows its main item, never an invented product */
function projectProductRows(project: ProductionProject) {
  if (Array.isArray(project.products) && project.products.length > 0) return project.products;
  if (!project.item_id) return [];
  return [{
    id: 'prod-main', item_id: project.item_id, item_code: project.item_code || '', item_name: project.item_name || '',
    customer_code: '', quantity: project.quantity || 0, unit: project.unit || 'عدد', needs_assembly: true,
  }];
}

const CARD = 'bg-white rounded-2xl border border-slate-200 p-4 space-y-3';

/**
 * v10.2.1 (10.2 package 2, review U3 / U6): the first tab of a project page, «مشخصات و مراحل»: the summary or its
 * edit form, the products, the stages with their timeline chart beneath (the old fifth tab) and the attachments. The
 * project workflow box, which no project workflow ever filled, is gone. While the specs are being edited nothing else
 * here saves (stage edits, a new stage, the attachments card), so no reload interrupts the form.
 */
export function ProjectOverviewTab({ project, writeBase, rememberVersion, personnel, canEdit, editingSpecs, onCloseSpecs, onChanged, onDirtyChange }: ProjectOverviewTabProps) {
  const [editingStages, setEditingStages] = useState<ReadonlySet<number>>(new Set());
  const products = projectProductRows(project);
  const stages = Array.isArray(project.stages) ? project.stages : [];
  const stagesFromMatrix = hasMatrixProducts({ products: project.products, itemId: project.item_id });
  const projectToEdit = useMemo(() => ({ ...project, ...writeBase }), [project, writeBase]);

  const onStageEditing = useCallback((stageId: number, editing: boolean) => {
    setEditingStages(prev => {
      if (prev.has(stageId) === editing) return prev;
      const next = new Set(prev);
      if (editing) next.add(stageId); else next.delete(stageId);
      return next;
    });
  }, []);

  const dirty = editingSpecs || editingStages.size > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const saveAttachments = async (attachments: FinancialAttachment[]) => {
    try {
      rememberVersion(await fetchJson(`/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachments, ...writeBase }),
      }));
      toast.success('پیوست‌های پروژه ذخیره شد');
      onChanged();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'پیوست‌ها ذخیره نشد');
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {editingSpecs ? (
        <ProjectSpecsEditor project={projectToEdit} onSaved={onChanged} onCancel={onCloseSpecs} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
            <span className="text-[11px] text-slate-500 font-semibold block">مشتری</span>
            <p className="font-bold text-slate-900">{project.customer_name || 'ثبت نشده'}</p>
          </div>
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
            <span className="text-[11px] text-slate-500 font-semibold block">پیشرفت کل</span>
            <p className="font-bold text-amber-700 text-sm">{formatPersianNumber(project.progress_percent || 0)}٪</p>
          </div>
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
            <span className="text-[11px] text-slate-500 font-semibold block">شروع و تحویل</span>
            <p className="font-bold text-slate-800">
              {project.start_date ? formatPersianDate(project.start_date) : '؟'} تا {project.end_date ? formatPersianDate(project.end_date) : '؟'}
            </p>
          </div>
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1">
            <span className="text-[11px] text-slate-500 font-semibold block">محصولات</span>
            <p className="font-bold text-blue-700">{formatPersianNumber(products.length)} کد محصول</p>
          </div>
          {project.description && (
            <p className="col-span-2 lg:col-span-4 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-slate-700 leading-6 whitespace-pre-line">{project.description}</p>
          )}
        </div>
      )}

      {!editingSpecs && (
        <section className={CARD} aria-labelledby={`project-${project.id}-products`}>
          <h3 id={`project-${project.id}-products`} className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
            <Package className="w-4 h-4 text-amber-600" aria-hidden="true" />
            محصولات این پروژه
          </h3>
          {products.length === 0 ? (
            <p className="text-slate-500">محصولی برای این پروژه ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="p-2.5">ردیف</th>
                    <th className="p-2.5">کالای انبار</th>
                    <th className="p-2.5">کد مشتری</th>
                    <th className="p-2.5 text-center">تعداد سفارش</th>
                    <th className="p-2.5 text-center">مرحله مونتاژ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p, idx) => (
                    <tr key={p.id || idx}>
                      <td className="p-2.5 font-bold text-slate-400">{formatPersianNumber(idx + 1)}</td>
                      <td className="p-2.5 font-bold text-slate-900">
                        {p.item_name} {p.item_code && <span className="text-slate-500 text-[11px]">[{p.item_code}]</span>}
                      </td>
                      <td className="p-2.5 font-bold text-amber-800">{p.customer_code || 'ثبت نشده'}</td>
                      <td className="p-2.5 text-center font-bold text-slate-800">{formatPersianNumber(p.quantity)} {p.unit}</td>
                      <td className="p-2.5 text-center">{p.needs_assembly !== false ? 'دارد' : 'ندارد'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className={CARD} aria-labelledby={`project-${project.id}-stages`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 id={`project-${project.id}-stages`} className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600" aria-hidden="true" />
            مراحل کارگاه ({formatPersianNumber(stages.length)} مرحله)
          </h3>
          {stagesFromMatrix && (
            <span className="text-[11px] text-blue-700 font-medium bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
              وضعیت و پیشرفت هر مرحله از زبانه «پیشرفت هر کالا» خوانده می‌شود
            </span>
          )}
        </div>
        <div className="space-y-3">
          {stages.map(stage => (
            <ProjectStageCard
              key={stage.id}
              projectId={project.id}
              stage={stage}
              personnel={personnel}
              stagesFromMatrix={stagesFromMatrix}
              canEdit={canEdit && !editingSpecs}
              onChanged={onChanged}
              onEditingChange={onStageEditing}
            />
          ))}
        </div>
        {canEdit && !editingSpecs && <AddStageForm projectId={project.id} onChanged={onChanged} />}
      </section>

      <section className={CARD} aria-labelledby={`project-${project.id}-timeline`}>
        <h3 id={`project-${project.id}-timeline`} className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
          <BarChart2 className="w-4 h-4 text-purple-600" aria-hidden="true" />
          نمودار زمان‌بندی مراحل
        </h3>
        <ProjectGanttTab project={project} />
      </section>

      {/* the specs editor has its own attachments field; this card would save beside it and reload the page */}
      {!editingSpecs && (
      <section className={CARD}>
        <FinancialAttachmentUploader
          readOnly={!canEdit}
          attachments={Array.isArray(project.attachments) ? project.attachments : []}
          onChange={saveAttachments}
          title="پیوست‌ها و اسناد سفارش مشتری (فایل اکسل سفارش، فاکتور، طرح یا تصویر نمونه)"
          helperText="فایل‌های سفارش، طرح و فاکتور مشتری اینجا دیده، بارگیری و مدیریت می‌شوند."
          maxFiles={15}
        />
      </section>
      )}
    </div>
  );
}
