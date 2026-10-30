import { useId, useState } from 'react';
import { normalizeTimeOfDay, timeOfDayLabel, timeOfDayReading } from '../../lib/dailyLogs/workHours';

/**
 * v10.0.79 (TD-1171): a 24-hour time of day typed with Persian or Latin digits and shown with Persian digits. It stores
 * Latin «HH:MM» (the rule of `workHours.ts`), so the form and the server read one format; never `type="time"`, whose
 * display follows the browser's locale («08:30 AM»).
 * v11 (owner request 8 Aban 1405): digits alone are a time («۸۳۰» → ۰۸:۳۰), so the phone's number pad is enough. While
 * the box has focus it keeps what was typed; on leaving it shows the stored time, and the time in words sits under it
 * («۲ بعدازظهر»).
 */
interface TimeOfDayInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function TimeOfDayInput({ label, value, onChange }: TimeOfDayInputProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const reading = timeOfDayReading(value);
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-0.5">{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        maxLength={5}
        placeholder="۸۳۰"
        value={draft ?? timeOfDayLabel(value)}
        onFocus={(e) => { setDraft(timeOfDayLabel(value)); e.currentTarget.select(); }}
        onChange={(e) => { setDraft(e.target.value); onChange(normalizeTimeOfDay(e.target.value)); }}
        onBlur={() => setDraft(null)}
        aria-describedby={reading ? `${id}-reading` : undefined}
        className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs bg-white text-center font-bold"
        required
      />
      {reading && <p id={`${id}-reading`} className="mt-0.5 text-[10px] text-slate-500 text-center">{reading}</p>}
    </div>
  );
}
