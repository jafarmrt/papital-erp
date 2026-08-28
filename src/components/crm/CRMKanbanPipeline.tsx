import React from 'react';
import { Plus, PhoneCall, Edit3, Trash2, FileText } from 'lucide-react';
import { CRMLead } from '../../types';
import { STAGES } from '../../hooks/useCRMData';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';

interface CRMKanbanPipelineProps {
  leads: CRMLead[];
  onOpenLeadDrawer: (lead: CRMLead) => void;
  onOpenActivityModal: (lead: CRMLead) => void;
  onOpenLeadModal: (lead?: CRMLead) => void;
  onDeleteLead: (leadId: number) => void;
  onStageChange: (leadId: number, newStage: string) => void;
  onConvertToInvoice?: (lead: CRMLead) => void;
}

export function CRMKanbanPipeline({
  leads,
  onOpenLeadDrawer,
  onOpenActivityModal,
  onOpenLeadModal,
  onDeleteLead,
  onStageChange,
  onConvertToInvoice
}: CRMKanbanPipelineProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5 overflow-x-auto pb-4 custom-scrollbar">
      {STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.stage === stage.key);
        // V9 Phase 3: جمع ارزش هر مرحله به تفکیک ارز (رفع جمع mixed-currency)
        const stageTotals: Record<string, number> = {};
        for (const l of stageLeads) {
          const cur = String(l.currency || 'IRR');
          stageTotals[cur] = (stageTotals[cur] || 0) + (l.estimatedValue || 0);
        }

        return (
          <div
            key={stage.key}
            className={`rounded-2xl border ${stage.color} p-3.5 flex flex-col min-w-[260px] max-w-sm h-[calc(100vh-320px)] min-h-[520px] shadow-2xs`}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60">
              <div className="flex items-center gap-1.5">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${stage.badge}`}>
                  {formatPersianNumber(stageLeads.length)}
                </span>
                <h3 className="font-extrabold text-xs text-slate-800">{stage.title}</h3>
              </div>

              <button
                onClick={() => onOpenLeadModal()}
                className="p-1 hover:bg-white/60 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="افزودن پرونده"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Total stage value */}
            <div className="text-[10px] text-slate-500 font-bold mb-3 px-1 flex items-center justify-between">
              <span>مجموع ارزش:</span>
              <span className="text-slate-900 font-black text-left">
                {Object.entries(stageTotals).map(([cur, val]) => (
                  <div key={cur}>
                    {formatPersianPrice(val)} {formatCurrencyLabel(cur)}
                  </div>
                ))}
              </span>
            </div>

            {/* Cards list */}
            <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-0.5">
              {stageLeads.length === 0 ? (
                <div className="h-24 border border-dashed border-slate-300/80 rounded-xl flex items-center justify-center text-[11px] text-slate-400 font-medium">
                  خالی
                </div>
              ) : (
                stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs hover:shadow-md transition-all space-y-2 group relative"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <h4
                        onClick={() => onOpenLeadDrawer(lead)}
                        className="font-bold text-xs text-slate-900 hover:text-blue-600 cursor-pointer line-clamp-2 leading-relaxed"
                      >
                        {lead.title}
                      </h4>
                    </div>

                    <div className="text-[11px] text-slate-600 font-medium flex items-center justify-between">
                      <span className="truncate max-w-[130px]" title={lead.customerName || lead.company}>
                        👤 {lead.customerName || lead.company || 'بدون نام'}
                      </span>
                      {lead.phone && <span className="text-[10px] text-slate-400 dir-ltr">{lead.phone}</span>}
                    </div>

                    <div className="p-1.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="font-black text-slate-900">
                        {formatPersianPrice(lead.estimatedValue, lead.currency)} 
                      </span>
                      <span className="font-bold text-blue-600 text-[10px]">{formatPersianNumber(lead.probability)}٪ احتمال</span>
                    </div>

                    {/* Quick stage selector and action buttons */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[10px]">
                      <select
                        value={lead.stage}
                        onChange={(e) => onStageChange(lead.id, e.target.value)}
                        className="bg-slate-100 text-slate-700 font-bold rounded-lg px-1.5 py-0.5 outline-none border-none text-[10px] cursor-pointer"
                      >
                        {STAGES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.title}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                        {onConvertToInvoice && lead.stage === 'proposal' && (
                          <button
                            onClick={() => onConvertToInvoice(lead)}
                            className="p-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors cursor-pointer"
                            title="تبدیل به مشتری و صدور پیش‌فاکتور"
                          >
                            <FileText size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => onOpenActivityModal(lead)}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                          title="ثبت تماس"
                        >
                          <PhoneCall size={13} />
                        </button>
                        <button
                          onClick={() => onOpenLeadModal(lead)}
                          className="p-1 text-amber-600 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                          title="ویرایش"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => onDeleteLead(lead.id)}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CRMKanbanPipeline;
