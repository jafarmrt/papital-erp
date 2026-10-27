import { useId } from 'react';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { REQUISITION_PRIORITIES, REQUISITION_PRIORITY_LABELS, type RequisitionPriority } from '../../lib/procurement/requisitionFields';
import { FieldError } from './RequisitionItemRowEditor';

interface RequisitionHeaderFieldsProps {
  title: string;
  onTitleChange: (value: string) => void;
  priority: RequisitionPriority;
  onPriorityChange: (value: RequisitionPriority) => void;
  /** ISO (YYYY-MM-DD), shown with the Jalali calendar */
  requiredDate: string;
  onRequiredDateChange: (iso: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  /** field errors of the form or the server (keys `title`, `priority`, `requiredDate`, `notes`) */
  errors?: Record<string, string>;
  titlePlaceholder?: string;
}

const FIELD = 'w-full p-2 bg-white border rounded-lg text-slate-800 focus:ring-2 focus:ring-amber-400 focus:outline-none';

/**
 * v11 phase 6.3p (U9, card ت۵۶-۶): the fields of a purchase requisition, the same on the procurement desk, the reorder
 * alerts and a project's shortfalls, with one vocabulary (درخواست خرید → سفارش خرید → رسید انبار). Before, each screen
 * had its own words for them («عنوان سفارش / درخواست»، «تاریخ نیاز / تحویل»، «یادداشت و الزامات کیفی») and the project
 * form had no title.
 */
export function RequisitionHeaderFields(props: RequisitionHeaderFieldsProps) {
  const id = useId();
  const errors = props.errors ?? {};
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
      <div className="sm:col-span-2">
        <label htmlFor={`${id}-title`} className="block font-bold text-slate-700 mb-1">
          عنوان درخواست خرید <span className="text-rose-500">*</span>:
        </label>
        <input
          id={`${id}-title`}
          type="text"
          placeholder={props.titlePlaceholder ?? 'مثلاً: خرید ورق‌های برنجی و مهره‌های فلزی طرح بهار'}
          value={props.title}
          onChange={e => props.onTitleChange(e.target.value)}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? `${id}-title-error` : undefined}
          className={`${FIELD} font-bold ${errors.title ? 'border-rose-500' : 'border-slate-300'}`}
        />
        <FieldError id={`${id}-title-error`} message={errors.title} />
      </div>

      <div>
        <label htmlFor={`${id}-priority`} className="block font-bold text-slate-700 mb-1">اولویت خرید:</label>
        <select
          id={`${id}-priority`}
          value={props.priority}
          onChange={e => props.onPriorityChange(e.target.value as RequisitionPriority)}
          aria-invalid={Boolean(errors.priority)}
          className={`${FIELD} font-bold border-slate-300`}
        >
          {REQUISITION_PRIORITIES.map(p => <option key={p} value={p}>{REQUISITION_PRIORITY_LABELS[p]}</option>)}
        </select>
        <FieldError id={`${id}-priority-error`} message={errors.priority} />
      </div>

      <div>
        <label htmlFor={`${id}-required-date`} className="block font-bold text-slate-700 mb-1">تاریخ نیاز به کالا:</label>
        <JalaliDateInput id={`${id}-required-date`} value={props.requiredDate} onChange={props.onRequiredDateChange} placeholder="تاریخ نیاز" />
        <FieldError id={`${id}-required-date-error`} message={errors.requiredDate} />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={`${id}-notes`} className="block font-bold text-slate-700 mb-1">توضیحات و مشخصات فنی:</label>
        <input
          id={`${id}-notes`}
          type="text"
          placeholder="برند، عیار، ابعاد یا ملاحظات بازرسی"
          value={props.notes}
          onChange={e => props.onNotesChange(e.target.value)}
          className={`${FIELD} border-slate-300`}
        />
        <FieldError id={`${id}-notes-error`} message={errors.notes} />
      </div>
    </div>
  );
}
