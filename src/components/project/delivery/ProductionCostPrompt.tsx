import { AlertTriangle } from 'lucide-react';
import type { DeliveryCostReasonKind } from '../../../lib/projects/deliveryCostPlan';

/** a delivery the server priced off the project's real cost and asked a reason for (`PRODUCTION_COST_REASON_REQUIRED`) */
export interface ProductionCostAsk {
  kind: DeliveryCostReasonKind;
  /** the server's sentence, with its figures */
  message: string;
}

const KINDS: readonly DeliveryCostReasonKind[] = ['cost_changed', 'overdraw', 'no_wip'];

/** the cost question of a refused delivery, or null when the refusal is something else */
export function productionCostAskOf(err: unknown): ProductionCostAsk | null {
  const e = err as { code?: unknown; message?: unknown; details?: { kind?: unknown } } | null;
  if (e?.code !== 'PRODUCTION_COST_REASON_REQUIRED') return null;
  const kind = KINDS.find(k => k === e.details?.kind) ?? 'cost_changed';
  return { kind, message: typeof e.message === 'string' ? e.message : '' };
}

const TITLES: Record<DeliveryCostReasonKind, string> = {
  cost_changed: 'بهای واردشده با بهای واقعی تولید نمی‌خواند',
  overdraw: 'جمع بها بیش از ماندهٔ کالای در جریان ساخت پروژه است',
  no_wip: 'کالای در جریان ساخت پروژه مانده‌ای ندارد',
};

interface ProductionCostPromptProps {
  ask: ProductionCostAsk;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}

/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): a production receipt costs the project's real cost; a cost other than that is
 * recorded only with a reason, and the difference goes to «اختلاف بهای تولید». The server refuses such a delivery without
 * one, and this box shows why and resends the same delivery with the reason. Clearing the typed cost instead closes it.
 */
export function ProductionCostPrompt({ ask, reason, onReasonChange, onConfirm, onCancel, submitting }: ProductionCostPromptProps) {
  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3 text-xs" role="alert" data-testid="production-cost-prompt">
      <div className="flex items-center gap-2 font-bold text-amber-900">
        <AlertTriangle className="w-4 h-4" />
        <span>{TITLES[ask.kind]}</span>
      </div>
      {ask.message && <p className="text-amber-900 leading-6">{ask.message}</p>}
      <label className="block font-bold text-amber-900">
        دلیل بهای تولید (الزامی):
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="مثال: بخشی از مواد این محصول از پروژهٔ دیگری آمده است"
          className="mt-1 w-full p-2 bg-white border border-amber-300 rounded-lg text-slate-800 font-normal focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={submitting}
          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold disabled:opacity-50">
          انصراف
        </button>
        <button type="button" onClick={onConfirm} disabled={submitting || !reason.trim()}
          className="px-3 py-1.5 rounded-lg bg-amber-700 text-white font-bold disabled:opacity-50">
          {submitting ? 'در حال ثبت…' : 'ثبت با این دلیل'}
        </button>
      </div>
    </div>
  );
}
