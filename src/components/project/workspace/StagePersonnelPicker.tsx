import { X } from 'lucide-react';
import type { Personnel } from '../../../types';
import { personnelDisplayName } from '../../../lib/documents/stockDocumentParties';
import { isRecipientCandidate } from '../../../lib/workshop/recipient';

interface StagePersonnelPickerProps {
  id: string;
  value: string[];
  personnel: readonly Personnel[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

/** the names a stage may add: personnel still working here, by their display name, not already on the stage */
export function stagePersonnelChoices(personnel: readonly Personnel[], selected: readonly string[]): string[] {
  const taken = new Set(selected.map(name => name.trim()));
  const names = new Set<string>();
  for (const person of personnel) {
    if (!isRecipientCandidate(person)) continue;
    const name = personnelDisplayName(person).trim();
    if (name && !taken.has(name)) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'fa'));
}

/**
 * v10.2.x (10.2 package 2, review U18): a stage's responsible personnel are picked from the personnel list instead of
 * typed as text with commas, so a name is never misspelt or split by a «،». A name stored earlier that is not on the
 * list stays on the stage until it is removed.
 */
export function StagePersonnelPicker({ id, value, personnel, onChange, disabled }: StagePersonnelPickerProps) {
  const choices = stagePersonnelChoices(personnel, value);
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="پرسنل این مرحله">
          {value.map(name => (
            <li key={name} className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg ps-2 pe-1 py-0.5 text-[11px] font-bold">
              <span>{name}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter(n => n !== name))}
                aria-label={`برداشتن ${name}`}
                className="p-0.5 rounded hover:bg-blue-100 text-blue-700 cursor-pointer disabled:opacity-50"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        id={id}
        value=""
        disabled={disabled || choices.length === 0}
        onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}
        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white disabled:bg-slate-100"
      >
        <option value="">{choices.length === 0 ? 'پرسنل دیگری در فهرست نیست' : 'افزودن از فهرست پرسنل'}</option>
        {choices.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>
  );
}
