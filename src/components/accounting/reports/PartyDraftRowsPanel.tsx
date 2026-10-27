import React from 'react';
import { FileClock } from 'lucide-react';
import { formatPersianDate } from '../../../utils/dateUtils';
import { toPersianDigits } from '../../../utils/persianNumber';
import {
  PARTY_BALANCE_WITH_DRAFTS_LABEL, PARTY_DRAFT_ROWS_NOTE, PARTY_DRAFT_ROWS_TITLE, partyBalanceSide, type PartyDraftRows,
} from '../../../lib/accounting/partyDraftRows';

interface PartyDraftRowsPanelProps {
  rows: PartyDraftRows | null | undefined;
  /** the report's amount format (the rial display unit or the report currency) */
  formatAmount: (value: number) => string;
}

/**
 * v11 phase 6.1t (U1): the party's rows of draft vouchers on its card and statement, apart from the approved rows and
 * clearly labelled, with the balance they would make. Automatic vouchers stay drafts until approved, so without this the
 * card showed no debt, or a debt the wrong way, while the invoice's voucher waited.
 */
export const PartyDraftRowsPanel: React.FC<PartyDraftRowsPanelProps> = ({ rows, formatAmount }) => {
  const items = Array.isArray(rows?.items) ? rows.items : [];
  if (!rows || items.length === 0) return null;
  const balance = rows.balanceWithDrafts;
  return (
    <section className="border border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden" data-testid="party-draft-rows">
      <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <FileClock size={14} />
            {PARTY_DRAFT_ROWS_TITLE} ({toPersianDigits(rows.voucherCount)} سند)
          </h4>
          <p className="text-[11px] text-amber-700/90 dark:text-amber-300/80 mt-0.5">{PARTY_DRAFT_ROWS_NOTE}</p>
        </div>
        <div className="text-left">
          <span className="block text-[11px] font-bold text-amber-800 dark:text-amber-300">{PARTY_BALANCE_WITH_DRAFTS_LABEL}</span>
          <span className="text-sm font-black font-mono text-slate-900 dark:text-white">
            {formatAmount(Math.abs(balance))} {balance === 0 ? '' : `(${partyBalanceSide(balance)})`}
          </span>
        </div>
      </div>
      <table className="w-full text-xs text-right">
        <thead className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-bold">
          <tr>
            <th className="p-2 w-24 text-center">تاریخ</th>
            <th className="p-2 w-20 text-center">سند پیش‌نویس</th>
            <th className="p-2">حساب</th>
            <th className="p-2">شرح</th>
            <th className="p-2 text-left w-28">بدهکار</th>
            <th className="p-2 text-left w-28">بستانکار</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((row, i) => (
            <tr key={`${row.voucherId}-${i}`}>
              <td className="p-2 text-center">{formatPersianDate(row.date)}</td>
              <td className="p-2 text-center">{toPersianDigits(row.voucherNumber)}</td>
              <td className="p-2">{toPersianDigits(row.accountCode)} — {row.accountName}</td>
              <td className="p-2">{row.description}</td>
              <td className="p-2 text-left">{row.debit > 0 ? formatAmount(row.debit) : '—'}</td>
              <td className="p-2 text-left">{row.credit > 0 ? formatAmount(row.credit) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="font-bold border-t border-slate-200 dark:border-slate-700">
          <tr>
            <td className="p-2" colSpan={4}>جمع ردیف‌های پیش‌نویس</td>
            <td className="p-2 text-left">{formatAmount(rows.totalDebit)}</td>
            <td className="p-2 text-left">{formatAmount(rows.totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
};
