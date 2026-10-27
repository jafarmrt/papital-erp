import { useShownRial } from '../../contexts/RialDisplayContext';
import { rialDisplayAmount } from '../../lib/rialDisplay';
import { cn } from '../../utils/formatters';

/** The unit every field that takes a rial amount names in its label («… (ریال)»), whatever the display unit */
export const RIAL_INPUT_UNIT = 'ریال';

/**
 * v11 phase 6.3 (U3, decision ت۵۷): under a field that takes a rial amount, the same amount in the display unit when that
 * is toman («معادل: ۱۲٬۵۰۰ تومان»), so a number typed in rial is read against the toman figures of the lists; nothing
 * while the display unit is rial or the field is empty. Before, a form could read «پاداش (ریال)» above «کسورات (تومان)»
 * and an amount could be typed ten times off. `inline` puts it beside a label instead, for a row of fields aligned at
 * their bottom edge.
 */
export function RialEquivalent({ value, className, inline = false }: {
  value: number | string | null | undefined;
  className?: string;
  inline?: boolean;
}) {
  const rial = useShownRial();
  if (rial.unit !== 'TOMAN' || rialDisplayAmount(value, 'IRR') === 0) return null;
  return (
    <span
      data-testid="rial-equivalent"
      className={cn(inline ? 'ms-1 font-normal' : 'block mt-1', 'text-[11px] text-slate-500 dark:text-slate-400', className)}
    >
      معادل: <span className="font-bold text-slate-700 dark:text-slate-300">{rial.amount(value)}</span>
    </span>
  );
}
