import { useId } from 'react';
import { normalizeTimeOfDay, timeOfDayLabel } from '../../lib/dailyLogs/workHours';

/**
 * v10.0.79 (TD-1171): a 24-hour time of day typed with Persian or Latin digits and shown with Persian digits. It stores
 * Latin «HH:MM» (the rule of `workHours.ts`), so the form and the server read one format; never `type="time"`, whose
 * display follows the browser's locale («08:30 AM»).
 */
interface TimeOfDayInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function TimeOfDayInput({ label, value, onChange }: TimeOfDayInputProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-0.5">{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        maxLength={5}
        placeholder="۰۸:۳۰"
        value={timeOfDayLabel(value)}
        onChange={(e) => onChange(normalizeTimeOfDay(e.target.value))}
        className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs bg-white text-center font-bold"
        required
      />
    </div>
  );
}
