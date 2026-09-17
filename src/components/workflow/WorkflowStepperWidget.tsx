import React, { useState } from 'react';
import { useWorkflowInstanceQuery, useStartWorkflowMutation, useExecuteTransitionMutation, WorkflowTransition } from '../../hooks/queries';
import { 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Play, 
  Send, 
  ShieldCheck, 
  History, 
  MessageSquare, 
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Users
} from 'lucide-react';
import { formatPersianDate, formatPersianPrice } from '../../utils';

interface WorkflowStepperWidgetProps {
  entityType: string;
  entityId: string | number;
  workflowCode: string;
  title?: string;
  onStateChange?: () => void;
}

export const WorkflowStepperWidget: React.FC<WorkflowStepperWidgetProps> = ({
  entityType,
  entityId,
  workflowCode,
  title = 'چرخه تاییدات و گردش کار (Workflow)',
  onStateChange
}) => {
  const { data: wfData, isLoading } = useWorkflowInstanceQuery(entityType, entityId);
  const startWorkflowMutation = useStartWorkflowMutation();
  const executeTransitionMutation = useExecuteTransitionMutation();

  const [selectedTransition, setSelectedTransition] = useState<WorkflowTransition | null>(null);
  const [comment, setComment] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-3"></div>
        <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded w-full"></div>
      </div>
    );
  }

  const instance = wfData?.instance;
  const currentState = wfData?.currentState;
  const allStates = wfData?.allStates || [];
  const availableTransitions = wfData?.availableTransitions || [];
  const history = wfData?.history || [];

  const handleStartWorkflow = () => {
    startWorkflowMutation.mutate(
      { workflowCode, entityType, entityId },
      { onSuccess: () => onStateChange?.() }
    );
  };

  const handleExecuteAction = () => {
    if (!instance || !selectedTransition) return;
    executeTransitionMutation.mutate(
      {
        instanceId: instance.id,
        transitionId: selectedTransition.id,
        comment,
        entityType,
        entityId
      },
      {
        onSuccess: () => {
          setSelectedTransition(null);
          setComment('');
          onStateChange?.();
        }
      }
    );
  };

  const getStateColorClass = (color: string) => {
    switch (color) {
      case 'emerald':
      case 'green':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'amber':
      case 'yellow':
        return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400';
      case 'rose':
      case 'red':
        return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400';
      case 'sky':
      case 'indigo':
      case 'blue':
        return 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-gray-100 dark:border-gray-700/60 pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h3>
          {wfData?.definition && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                {wfData.definition.title}
              </span>
              {instance?.definitionVersion && (
                <span className="text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600" title="نسخه‌بندی ثابت (Immutable) - تغییرات تعاریف بر روی این سند تاثیر نمی‌گذارد">
                  نسخه v{instance.definitionVersion} (ثابت)
                </span>
              )}
            </div>
          )}
        </div>

        {instance && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            <span>تاریخچه اقدامات ({history.length})</span>
            {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Body: Case 1 - No Workflow Started */}
      {!instance ? (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>چرخه گردش کار برای این سند فعال نشده است.</span>
          </div>
          <button
            onClick={handleStartWorkflow}
            disabled={startWorkflowMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{startWorkflowMutation.isPending ? 'در حال فعال‌سازی...' : 'شروع چرخه ورکفلو'}</span>
          </button>
        </div>
      ) : (
        /* Case 2 - Active Workflow Stepper & Actions */
        <div>
          {/* Stepper Graph Visualizer */}
          <div className="mb-4">
            <div className="flex items-center justify-between overflow-x-auto py-2 px-1 gap-2 border-b border-gray-100 dark:border-gray-700/40 pb-4">
              {allStates.map((st, idx) => {
                let statusType: 'completed' | 'current' | 'pending' | 'rejected' | 'skipped' = 'pending';
                let statusLabel = 'در انتظار';
                let statusColorClass = 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700 opacity-70';

                if (instance.status === 'REJECTED' && currentState?.id === st.id) {
                  statusType = 'rejected';
                  statusLabel = 'ردشده';
                  statusColorClass = 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800 font-bold';
                } else if (currentState?.id === st.id && instance.status === 'IN_PROGRESS') {
                  statusType = 'current';
                  statusLabel = 'گام جاری';
                  statusColorClass = `${getStateColorClass(st.color)} ring-2 ring-offset-1 ring-indigo-500 dark:ring-offset-gray-800 shadow-sm font-semibold`;
                } else if (instance.status === 'COMPLETED' || (st.stepOrder < (currentState?.stepOrder || 0))) {
                  const visited = history.some(h => h.toStateId === st.id || h.fromStateId === st.id);
                  if (!visited && st.stepOrder < (currentState?.stepOrder || 0)) {
                    statusType = 'skipped';
                    statusLabel = 'عبورکرده';
                    statusColorClass = 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 opacity-80';
                  } else {
                    statusType = 'completed';
                    statusLabel = 'تکمیل‌شده';
                    statusColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800 font-medium';
                  }
                }

                return (
                  <div key={st.id} className="flex items-center gap-2 shrink-0">
                    <div className="flex flex-col items-center gap-1">
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${statusColorClass}`}>
                        {statusType === 'completed' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : statusType === 'rejected' ? (
                          <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                        ) : statusType === 'current' ? (
                          <Clock className="w-3.5 h-3.5 animate-spin shrink-0" />
                        ) : statusType === 'skipped' ? (
                          <span className="w-3.5 h-3.5 rounded-full bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center text-[9px] font-mono shrink-0">»</span>
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[10px] shrink-0">
                            {idx + 1}
                          </span>
                        )}
                        <span className="font-semibold">{st.title}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                        {statusLabel}
                      </span>
                    </div>

                    {idx < allStates.length - 1 && (
                      <div className={`h-0.5 w-6 self-center mb-4 ${statusType === 'completed' ? 'bg-emerald-400 dark:bg-emerald-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Multi-Approval Progress Banner */}
          {instance.status === 'IN_PROGRESS' && wfData?.approvalProgress && Object.keys(wfData.approvalProgress).length > 0 && (
            <div className="mb-3 space-y-2">
              {Object.entries(wfData.approvalProgress).map(([trId, prog]: [string, any]) => {
                const tr = (allStates || []).flatMap(() => availableTransitions || []).find((t: any) => String(t.id) === String(trId));
                const sigs = prog.signatures || [];
                const reqCount = tr?.kValue || 2;
                const ruleType = prog.ruleType || tr?.approvalRuleType || 'MULTI';
                const ruleLabel = ruleType === 'AND_ALL' || ruleType === 'ALL' ? 'اتفاق آرا (AND_ALL)' :
                                  ruleType === 'OR_ANY' || ruleType === 'ANY' ? 'اولین تایید (OR_ANY)' :
                                  ruleType === 'K_OF_N' ? `حد نصاب ${reqCount} امضا (K_OF_N)` : 'تایید موازی';

                return (
                  <div key={trId} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl p-3 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                        <Users className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span>پیشرفت تایید موازی: {tr?.title || 'اقدام در حال تایید'}</span>
                      </div>
                      <span className="bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                        {ruleLabel}
                      </span>
                    </div>

                    <div className="w-full bg-amber-200 dark:bg-amber-900/40 rounded-full h-2 mb-2 overflow-hidden">
                      <div 
                        className="bg-amber-600 dark:bg-amber-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((sigs.length / reqCount) * 100))}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-300">
                      <span>امضاهای ثبت‌شده ({sigs.length} از {reqCount}):</span>
                      <span>{reqCount - sigs.length > 0 ? `${reqCount - sigs.length} امضای دیگر تا تکمیل گام` : 'در حال نهایی‌سازی'}</span>
                    </div>

                    {sigs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sigs.map((s: any, sIdx: number) => (
                          <div key={sIdx} className="flex items-center gap-1 bg-white/80 dark:bg-gray-800/80 px-2 py-0.5 rounded-md border border-amber-200/60 dark:border-amber-700/50 text-[10px] text-gray-700 dark:text-gray-300 shadow-2xs">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            <span className="font-semibold">{s.userName || `کاربر #${s.userId}`}</span>
                            {s.comment && <span className="text-gray-400">({s.comment})</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Available Actions Bar */}
          {instance.status === 'IN_PROGRESS' && availableTransitions.length > 0 && (
            <div className="bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  اقدامات قابل انجام توسط شما:
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {availableTransitions.map((tr) => {
                  const progressMap = wfData?.approvalProgress || {};
                  const trProgress = progressMap[tr.id] || { signatures: [] };
                  const sigCount = trProgress.signatures?.length || 0;
                  const isMulti = tr.approvalRuleType && tr.approvalRuleType !== 'SINGLE';
                  const reqK = tr.approvalRuleType === 'OR_ANY' || tr.approvalRuleType === 'ANY' ? 1 : (tr.kValue || 2);

                  return (
                    <button
                      key={tr.id}
                      onClick={() => setSelectedTransition(tr)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all shadow-sm ${
                        tr.actionKey === 'approve' || tr.actionKey === 'qc_pass' || tr.actionKey === 'approve_material'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                          : tr.actionKey === 'reject' || tr.actionKey === 'qc_fail' || tr.actionKey === 'reject_material'
                          ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600'
                          : 'bg-white dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      <span>{tr.title}</span>
                      {isMulti && (
                        <span className="bg-black/20 text-white text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                          {sigCount}/{reqK} امضا
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Prompt / Modal Inline */}
          {selectedTransition && (
            <div className="bg-white dark:bg-gray-800 border-2 border-indigo-500 rounded-xl p-3 my-3 shadow-md animate-fadeIn">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-900 dark:text-white">
                  تایید اقدام: «{selectedTransition.title}»
                </span>
                <button
                  onClick={() => setSelectedTransition(null)}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  انصراف
                </button>
              </div>

              {/* Document Summary Context */}
              {entityType === 'document' && wfData?.entityContext && (
                <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs grid grid-cols-2 gap-2 border border-gray-200 dark:border-gray-600">
                  <div>
                    <span className="text-gray-400 text-[10px]">شماره سند: </span>
                    <span className="font-mono font-bold text-gray-800 dark:text-gray-200">{wfData.entityContext.refNumber || entityId}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 text-[10px]">خریدار: </span>
                    <span className="font-bold text-gray-800 dark:text-gray-200 truncate">{wfData.entityContext.buyerName || '-'}</span>
                  </div>
                  {wfData.entityContext.amount ? (
                    <div className="col-span-2">
                      <span className="text-gray-400 text-[10px]">مبلغ سند: </span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatPersianPrice(Number(wfData.entityContext.amount), wfData.entityContext.currency)}
                      </span>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-indigo-500" />
                  توضیحات / یادداشت مدیر (اختیاری):
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="دلیل تایید، رد یا دستورات بعدی را ثبت کنید..."
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSelectedTransition(null)}
                  className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  انصراف
                </button>
                <button
                  onClick={handleExecuteAction}
                  disabled={executeTransitionMutation.isPending}
                  className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1"
                >
                  {executeTransitionMutation.isPending ? 'در حال ثبت...' : 'ثبت و اعمال تغییر وضعیت'}
                </button>
              </div>
            </div>
          )}

          {/* History Collapsible Panel */}
          {showHistory && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-indigo-500" />
                سوابق و ردپای تغییرات وضعیت:
              </h4>

              {history.length === 0 ? (
                <p className="text-xs text-gray-400 italic">هیچ اقدام قبلی ثبت نشده است.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {history.map((log) => (
                    <div
                      key={log.id}
                      className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/80 text-xs"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">
                          {log.actionTitle || log.actionKey}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {log.createdAt ? formatPersianDate(log.createdAt) : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                        <span>توسط: {log.performedByName || 'کاربر سیستم'}</span>
                      </div>
                      {log.comment && (
                        <p className="mt-1 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 p-1.5 rounded border border-gray-100 dark:border-gray-700 text-[11px]">
                          💬 {log.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
