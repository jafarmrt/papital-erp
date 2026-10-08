import { useState } from 'react';
import { ShieldCheck, Webhook, Zap } from 'lucide-react';
import { useSimulateEventMutation } from '../../hooks/queries/useEventQueries';
import { publishedEventTypesByCategory, PUBLISHED_EVENT_TYPES } from '../../lib/events/eventTypeCatalog';
import { actionPreviewLines, type EventSimulationResult } from '../../lib/events/eventSimulationContract';
import { ruleActionTypeLabel } from '../../lib/events/ruleActionTypes';
import { errorMessageOf } from '../../utils';

const EVENT_TYPE_GROUPS = publishedEventTypesByCategory();

/**
 * v9.0.385 (TD-708, B15-06, decision t5 a): «شبیه‌سازی بی‌اثر» of a published event type. Nothing is published, sent or
 * written; the panel shows which active rules would match and what their actions would do, and which webhook subscriptions
 * would receive it. Before, «انتشار رویداد آزمایشی» published a made-up event to the live handlers.
 */
export function EventSimulationPanel() {
  const [eventType, setEventType] = useState<string>(PUBLISHED_EVENT_TYPES[0]?.value ?? '');
  const [result, setResult] = useState<EventSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const simulateMutation = useSimulateEventMutation();

  const handleSimulate = async () => {
    setError(null);
    setResult(null);
    try {
      setResult(await simulateMutation.mutateAsync({ eventType }));
    } catch (err) {
      setError(errorMessageOf(err) || 'شبیه‌سازی رویداد انجام نشد.');
    }
  };

  const matchedRules = result?.rules.filter(rule => rule.matched) ?? [];

  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <label htmlFor="event-simulation-type" className="text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">
          شبیه‌سازی بی‌اثر رویداد
        </label>
        <select
          id="event-simulation-type"
          value={eventType}
          onChange={e => { setEventType(e.target.value); setResult(null); setError(null); }}
          className="text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none md:w-72"
        >
          {EVENT_TYPE_GROUPS.map(group => (
            <optgroup key={group.category} label={group.category}>
              {group.types.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void handleSimulate()}
          disabled={simulateMutation.isPending || !eventType}
          className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all disabled:opacity-50"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{simulateMutation.isPending ? 'در حال شبیه‌سازی...' : 'شبیه‌سازی بی‌اثر'}</span>
        </button>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        رویداد نمونه منتشر نمی‌شود و هیچ اعلان، ممیزی یا وب‌هوکی فرستاده نمی‌شود؛ فقط نشان داده می‌شود چه رخ می‌داد.
      </p>

      {error && (
        <p role="alert" className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg p-2.5">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2" data-testid="event-simulation-result">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
            {result.message}
          </p>
          {matchedRules.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">هیچ قانون فعالی با این رویداد جور نمی‌شد.</p>
          )}
          {matchedRules.map(rule => (
            <div key={rule.ruleId} className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100">
                <Zap className="w-3.5 h-3.5 text-indigo-500" />
                <span>{rule.ruleName}</span>
                <span className="font-normal text-slate-500">({ruleActionTypeLabel(rule.actionType)})</span>
              </div>
              {rule.problem
                ? <p className="mt-1 text-rose-700 dark:text-rose-300">{rule.problem}</p>
                : actionPreviewLines(rule.preview).map(line => <p key={line} className="mt-1 text-slate-600 dark:text-slate-300 break-all">{line}</p>)}
            </div>
          ))}
          {result.webhooks.map(webhook => (
            <div key={webhook.subscriptionId} className="flex items-center gap-1.5 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200">
              <Webhook className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span>اشتراک «{webhook.name}» آن را به <span dir="ltr" className="break-all">{webhook.targetUrl}</span> می‌فرستاد</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
