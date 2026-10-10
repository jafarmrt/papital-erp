import { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { fetchJson } from '../../api';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { formatPersianNumber } from '../../utils/persianNumber';
import { materialCostPerUnit, projectMaterialCost, type AllocationCostRow, type ProjectMaterialCost } from '../../lib/inventory/projectMaterialCost';

interface ProjectMaterialCostNoteProps {
  projectId: number;
  /** تیراژ تنها محصول پروژه؛ برای پروژه چندمحصولی null، چون سهم هر محصول از مواد را سامانه نمی‌داند */
  singleProductQuantity: number | null;
}

/**
 * v10.0.130 (TD-1210): جمع بهای مواد تخصیص‌یافته به پروژه در زبانه «ورود به انبار»، تا بهای واحد محصول از همین زبانه
 * نوشته شود. فقط برای کسی نشان داده می‌شود که ورود به انبار را دارد (`warehouse.in`، خواننده بهای کالا).
 */
export function ProjectMaterialCostNote({ projectId, singleProductQuantity }: ProjectMaterialCostNoteProps) {
  const rial = useRialDisplay();
  const [summary, setSummary] = useState<ProjectMaterialCost | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<{ allocations?: AllocationCostRow[] }>(`/inventory/allocations?projectId=${projectId}`, { signal: controller.signal })
      .then(res => {
        const rows = Array.isArray(res?.allocations) ? res.allocations : [];
        setSummary(projectMaterialCost(rows));
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummary(null);
      });
    return () => controller.abort();
  }, [projectId]);

  if (!summary || (summary.counted === 0 && summary.withoutCost === 0)) return null;
  const perUnit = singleProductQuantity === null ? null : materialCostPerUnit(summary.total, singleProductQuantity);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="project-material-cost">
      <span className="flex items-center gap-1.5">
        <Calculator className="w-3.5 h-3.5 text-sky-500" />
        <span>جمع بهای مواد تخصیص‌یافته به پروژه:</span>
        <strong className="font-mono">{rial.amount(summary.total)}</strong>
        <span className="text-sky-700">({formatPersianNumber(summary.counted)} تخصیص)</span>
      </span>
      {perUnit !== null && singleProductQuantity !== null && (
        <span>
          بهای هر واحد با تیراژ {formatPersianNumber(singleProductQuantity)}: <strong className="font-mono">{rial.amount(perUnit)}</strong>
        </span>
      )}
      {summary.withoutCost > 0 && (
        <span className="text-amber-700">{formatPersianNumber(summary.withoutCost)} تخصیص قدیمی بها ندارد و در جمع نیامده است.</span>
      )}
    </div>
  );
}
