import { formatPersianPrice } from '../../utils';

/**
 * v10.0.251 (TD-967): the «موجودی نقد و بانک‌ها» card body. Its main number is the rial accounts only and each other
 * currency's balance is listed apart in its own currency, so no amount of another currency is added to rials.
 */
export function CashBankTotals({ total, byCurrency }: { total?: number; byCurrency?: Array<{ currency: string; amount: number }> }) {
  const foreign = (Array.isArray(byCurrency) ? byCurrency : []).filter(t => t.currency !== 'IRR');
  return (
    <>
      <div className="text-xl font-black text-slate-900 dark:text-white">{formatPersianPrice(total || 0)}</div>
      {foreign.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300" data-testid="cash-bank-foreign">
          {foreign.map(t => (
            <li key={t.currency}>{formatPersianPrice(t.amount, t.currency)}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">مجموع صندوق‌ها و حساب‌های بانکی ریالی؛ ارزها جدا</p>
    </>
  );
}
