import { Calculator } from 'lucide-react';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { formatPersianNumber } from '../../utils';
import type { DeliveryCostOutlook } from '../../lib/projects/deliveryCostSuggestion';
import type { MaterialAvailabilityStatus } from '../../lib/projects/materialAvailability';

interface ProjectDeliveryCostPanelProps {
  status: MaterialAvailabilityStatus;
  outlook: DeliveryCostOutlook | null;
  /** بهای واحد پیشنهادی پروژهٔ تک‌محصولی؛ null وقتی پیشنهادی نیست */
  suggestedUnitCost: number | null;
  /** مقدار باقی‌ماندهٔ برنامه که پیشنهاد بر آن تقسیم شده */
  remainingPlanQty: number | null;
}

/**
 * v10.2.0 (TD-1289، یافتهٔ D2): پیش از ثبت رسید تولید، ماندهٔ «کالای در جریان ساخت» (۱۴۰۲) پروژه، آنچه این ورود از آن
 * برمی‌دارد و آنچه می‌ماند. جای یادداشت جمع بهای تخصیص‌ها (TD-1210) را گرفته است، چون مانده حواله‌های پروژه و تحویل‌های
 * پیشین را هم دارد. فقط برای کسی که ورود به انبار را دارد و بها را می‌بیند.
 */
export function ProjectDeliveryCostPanel({ status, outlook, suggestedUnitCost, remainingPlanQty }: ProjectDeliveryCostPanelProps) {
  const rial = useRialDisplay();
  if (status === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="project-delivery-cost">
        ماندهٔ کالای در جریان ساخت پروژه خوانده نشد؛ بهای واحد را خودتان بنویسید یا خالی بگذارید تا میانگین موزون بهای جاری به کار رود.
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

  return (
    <div className="space-y-1.5 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="project-delivery-cost">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Calculator className="w-3.5 h-3.5 text-sky-500" />
          <span>ماندهٔ کالای در جریان ساخت این پروژه:</span>
          <strong className="font-mono">{rial.amount(outlook.wipBalance)}</strong>
        </span>
        {suggestedUnitCost !== null && remainingPlanQty !== null && (
          <span>
            بهای واحد پیشنهادی: <strong className="font-mono">{rial.amount(suggestedUnitCost)}</strong>
            <span className="text-sky-700"> (مانده ÷ {formatPersianNumber(remainingPlanQty)} واحد)</span>
          </span>
        )}
        <span>این ورود برمی‌دارد: <strong className="font-mono">{rial.amount(outlook.credit)}</strong></span>
        <span>پس از آن می‌ماند: <strong className="font-mono">{rial.amount(outlook.remaining)}</strong></span>
      </div>
      <p className="text-[11px] text-sky-700">
        مانده از همهٔ سندهای پروژه است، پیش‌نویس هم: تخصیص مواد و حوالهٔ پروژه منهای تحویل‌های پیشین؛ دستمزد در آن نیست.
      </p>
      {outlook.multiProduct && (
        <p className="text-[11px] text-amber-800 font-semibold">
          پروژهٔ چندمحصولی پیشنهاد خودکار ندارد؛ بهای هر محصول را طوری بنویسید که جمع تحویل‌ها با مانده بخواند.
        </p>
      )}
      {outlook.remaining < 0 && (
        <p className="text-[11px] text-rose-700 font-semibold" role="alert">
          این ورود بیش از ماندهٔ مواد پروژه را بستانکار می‌کند و ماندهٔ کالای در جریان ساخت پروژه منفی می‌شود.
        </p>
      )}
      {outlook.remaining > 0 && outlook.completesPlan && (
        <p className="text-[11px] text-amber-800 font-semibold" role="alert">
          با این ورود همهٔ برنامهٔ پروژه تحویل می‌شود و {rial.amount(outlook.remaining)} در کالای در جریان ساخت پروژه می‌ماند.
        </p>
      )}
      {outlook.withoutCost > 0 && (
        <p className="text-[11px] text-rose-700 font-semibold">
          {formatPersianNumber(outlook.withoutCost)} محصول نه بهای واحد دارد نه میانگین موزون بها و بی بها پذیرفته نمی‌شود.
        </p>
      )}
      <p className="text-[11px] text-slate-500">
        سندها و مانده‌های پیشین دست نمی‌خورند؛ بهای پیشنهادی فقط برای همین ورود است و می‌توانید آن را تغییر دهید.
      </p>
    </div>
  );
}
