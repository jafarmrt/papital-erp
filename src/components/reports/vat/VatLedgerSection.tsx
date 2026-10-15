import { CheckCircle2, Info, Scale } from 'lucide-react';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import {
  VAT_DIFFERENCE_KIND_LABELS, VAT_LEDGER_SOURCES, VAT_LEDGER_SOURCE_LABELS, vatDay, vatDocumentTitle, vatVoucherList,
  type VatComparison, type VatLedger, type VatLedgerFigure, type VatReport,
} from '../../../lib/reports/vatReport';
import { fin } from '../../../lib/financialDecimal';
import { formatPersianNumber, toPersianDigits } from '../../../utils';

/**
 * v10.1.13 (D-03، طرح گزارش‌های مدیریتی §۴): بخش ۲ «مالیات بر ارزش افزوده»، از دفتر کل: مانده اول دوره، بستانکار و
 * بدهکار دوره به تفکیک منبع و مانده پایان دوره، هر یک با سهم سندهای پیش‌نویس؛ و هم‌خوانی با بخش ۱ با فهرست سندهایی که
 * تفاوت را می‌سازند (بزرگ‌ترین‌ها نخست). همه مبلغ‌ها از کارساز می‌آیند.
 */

const TH = 'px-3 py-2 text-[11px] font-black text-slate-600 dark:text-slate-300 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 whitespace-nowrap';
const PANEL = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden';

const isZero = (value: string) => fin(value).abs().lessThan(0.01);

function FigureRow({ label, figure, money, strong }: { label: string; figure: VatLedgerFigure; money: ReportMoney; strong?: boolean }) {
  return (
    <tr>
      <td className={`${TD} font-sans ${strong ? 'font-black' : 'font-bold'}`}>{label}</td>
      <td className={`${TD} ${strong ? 'font-black' : ''}`}>{money.format(figure.total)}</td>
      <td className={`${TD} text-amber-700 dark:text-amber-300`}>{isZero(figure.draft) ? '—' : money.format(figure.draft)}</td>
    </tr>
  );
}

function LedgerFigures({ ledger, money }: { ledger: VatLedger; money: ReportMoney }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className={PANEL}>
        <table className="w-full text-right" data-testid="vat-ledger-figures">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className={TH}>شرح</th>
              <th className={TH}>مبلغ ({money.label})</th>
              <th className={TH}>از سندهای پیش‌نویس</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            <FigureRow label="مانده اول دوره (بستانکار)" figure={ledger.opening} money={money} />
            <FigureRow label="بستانکار دوره" figure={ledger.credit} money={money} />
            <FigureRow label="بدهکار دوره" figure={ledger.debit} money={money} />
            <FigureRow label="مانده پایان دوره (بستانکار)" figure={ledger.closing} money={money} strong />
          </tbody>
        </table>
      </div>
      <div className={PANEL}>
        <table className="w-full text-right" data-testid="vat-ledger-sources">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className={TH}>منبع ردیف‌های دوره</th>
              <th className={TH}>بستانکار ({money.label})</th>
              <th className={TH}>بدهکار</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {VAT_LEDGER_SOURCES.map(s => (
              <tr key={s} data-testid={`vat-source-${s}`}>
                <td className={`${TD} font-sans font-bold`}>{VAT_LEDGER_SOURCE_LABELS[s]}</td>
                <td className={TD}>{money.format(ledger.bySource[s].credit)}</td>
                <td className={TD}>{money.format(ledger.bySource[s].debit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonLine({ comparison, money }: { comparison: VatComparison; money: ReportMoney }) {
  const matched = isZero(comparison.difference);
  const tone = matched
    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200'
    : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200';
  return (
    <div className={`rounded-xl border px-4 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 ${tone}`} data-testid="vat-comparison">
      {matched ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden /> : <Scale className="w-4 h-4 shrink-0" aria-hidden />}
      <span>خالص مالیات بخش ۱: <b className="font-mono">{money.format(comparison.documentsNet)}</b></span>
      <span>گردش خالص دفتر (بستانکار منهای بدهکار): <b className="font-mono">{money.format(comparison.ledgerNet)}</b></span>
      <span className="font-black">
        {matched ? 'دفتر با سندها هم‌خوان است.' : <>تفاوت (دفتر منهای سندها): <span className="font-mono">{money.format(comparison.difference)}</span></>}
      </span>
    </div>
  );
}

function DifferenceTable({ comparison, money }: { comparison: VatComparison; money: ReportMoney }) {
  if (comparison.rows.length === 0) return null;
  return (
    <div className={PANEL}>
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-black text-slate-800 dark:text-slate-100">سندهای سازنده تفاوت</h4>
        {comparison.rowCount > comparison.rows.length && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {formatPersianNumber(comparison.rows.length)} تفاوت بزرگ‌تر از {formatPersianNumber(comparison.rowCount)}؛ همه در خروجی اکسل
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right" data-testid="vat-differences">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className={TH}>علت</th>
              <th className={TH}>سند</th>
              <th className={TH}>تاریخ سند</th>
              <th className={TH}>سند حسابداری</th>
              <th className={TH}>مالیات سند ({money.label})</th>
              <th className={TH}>دفتر</th>
              <th className={TH}>تفاوت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {comparison.rows.map(r => (
              <tr key={r.key} data-testid={`vat-difference-${r.kind}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/40">
                <td className={`${TD} font-sans font-bold whitespace-normal min-w-[12rem]`}>{VAT_DIFFERENCE_KIND_LABELS[r.kind]}</td>
                <td className={`${TD} font-sans`}>{r.document ? vatDocumentTitle(r.document.kind, r.document.refNumber) : '—'}</td>
                <td className={TD}>{r.document?.date ? vatDay(r.document.date) : '—'}</td>
                <td className={`${TD} font-sans`}>{r.vouchers.length > 0 ? vatVoucherList(r.vouchers) : '—'}</td>
                <td className={TD}>{money.format(r.expected)}</td>
                <td className={TD}>{money.format(r.ledger)}</td>
                <td className={`${TD} font-black text-rose-700 dark:text-rose-300`}>{money.format(r.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VatLedgerSection({ report, money }: { report: VatReport; money: ReportMoney }) {
  const { ledger, comparison } = report;
  return (
    <section className="space-y-3" aria-labelledby="vat-part-ledger">
      <h3 id="vat-part-ledger" className="text-sm font-black text-slate-800 dark:text-slate-100">
        بخش ۲: از دفتر کل
        {ledger && (
          <span className="mr-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            {ledger.account.name} ({toPersianDigits(ledger.account.code)})
          </span>
        )}
      </h3>
      {!ledger ? (
        <p className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2 border border-amber-200 dark:border-amber-800" role="note" data-testid="vat-ledger-missing">
          <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
          حساب «مالیات بر ارزش افزوده» در نگاشت حساب‌ها پیدا نشد؛ بخش دفتر کل و هم‌خوانی ساخته نمی‌شود.
        </p>
      ) : (
        <>
          <LedgerFigures ledger={ledger} money={money} />
          {comparison && <ComparisonLine comparison={comparison} money={money} />}
          {comparison && <DifferenceTable comparison={comparison} money={money} />}
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            سندهای حسابداری پیش‌نویس هم شمرده می‌شوند و سهمشان جدا نشان داده می‌شود؛ اسناد بستن سال و افتتاحیه پس از آن در گردش دوره نمی‌آیند.
          </p>
        </>
      )}
    </section>
  );
}
