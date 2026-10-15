import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { CRMLead } from '../../types';
import { STAGES } from '../../hooks/useCRMData';
import { formatPersianNumber, getTodayIsoDate } from '../../utils';
import { sumByCurrency } from '../../lib/crm/leadCurrencyTotals';
import { PIPELINE_COLUMN_WIDTH_PX, PIPELINE_DRAG_TYPE, draggedLeadId, leadsOfStage, stageAfterDrop } from '../../lib/crm/pipelineBoard';
import { usePhoneWidth } from '../../lib/pwa/usePhoneWidth';
import { CurrencyTotalsLines } from './CurrencyTotals';
import { CRMPipelineCard, type PipelineCardActions } from './CRMPipelineCard';

interface CRMKanbanPipelineProps extends PipelineCardActions {
  leads: CRMLead[];
}

type Stage = (typeof STAGES)[number];

interface StageColumnProps extends PipelineCardActions {
  stage: Stage;
  leads: CRMLead[];
  allLeads: CRMLead[];
  todayIso: string;
  phone: boolean;
}

function StageColumn({ stage, leads, allLeads, todayIso, phone, ...actions }: StageColumnProps) {
  const [dropping, setDropping] = useState(false);
  return (
    <section
      data-pipeline-stage={stage.key}
      aria-label={stage.title}
      style={phone ? undefined : { width: PIPELINE_COLUMN_WIDTH_PX }}
      onDragOver={(e) => {
        if (phone || !e.dataTransfer.types.includes(PIPELINE_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const leadId = draggedLeadId(e.dataTransfer.getData(PIPELINE_DRAG_TYPE));
        if (leadId === null) return;
        e.preventDefault();
        const target = stageAfterDrop(allLeads, leadId, stage.key);
        if (target) actions.onStageChange(leadId, target);
      }}
      className={`rounded-2xl border ${stage.color} p-3 flex flex-col shrink-0 ${phone ? 'w-full min-h-[60vh]' : 'h-[calc(100vh-320px)] min-h-[520px]'} ${
        dropping ? 'ring-2 ring-blue-400' : ''
      }`}
    >
      <header className="pb-2 mb-2 border-b border-slate-200/60 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${stage.badge}`}>{formatPersianNumber(leads.length)}</span>
            <h3 className="font-extrabold text-xs text-slate-800 truncate">{stage.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => actions.onOpenLeadModal()}
            className="p-1 hover:bg-white/60 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            title="افزودن پرونده"
          >
            <Plus size={14} />
          </button>
        </div>
        <CurrencyTotalsLines totals={sumByCurrency(leads)} className="text-[10px] font-black text-slate-900" labelClassName="text-[10px] font-normal" />
      </header>

      <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pe-0.5">
        {leads.length === 0 ? (
          <div className="h-20 border border-dashed border-slate-300/80 rounded-xl flex items-center justify-center text-[11px] text-slate-400 font-medium">
            {phone ? 'خالی' : 'خالی؛ کارت را اینجا رها کنید'}
          </div>
        ) : (
          leads.map((lead) => <CRMPipelineCard key={lead.id} lead={lead} todayIso={todayIso} draggable={!phone} {...actions} />)
        )}
      </div>
    </section>
  );
}

/**
 * قیف فروش. v10.1.22 (N-02 بخش ۳، TD-1272): ستون‌ها پهنای ثابت دارند و قیف افقی پیمایش می‌شود (پیش‌تر ستون‌ها روی هم
 * می‌افتادند)، کارت بین مرحله‌ها کشیده و رها می‌شود (ت۹) و روی گوشی هر مرحله یک زبانه است (ت۱۰). رها کردن همان
 * `onStageChange` فهرست کشویی را صدا می‌زند، پس «فروش موفق» بی پیش‌فاکتور و «ناموفق» بی دلیل همان‌جا رد یا پرسیده می‌شوند.
 */
export function CRMKanbanPipeline({ leads, ...actions }: CRMKanbanPipelineProps) {
  const phone = usePhoneWidth();
  const [phoneStage, setPhoneStage] = useState<string>(STAGES[0].key);
  const todayIso = getTodayIsoDate();

  if (phone) {
    const stage = STAGES.find((s) => s.key === phoneStage) ?? STAGES[0];
    return (
      <div className="space-y-3">
        <div role="tablist" aria-label="مرحله‌های قیف" className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          {STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              data-pipeline-tab={s.key}
              aria-selected={s.key === stage.key}
              onClick={() => setPhoneStage(s.key)}
              className={`min-h-[44px] shrink-0 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                s.key === stage.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s.title}
              <span className="text-[10px]">{formatPersianNumber(leadsOfStage(leads, s.key).length)}</span>
            </button>
          ))}
        </div>
        <StageColumn stage={stage} leads={leadsOfStage(leads, stage.key)} allLeads={leads} todayIso={todayIso} phone {...actions} />
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 custom-scrollbar">
      {STAGES.map((stage) => (
        <StageColumn key={stage.key} stage={stage} leads={leadsOfStage(leads, stage.key)} allLeads={leads} todayIso={todayIso} phone={false} {...actions} />
      ))}
    </div>
  );
}

export default CRMKanbanPipeline;
