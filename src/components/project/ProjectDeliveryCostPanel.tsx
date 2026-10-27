import { Calculator } from 'lucide-react';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { formatPersianNumber } from '../../utils';
import type { DeliveryCostOutlook } from '../../lib/projects/deliveryCostSuggestion';
import type { DeliveryCostReasonKind } from '../../lib/projects/deliveryCostPlan';
import type { MaterialAvailabilityStatus } from '../../lib/projects/materialAvailability';

interface ProjectDeliveryCostPanelProps {
  status: MaterialAvailabilityStatus;
  outlook: DeliveryCostOutlook | null;
  /** the plan's remaining quantity of a single-product project, the divisor of its unit cost */
  remainingPlanQty: number | null;
}

const REASON_NOTES: Record<DeliveryCostReasonKind, string> = {
  cost_changed: 'بهای واردشده با بهای واقعی تولید نمی‌خواند؛ هنگام ثبت دلیل خواسته می‌شود. برای بهای واقعی، خانهٔ بها را خالی بگذارید.',
  overdraw: 'جمع بهای این ورود بیش از ماندهٔ کالای در جریان ساخت پروژه است؛ هنگام ثبت دلیل خواسته می‌شود.',
  no_wip: 'کالای در جریان ساخت این پروژه مانده‌ای ندارد؛ ورود به بهای واردشده یا میانگین موزون بها دلیل می‌خواهد.',
};

/**
 * v10.2.3 (TD-1290، یافتهٔ D2): پیش از ثبت رسید تولید، ماندهٔ «کالای در جریان ساخت» (۱۴۰۲) پروژه، آنچه این ورود از آن
 * برمی‌دارد و آنچه می‌ماند. فقط برای کسی که ورود به انبار را دارد و بها را می‌بیند.
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): the figures are the server's own rule (`planDeliveryCost`): the unit cost of a
 * single-product project, how a project of several products is priced, and when the delivery will ask for a reason and
 * what goes to «اختلاف بهای تولید».
 */
export function ProjectDeliveryCostPanel({ status, outlook, remainingPlanQty }: ProjectDeliveryCostPanelProps) {
  const rial = useRialDisplay();
  if (status === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="project-delivery-cost">
        ماندهٔ کالای در جریان ساخت پروژه خوانده نشد. خانهٔ بها را خالی بگذارید تا سرور بهای واقعی تولید را ثبت کند.
      </div>
    );
  }
  if (!outlook) {
    return status === 'loading' ? (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="project-delivery-cost">
        در حال خواندن ماندهٔ کالای در جریان ساخت پروژه…
      </div>
    ) : null;
  }
  const singleUnitCost = !outlook.multiProduct && (outlook.rule === 'share' || outlook.rule === 'complete') ? outlook.unitCosts[0] ?? null : null;

  return (
    <div className="space-y-1.5 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="project-delivery-cost">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Calculator className="w-3.5 h-3.5 text-sky-500" />
          <span>ماندهٔ کالای در جریان ساخت این پروژه:</span>
          <strong className="font-mono">{rial.amount(outlook.wipBalance)}</strong>
        </span>
        {singleUnitCost !== null && remainingPlanQty !== null && (
          <span>
            بهای واقعی هر واحد: <strong className="font-mono">{rial.amount(singleUnitCost)}</strong>
            <span className="text-sky-700"> (مانده ÷ {formatPersianNumber(remainingPlanQty)} واحد)</span>
          </span>
        )}
        <span>این ورود برمی‌دارد: <strong className="font-mono">{rial.amount(outlook.credit)}</strong></span>
        <span>پس از آن می‌ماند: <strong className="font-mono">{rial.amount(outlook.remaining)}</strong></span>
      </div>
      <p className="text-[11px] text-sky-700">
        بهای رسید تولید همان بهای واقعی پروژه است: تخصیص مواد و حوالهٔ پروژه منهای تحویل‌های پیشین (دستمزد در آن نیست). خانهٔ بهای خالی همین بها را می‌گیرد.
      </p>
      {outlook.multiProduct && outlook.rule === 'entered' && (
        <p className="text-[11px] text-sky-800">
          پروژهٔ چندمحصولی: تا پیش از تحویل آخر، بهای هر محصول بهای واردشده یا میانگین موزون بهای آن است؛ تحویلی که برنامه را کامل کند همهٔ مانده را به نسبت همین بها میان محصولاتش پخش می‌کند.
        </p>
      )}
      {outlook.rule === 'complete' && (
        <p className="text-[11px] text-emerald-800 font-semibold">
          این ورود برنامهٔ پروژه را کامل می‌کند و همهٔ ماندهٔ کالای در جریان ساخت پروژه را می‌بندد
          {outlook.multiProduct ? '؛ مانده به نسبت بهای واردشده یا میانگین موزون بها میان محصولات این ورود پخش می‌شود.' : '.'}
        </p>
      )}
      {outlook.reasonNeeded && (
        <p className="text-[11px] text-amber-800 font-semibold" role="alert">
          {REASON_NOTES[outlook.reasonNeeded]} اختلاف {rial.amount(Math.abs(outlook.variance))} به حساب «اختلاف بهای تولید» می‌رود.
        </p>
      )}
      {outlook.withoutCost > 0 && (
        <p className="text-[11px] text-rose-700 font-semibold">
          {formatPersianNumber(outlook.withoutCost)} محصول نه بهای واحد دارد نه میانگین موزون بها و بی بها پذیرفته نمی‌شود.
        </p>
      )}
    </div>
  );
}
