import { useCompanyName } from '../../hooks/useCompanyName';
import { getTodayJalaliDate, toPersianDigits } from '../../utils';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): سربرگ چاپی گزارش‌های مدیریتی؛ فقط در چاپ دیده می‌شود: نام مجموعه، عنوان
 * گزارش، مشخصات (بازه، ارز، تفکیک و پالایه‌ها) و تاریخ چاپ.
 */

interface ReportPrintHeaderProps {
  title: string;
  meta: Array<[string, string]>;
}

export function ReportPrintHeader({ title, meta }: ReportPrintHeaderProps) {
  const companyName = useCompanyName();
  return (
    <div className="hidden print:block mb-4 pb-3 border-b-2 border-slate-900 text-right" data-testid="report-print-header">
      {companyName && <p className="text-sm font-bold text-slate-700">{companyName}</p>}
      <h1 className="text-lg font-black text-slate-900">{title}</h1>
      <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-slate-700">
        {meta.map(([label, value]) => (
          <div key={label} className="flex gap-1">
            <dt className="font-bold">{label}:</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="flex gap-1">
          <dt className="font-bold">تاریخ چاپ:</dt>
          <dd>{toPersianDigits(getTodayJalaliDate())}</dd>
        </div>
      </dl>
    </div>
  );
}
