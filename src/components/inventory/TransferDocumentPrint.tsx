import { DocPrintModal } from '../print/DocPrintModal';
import { formatPersianDate, formatPersianNumber } from '../../utils';
import type { InventoryDocumentDetail } from '../../hooks/inventoryAudit/useInventoryAuditQueries';

/** v9.0.80 (TD-489): نسخه چاپی حواله انتقال بین انبارها (قالب یکدست DocPrintModal) */
export function TransferDocumentPrint({ doc, isOpen, onClose }: { doc: InventoryDocumentDetail; isOpen: boolean; onClose: () => void }) {
  const ref = doc.ref_number || doc.refNumber || '';
  return (
    <DocPrintModal
      isOpen={isOpen}
      onClose={onClose}
      title="حواله انتقال بین انبارها"
      subtitle={`شماره ${ref}`}
      meta={[
        { label: 'شماره حواله', value: ref },
        { label: 'تاریخ انتقال', value: formatPersianDate(doc.date) },
        { label: 'انبار مبدأ', value: doc.sourceLocation || '-' },
        { label: 'انبار مقصد', value: doc.destinationLocation || '-' },
        { label: 'صادرکننده', value: doc.user || '-' },
      ]}
      footerNote={doc.notes || undefined}
    >
      <table className="w-full text-xs text-right border border-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="p-2 border-b">ردیف</th>
            <th className="p-2 border-b">کد کالا</th>
            <th className="p-2 border-b">نام کالا</th>
            <th className="p-2 border-b text-center">مقدار</th>
          </tr>
        </thead>
        <tbody>
          {(doc.items ?? []).map((line, idx) => (
            <tr key={idx} className="border-b border-slate-100">
              <td className="p-2">{formatPersianNumber(idx + 1)}</td>
              <td className="p-2 font-mono">{line.code}</td>
              <td className="p-2">{line.name}</td>
              <td className="p-2 text-center">{formatPersianNumber(Number(line.quantity) || 0)} {line.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DocPrintModal>
  );
}
