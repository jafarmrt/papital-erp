import type { ReactElement } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, CreditCard, Package, RefreshCw, FileText } from 'lucide-react';
import { formatPersianNumber, formatPersianCode, formatPersianPrice, formatCurrencyLabel, formatPersianDate } from '../../../utils';
import {
  amountDecimalsOf, INVOICE_TYPE_BADGES, partyLabelOf, resolveInvoiceRowFigures,
  type InvoiceListDocument, type InvoiceTypeBadgeKind,
} from '../../../lib/invoices/invoiceListDocuments';
import type { InvoiceListActions } from '../../../hooks/invoices/useInvoiceListActions';
import { InvoiceRowSettlementCell } from './InvoiceRowSettlementCell';
import { InvoiceRowNotesCell } from './InvoiceRowNotesCell';
import { InvoiceRowActions } from './InvoiceRowActions';

/** آیکون نشان نوع سند (برچسب و رنگ در INVOICE_TYPE_BADGES) */
const TYPE_BADGE_ICONS: Record<InvoiceTypeBadgeKind, ReactElement> = {
  stock: <Package size={13} className="shrink-0" />,
  receipt: <ArrowDownLeft size={13} className="shrink-0 text-emerald-600" />,
  invoice: <CreditCard size={13} className="shrink-0 text-blue-600" />,
  proforma: <FileText size={13} className="shrink-0 text-amber-600" />,
  remittance: <ArrowUpRight size={13} className="shrink-0 text-purple-600" />,
  return: <RefreshCw size={13} className="shrink-0 text-orange-600" />,
  waste: <AlertCircle size={13} className="shrink-0 text-rose-600" />,
};

/** TD-080 (بخش ۳): یک ردیف جدول لیست اسناد */
export function InvoiceListRow({ doc, actions }: { doc: InvoiceListDocument; actions: InvoiceListActions }) {
  const figures = resolveInvoiceRowFigures(doc);
  const { isReceipt, isInvoice, badgeKind, itemsCount, totalQty, totalDocAmount, isCommercial, settlementStatus, remainingAmt } = figures;
  const badge = INVOICE_TYPE_BADGES[badgeKind];
  const currencyLabel = formatCurrencyLabel(doc.currency);

  return (
    <tr className="hover:bg-blue-50/30 transition-colors">
      {/* Ref Number */}
      <td className="p-3">
        <span className="font-mono font-black text-slate-800 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200 inline-block text-[11px]">
          {formatPersianCode(doc.ref_number)}
        </span>
      </td>

      {/* Doc Type Badge */}
      <td className="p-3 whitespace-nowrap">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] ${badge.bg}`}>
          {TYPE_BADGE_ICONS[badgeKind]}
          <span>{badge.label}</span>
        </div>
      </td>

      {/* Status */}
      <td className="p-3 whitespace-nowrap">
        {doc.status === 'proforma' ? (
          <span className="bg-amber-100 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
            پیش‌فاکتور
          </span>
        ) : doc.status === 'draft' ? (
          <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
            پیش‌نویس
          </span>
        ) : (
          <span className="bg-emerald-100 text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
            <CheckCircle2 size={10} /> نهایی
          </span>
        )}
      </td>

      {/* Date */}
      <td className="p-3 font-mono text-slate-600 font-medium whitespace-nowrap" dir="ltr">
        {formatPersianDate(doc.date)}
      </td>

      {/* Party Name */}
      <td className="p-3">
        {doc.buyer_name ? (
          <div>
            <span className="font-bold text-slate-800 block text-xs">
              {partyLabelOf(doc, figures)}
            </span>
            {(doc.buyer_phone || doc.buyer_city) && (
              <span className="text-[10px] text-slate-500 font-mono">
                {[doc.buyer_city, doc.buyer_phone].filter(Boolean).join(' - ')}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-400 font-medium">-</span>
        )}
      </td>

      {/* Quantity & Items Count */}
      <td className="p-3 text-center whitespace-nowrap">
        <div className="inline-block bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
          <span className="font-bold text-slate-800 block font-mono text-xs">
            {formatPersianNumber(itemsCount)} ردیف
          </span>
          <span className="text-[10px] text-slate-500 block font-mono">
            {formatPersianNumber(totalQty)} واحد
          </span>
        </div>
      </td>

      {/* Total Value / Amount */}
      <td className="p-3 whitespace-nowrap">
        {totalDocAmount > 0 ? (
          <div>
            <strong className={`font-mono text-xs font-black block ${
              isReceipt ? 'text-emerald-800' : isInvoice ? 'text-blue-800' : 'text-slate-800'
            }`}>
              {formatPersianPrice(totalDocAmount, undefined, amountDecimalsOf(doc.currency))}
            </strong>
            <span className="text-[10px] text-slate-500 font-normal">{currencyLabel}</span>
          </div>
        ) : (
          <span className="text-slate-400 font-mono text-[11px]">-</span>
        )}
      </td>

      {/* Settlement Status */}
      <InvoiceRowSettlementCell isCommercial={isCommercial} settlementStatus={settlementStatus} remainingAmt={remainingAmt} currency={doc.currency} />

      {/* Notes (Editable Inline) */}
      <InvoiceRowNotesCell doc={doc} actions={actions} />

      {/* Actions */}
      <InvoiceRowActions doc={doc} isCommercial={isCommercial} settlementStatus={settlementStatus} actions={actions} />
    </tr>
  );
}
