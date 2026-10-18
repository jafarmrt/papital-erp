import { PackageOpen } from 'lucide-react';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { useProjectIssuedMaterials } from '../../hooks/useProjectMaterialReports';
import { formatPersianCode, formatPersianDate, formatPersianNumber } from '../../utils';
import { ISSUED_MATERIAL_SOURCE_LABELS, ISSUED_MATERIAL_STATUS_LABELS } from '../../lib/projects/issuedMaterials';

/**
 * v10.2.1 (TD-1290، یافتهٔ D3): «مواد گرفته‌شده از انبار» در زبانهٔ مواد پروژه: چه، چقدر و کی، از تخصیص مواد و حواله و ضایعات
 * قطعی پروژه. بها فقط وقتی پاسخ آن را دارد (خوانندهٔ بهای کالا) نشان داده می‌شود.
 */
/** مبلغ ریالی؛ جدا تا تنظیم واحد نمایش فقط وقتی بها نشان داده می‌شود خوانده شود */
function RialAmount({ value }: { value: number }) {
  const rial = useRialDisplay();
  return <>{rial.amount(value)}</>;
}

export function ProjectIssuedMaterialsList({ projectId, reloadKey }: { projectId: unknown; reloadKey?: unknown }) {
  const { status, data } = useProjectIssuedMaterials(projectId, reloadKey);

  return (
    <section className="space-y-3 pt-4 border-t-2 border-slate-200 print:hidden" aria-label="مواد گرفته‌شده از انبار">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PackageOpen className="w-4 h-4 text-amber-600" />
          <h3 className="font-bold text-sm text-slate-900">مواد گرفته‌شده از انبار</h3>
        </div>
        {data && (
          <span className="text-xs text-slate-500">{formatPersianNumber(data.total)} ردیف</span>
        )}
      </div>

      {status === 'error' && !data ? (
        <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">فهرست مواد گرفته‌شده از انبار خوانده نشد.</div>
      ) : !data ? (
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500">در حال خواندن…</div>
      ) : data.rows.length === 0 ? (
        <div className="p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
          هنوز ماده‌ای با تخصیص مواد، حواله یا ضایعات به این پروژه داده نشده است.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100/80 text-slate-700 font-bold">
              <tr>
                <th className="p-2.5 border-b border-slate-200">تاریخ</th>
                <th className="p-2.5 border-b border-slate-200">از راه</th>
                <th className="p-2.5 border-b border-slate-200">ماده اولیه</th>
                <th className="p-2.5 border-b border-slate-200 text-center">مقدار</th>
                <th className="p-2.5 border-b border-slate-200 text-center">وضعیت</th>
                {data.costVisible && <th className="p-2.5 border-b border-slate-200 text-center">بها</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map(row => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="p-2.5 whitespace-nowrap font-mono">{formatPersianDate(row.date)}</td>
                  <td className="p-2.5 whitespace-nowrap">
                    {ISSUED_MATERIAL_SOURCE_LABELS[row.source]}
                    {row.refNumber && <span className="mr-1 font-mono text-slate-500">{formatPersianCode(row.refNumber)}</span>}
                  </td>
                  <td className="p-2.5">
                    <span className="font-bold text-slate-900">{row.itemName}</span>
                    {row.itemCode && <span className="block font-mono text-[10px] text-slate-500">کد: {row.itemCode}</span>}
                  </td>
                  <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap">{formatPersianNumber(row.quantity)} {row.unit}</td>
                  <td className="p-2.5 text-center whitespace-nowrap">{ISSUED_MATERIAL_STATUS_LABELS[row.status] ?? row.status}</td>
                  {data.costVisible && (
                    <td className="p-2.5 text-center font-mono whitespace-nowrap">{row.cost === null ? '—' : <RialAmount value={row.cost} />}</td>
                  )}
                </tr>
              ))}
            </tbody>
            {data.costVisible && data.totalCost !== null && (
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td className="p-2.5" colSpan={5}>جمع بهای مواد داده‌شده به پروژه</td>
                  <td className="p-2.5 text-center font-mono whitespace-nowrap"><RialAmount value={data.totalCost} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {data && data.total > data.rows.length && (
        <p className="text-[11px] text-slate-500">
          {formatPersianNumber(data.rows.length)} ردیف تازه‌تر نشان داده شده؛ {formatPersianNumber(data.total - data.rows.length)} ردیف قدیمی‌تر در این فهرست نیامده است.
        </p>
      )}
    </section>
  );
}
