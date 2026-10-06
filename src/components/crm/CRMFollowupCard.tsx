import { Calendar, Check, User, Briefcase, UserCheck } from 'lucide-react';
import type { CRMActivity, CRMLead } from '../../types';
import { formatPersianDate } from '../../utils';

interface CRMFollowupCardProps {
  act: CRMActivity;
  leads?: CRMLead[];
  onToggleFollowup: (act: CRMActivity) => void;
}

/** کارت یک پیگیری (از v9.0.14 جدا از `CRMFollowupsView`) */
export function CRMFollowupCard({ act, leads = [], onToggleFollowup }: CRMFollowupCardProps) {
  const leadObj = leads.find((l) => l.id === act.leadId);
  const displayCustomerName = act.customerName || leadObj?.customerName || leadObj?.company || '';
  const displayLeadTitle = act.leadTitle || leadObj?.title || act.title;

  return (
    <div
      data-followup-id={act.id}
      className={`bg-white rounded-2xl border p-4 shadow-2xs transition-all relative space-y-2.5 ${
        act.isFollowUpCompleted ? 'border-slate-200 bg-slate-50/50 opacity-70' : 'border-amber-300 shadow-xs'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 text-[11px] font-mono font-bold rounded-lg flex items-center gap-1 border border-amber-200">
          <Calendar size={13} />
          {formatPersianDate(act.nextFollowUpDate)}
        </span>

        <button
          onClick={() => onToggleFollowup(act)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
            act.isFollowUpCompleted
              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs'
          }`}
        >
          <Check size={14} />
          {act.isFollowUpCompleted ? 'انجام شده' : 'تکمیل پیگیری'}
        </button>
      </div>

      {/* Customer and Lead Badges */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {displayCustomerName ? (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200/80 text-[10px] font-bold rounded-md flex items-center gap-1" title="نام مشتری">
            <User size={11} className="text-blue-600" />
            مشتری: {displayCustomerName}
          </span>
        ) : null}
        {displayLeadTitle ? (
          <span className="px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200/80 text-[10px] font-bold rounded-md flex items-center gap-1" title="نام پرونده فروش">
            <Briefcase size={11} className="text-purple-600" />
            پرونده: {displayLeadTitle}
          </span>
        ) : null}
      </div>

      <div>
        <h4 className="font-black text-xs text-slate-900 mb-0.5">
          {act.nextFollowUpTask || act.title}
        </h4>
        <p className="text-[11px] text-slate-500">
          اقدام مربوطه: <span className="font-bold text-slate-700">{act.title}</span>
        </p>
      </div>

      {act.description && (
        <div className="p-2.5 bg-slate-50 rounded-xl text-[11px] text-slate-600 border border-slate-100 leading-relaxed">
          {act.description}
        </div>
      )}

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
        <span>ثبت: {act.loggedBy || 'فروشنده'}</span>
        {act.assignedTo && (
          <span className="font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 flex items-center gap-1">
            <UserCheck size={11} />
            مسئول: {act.assignedTo}
          </span>
        )}
      </div>
    </div>
  );
}
