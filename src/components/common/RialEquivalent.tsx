import { useShownRial } from '../../contexts/RialDisplayContext';
import { rialDisplayAmount, rialDisplayOf, type RialDisplayUnit } from '../../lib/rialDisplay';
import { cn } from '../../utils/formatters';

/** The unit every field that takes a rial amount names in its label («… (ریال)»), whatever the display unit */
export const RIAL_INPUT_UNIT = 'ریال';

/**
 * v11 phase 6.3 (U3, decision ت۵۷): under a field that takes a rial amount, the same amount in the display unit when that
 * is toman («معادل: ۱۲٬۵۰۰ تومان»), so a number typed in rial is read against the toman figures of the lists; nothing
 * while the display unit is rial or the field is empty. Before, a form could read «پاداش (ریال)» above «کسورات (تومان)»
 * and an amount could be typed ten times off. `inline` puts it beside a label instead, for a row of fields aligned at
 * their bottom edge; keep it outside the `<label>` and point the field at it with `aria-describedby` (its `id`), so the
 * field's name does not change as a value is typed. `unit` replaces the app's unit, for the settings form that edits it.
 */
export function RialEquivalent({ value, className, inline = false, id, unit }: {
  value: number | string | null | undefined;
  className?: string;
  inline?: boolean;
  id?: string;
  unit?: RialDisplayUnit;
}) {
  const shown = useShownRial();
  const rial = unit ? rialDisplayOf(unit) : shown;
  if (rial.unit !== 'TOMAN' || rialDisplayAmount(value, 'IRR') === 0) return null;
  return (
    <span
      id={id}
      data-testid="rial-equivalent"
      className={cn(inline ? 'ms-1 font-normal' : 'block mt-1', 'text-[11px] text-slate-500 dark:text-slate-400', className)}
    >
      معادل: <span className="font-bold text-slate-700 dark:text-slate-300">{rial.amount(value)}</span>
    </span>
  );
}
