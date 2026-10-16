import React, { useMemo } from 'react';
import { Receipt } from 'lucide-react';
import { Modal } from '../../common/Modal';
import { rialDisplayOf } from '../../../lib/rialDisplay';
import { errorMessageOf, formatPersianCode, formatPersianNumber } from '../../../utils';
import { usePettyCashLinesQuery } from '../../../hooks/accounting/usePettyCashQueries';
import type { TreasuryTransaction } from '../../../types';

interface PettyCashLinesModalProps {
  transaction: TreasuryTransaction | null;
  appCurrency: string;
  onClose: () => void;
}

/** v10.1.32 (D-16): ردیف‌های یک صورت‌هزینه ثبت‌شده تنخواه، فقط خواندنی */
export const PettyCashLinesModal: React.FC<PettyCashLinesModalProps> = ({ transaction, appCurrency, onClose }) => {
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const linesQuery = usePettyCashLinesQuery(transaction ? transaction.id : null);
  if (!transaction) return null;
  const lines = Array.isArray(linesQuery.data) ? linesQuery.data : [];
  const empty = '—';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="ردیف‌های صورت‌هزینه تنخواه"
      subtitle={`${transaction.bankAccountTitle || ''} — شماره ${formatPersianCode(transaction.transactionNumber)}`}
      icon={<Receipt className="w-5 h-5 text-amber-600" />}
      size="3xl"
    >
      {linesQuery.isLoading && <p className="text-xs text-slate-500">در حال بارگذاری ردیف‌ها...</p>}
      {linesQuery.isError && (
        <p role="alert" className="text-xs font-bold text-rose-600">{errorMessageOf(linesQuery.error)}</p>
      )}
      {!linesQuery.isLoading && !linesQuery.isError && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
              <tr>
                <th className="p-2">ردیف</th>
                <th className="p-2">حساب هزینه</th>
                <th className="p-2">مبلغ</th>
                <th className="p-2">مالیات بر ارزش افزوده</th>
                <th className="p-2">شرح</th>
                <th className="p-2">فروشنده</th>
                <th className="p-2">شماره فاکتور</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {lines.map(line => (
                <tr key={line.lineNo}>
                  <td className="p-2">{formatPersianNumber(line.lineNo)}</td>
                  <td className="p-2">{formatPersianCode(line.accountCode)} — {line.accountName}</td>
                  <td className="p-2 font-bold">{rial.amount(line.amount)}</td>
                  <td className="p-2">{line.vatAmount > 0 ? rial.amount(line.vatAmount) : empty}</td>
                  <td className="p-2">{line.description || empty}</td>
                  <td className="p-2">{line.sellerName || empty}</td>
                  <td className="p-2">{line.invoiceNumber ? formatPersianCode(line.invoiceNumber) : empty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
};
