import React from 'react';
import { Check, Tag } from 'lucide-react';
import { tagColorClass, type CustomerTag } from '../../lib/customers/customerTags';
import { formatPersianNumber } from '../../utils';

/**
 * v10.1.23 (N-02 بخش ۳): نشان‌ها، پالایه و گزینش برچسب طرف حساب. برچسب‌ها از `GET /customers/tags` می‌آیند و هر طرف
 * حساب در فهرست برچسب‌های خودش را دارد (`tags`).
 */
export function CustomerTagChips({ tags }: { tags: ReadonlyArray<{ id: number; name: string; color: string }> | undefined }): React.ReactElement | null {
  if (!tags || tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1 mt-1" aria-label="برچسب‌ها">
      {tags.map((t) => (
        <li key={t.id} data-customer-tag={t.id} className={`px-1.5 py-0.5 rounded-md border text-[11px] font-bold ${tagColorClass(t.color)}`}>
          {t.name}
        </li>
      ))}
    </ul>
  );
}

interface CustomerTagFilterProps {
  tags: ReadonlyArray<CustomerTag & { customerCount?: number }>;
  /** شناسه برچسب برگزیده، یا null برای همه */
  value: number | null;
  onChange: (tagId: number | null) => void;
  id?: string;
  className?: string;
}

/** پالایه «برچسب»؛ بی برچسب تعریف‌شده چیزی نشان نمی‌دهد */
export function CustomerTagFilter({ tags, value, onChange, id = 'customer-tag-filter', className = '' }: CustomerTagFilterProps): React.ReactElement | null {
  if (tags.length === 0) return null;
  return (
    <label htmlFor={id} className={`flex items-center gap-1.5 text-xs text-slate-600 ${className}`}>
      <Tag size={14} className="text-slate-500 shrink-0" />
      <span className="sr-only">برچسب</span>
      <select
        id={id}
        aria-label="برچسب"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
      >
        <option value="">همه برچسب‌ها</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.customerCount === undefined ? t.name : `${t.name} (${formatPersianNumber(t.customerCount)})`}
          </option>
        ))}
      </select>
    </label>
  );
}

interface CustomerTagPickerProps {
  tags: ReadonlyArray<CustomerTag>;
  selected: ReadonlyArray<number>;
  onChange: (tagIds: number[]) => void;
}

/** گزینش چند برچسب در فرم طرف حساب */
export function CustomerTagPicker({ tags, selected, onChange }: CustomerTagPickerProps): React.ReactElement {
  const chosen = new Set(selected);
  const toggle = (id: number) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="space-y-2 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
      <h4 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
        <Tag size={14} className="text-blue-600" />
        برچسب‌ها
      </h4>
      {tags.length === 0 ? (
        <p className="text-[11px] text-slate-500">برچسبی تعریف نشده است؛ از دکمه «برچسب‌ها» در بالای فهرست طرف حساب‌ها بسازید.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="برچسب‌های طرف حساب">
          {tags.map((t) => {
            const on = chosen.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t.id)}
                className={`px-2 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-opacity ${tagColorClass(t.color)} ${on ? 'ring-2 ring-blue-400' : 'opacity-60 hover:opacity-100'}`}
              >
                {on && <Check size={12} />}
                {t.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
