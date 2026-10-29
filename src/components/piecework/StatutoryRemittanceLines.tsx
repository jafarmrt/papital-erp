import { useId } from 'react';
import { DecimalInput } from '../common/DecimalInput';
import { RialEquivalent } from '../common/RialEquivalent';
import { toPersianDigits } from '../../utils/persianNumber';
import type { RialDisplay } from '../../lib/rialDisplay';
import type { StatutoryRemittanceDraftLine } from '../../lib/treasury/statutoryRemittance';

interface Props {
  lines: StatutoryRemittanceDraftLine[];
  rial: RialDisplay;
  disabled: boolean;
  onChange: (personnelId: number, change: Partial<StatutoryRemittanceDraftLine>) => void;
}

/**
 * v10.1.36 (TD-1243، ت۳۳ الف): ردیف‌های پنجره «پرداخت به تأمین اجتماعی» / «پرداخت به امور مالیاتی»: هر نفر با مبلغ این
 * ماه، پرداخت‌شده پیشین همین ماه، مانده او و مبلغی که کاربر برمی‌دارد یا کم می‌کند (نه بیش از مانده؛ کارساز هم می‌سنجد).
 */
export function StatutoryRemittanceLines({ lines, rial, disabled, onChange }: Props) {
  const baseId = useId();
  const cell = 'px-2 py-2 text-xs font-bold text-slate-700 dark:text-slate-200';
  return (
    <table className="w-full text-right border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <thead className="bg-slate-50 dark:bg-slate-800">
        <tr>
          {['پرداخت شود', 'مبلغ این ماه', 'پرداخت‌شده پیشین', 'مانده نفر', 'مبلغ پرداخت'].map(h => <th key={h} className={`${cell} font-black`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {lines.map(line => {
          const checkId = `${baseId}-include-${line.personnelId}`;
          const amountId = `${baseId}-amount-${line.personnelId}`;
          return (
            <tr key={line.personnelId} className="border-t border-slate-100 dark:border-slate-700">
              <td className={cell}>
                <label htmlFor={checkId} className="flex items-center gap-2 cursor-pointer">
                  <input id={checkId} type="checkbox" checked={line.include} disabled={disabled}
                    onChange={e => onChange(line.personnelId, { include: e.target.checked })} />
                  <span>{line.fullName}{line.personnelCode ? ` (${toPersianDigits(line.personnelCode)})` : ''}</span>
                </label>
              </td>
              <td className={`${cell} font-mono`}>{rial.amount(Number(line.monthAmount))}</td>
              <td className={`${cell} font-mono`}>{rial.amount(Number(line.remitted))}</td>
              <td className={`${cell} font-mono`}>{rial.amount(Number(line.balance))}</td>
              <td className={cell}>
                <label htmlFor={amountId} className="sr-only">{`مبلغ پرداخت ${line.fullName} (ریال)`}</label>
                <DecimalInput id={amountId} value={line.amount} min={0} disabled={disabled || !line.include}
                  onValueChange={text => onChange(line.personnelId, { amount: text })}
                  className="w-32 px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50" />
                <RialEquivalent value={line.amount} className="mt-0.5" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
