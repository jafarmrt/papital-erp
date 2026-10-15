import { MoreHorizontal, PhoneCall, Edit3, Trash2, FileText, CalendarClock, UserRound } from 'lucide-react';
import type { CRMLead } from '../../types';
import { STAGES } from '../../hooks/useCRMData';
import { ActionMenu, type ActionMenuItem } from '../ActionMenu';
import { formatPersianDate, formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { PIPELINE_DRAG_TYPE, isFollowupOverdue } from '../../lib/crm/pipelineBoard';
import { currencyScale } from '../../lib/currencyScale';
import { leadCurrency } from '../../lib/crm/leadCurrencyTotals';

export interface PipelineCardActions {
  onOpenLeadDrawer: (lead: CRMLead) => void;
  onOpenActivityModal: (lead: CRMLead) => void;
  onOpenLeadModal: (lead?: CRMLead) => void;
  /** v9.0.148 (TD-893): فقط برای دارنده `crm.delete`؛ بی آن گزینه حذف نیست */
  onDeleteLead?: (leadId: number) => void;
  onStageChange: (leadId: number, newStage: string) => void;
  onConvertToInvoice?: (lead: CRMLead) => void;
}

interface CRMPipelineCardProps extends PipelineCardActions {
  lead: CRMLead;
  todayIso: string;
  /** روی گوشی کارت کشیده نمی‌شود؛ مرحله با فهرست کشویی عوض می‌شود */
  draggable: boolean;
}

/**
 * v10.1.19 (N-02 بخش ۳): کارت جمع‌وجور قیف فروش: عنوان، مشتری، ارزش با ارز، مسئول و پیگیری بعدی (سرخ اگر گذشته باشد).
 * دکمه‌ها در منوی «⋯» هستند و فهرست کشویی مرحله کنار کشیدن و رها کردن می‌ماند.
 */
export function CRMPipelineCard({ lead, todayIso, draggable, ...actions }: CRMPipelineCardProps) {
  const overdue = isFollowupOverdue(lead.nextFollowUpDate, todayIso);
  const menu: ActionMenuItem[] = [
    { label: 'ثبت تماس یا اقدام', icon: PhoneCall, onClick: () => actions.onOpenActivityModal(lead) },
    { label: 'ویرایش پرونده', icon: Edit3, onClick: () => actions.onOpenLeadModal(lead), variant: 'warning' },
  ];
  if (actions.onConvertToInvoice && lead.stage === 'proposal') {
    const convert = actions.onConvertToInvoice;
    menu.unshift({ label: 'صدور پیش‌فاکتور', icon: FileText, onClick: () => convert(lead), variant: 'success' });
  }
  if (actions.onDeleteLead) {
    const remove = actions.onDeleteLead;
    menu.push({ label: 'حذف پرونده', icon: Trash2, onClick: () => remove(lead.id), variant: 'danger' });
  }

  return (
    <div
      data-pipeline-lead={lead.id}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(PIPELINE_DRAG_TYPE, String(lead.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`bg-white rounded-xl border border-slate-200/90 p-2.5 shadow-2xs hover:shadow-md transition-shadow space-y-1.5 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={() => actions.onOpenLeadDrawer(lead)}
          className="text-right font-bold text-xs text-slate-900 hover:text-blue-600 cursor-pointer line-clamp-2 leading-relaxed"
        >
          {lead.title}
        </button>
        <ActionMenu items={menu} triggerIcon={MoreHorizontal} title="کارهای پرونده" />
      </div>

      <div className="text-[11px] text-slate-600 truncate" title={lead.customerName || lead.company || ''}>
        {lead.customerName || lead.company || 'بدون نام'}
      </div>

      <div className="text-[11px] font-black text-slate-900">
        {formatPersianPrice(lead.estimatedValue, undefined, currencyScale(leadCurrency(lead.currency)))} {formatCurrencyLabel(leadCurrency(lead.currency))}
      </div>

      <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1 truncate">
          <UserRound size={11} />
          {lead.assignedTo || 'بی مسئول'}
        </span>
        {lead.nextFollowUpDate && (
          <span
            className={`flex items-center gap-1 shrink-0 font-bold ${overdue ? 'text-rose-600' : 'text-slate-500'}`}
            title={overdue ? 'پیگیری گذشته است' : 'پیگیری بعدی'}
          >
            <CalendarClock size={11} />
            {formatPersianDate(lead.nextFollowUpDate)}
          </span>
        )}
      </div>

      <select
        value={lead.stage}
        onChange={(e) => actions.onStageChange(lead.id, e.target.value)}
        aria-label="مرحله پرونده"
        className="w-full bg-slate-100 text-slate-700 font-bold rounded-lg px-1.5 py-1 outline-none border-none text-[10px] cursor-pointer"
      >
        {STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.title}
          </option>
        ))}
      </select>
    </div>
  );
}
