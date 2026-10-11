import React from 'react';
import { formatPersianDate } from '../../../utils/dateUtils';
import { toPersianDigits } from '../../../utils/persianNumber';
import {
  PARTY_TEMPORARY_ROWS_NOTE, PARTY_TEMPORARY_ROWS_TITLE, type PartyTemporaryRows,
} from '../../../lib/accounting/partyTemporaryRows';

interface PartyTemporaryRowsPanelProps {
  rows: PartyTemporaryRows | null | undefined;
  /** قالب مبلغ همان گزارش (یکای نمایش ریال یا ارز گزارش) */
  formatAmount: (value: number) => string;
}

/**
 * v10.0.257 (TD-915 / TD-924، تصمیم ت۵ الف): ردیف‌های حساب موقت طرف حساب (درآمد، هزینه، بهای تمام‌شده) زیر صورت‌حساب و
 * کارت حساب، جدا از ردیف‌های مانده؛ در مانده و جمع گردش بالا شمرده نمی‌شوند.
 */
export const PartyTemporaryRowsPanel: React.FC<PartyTemporaryRowsPanelProps> = ({ rows, formatAmount }) => {
  const items = Array.isArray(rows?.items) ? rows.items : [];
  if (items.length === 0) return null;
  return (
    <section className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden" data-testid="party-temporary-rows">
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">{PARTY_TEMPORARY_ROWS_TITLE}</h4>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{PARTY_TEMPORARY_ROWS_NOTE}</p>
      </div>
      <table className="w-full text-xs text-right">
        <thead className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-bold">
          <tr>
            <th className="p-2 w-24 text-center">تاریخ</th>
            <th className="p-2 w-20 text-center">سند</th>
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
            <td className="p-2" colSpan={4}>جمع ردیف‌های موقت</td>
            <td className="p-2 text-left">{formatAmount(rows?.totalDebit ?? 0)}</td>
            <td className="p-2 text-left">{formatAmount(rows?.totalCredit ?? 0)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
};
