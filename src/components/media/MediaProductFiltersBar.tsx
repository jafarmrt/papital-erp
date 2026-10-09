import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toPersianDigits } from '../../utils';
import type { MediaProductFilterOptions, MediaProductQuery } from '../../lib/media/mediaApi';

interface Props {
  query: MediaProductQuery;
  options: MediaProductFilterOptions | null;
  onChange: (next: MediaProductQuery) => void;
}

const FLAGS: ReadonlyArray<{ key: 'withoutImages' | 'withoutWhiteBackground' | 'lowQuality'; label: string }> = [
  { key: 'withoutImages', label: 'بی‌تصویر' },
  { key: 'withoutWhiteBackground', label: 'بی عکس پشت‌سفید' },
  { key: 'lowQuality', label: 'کیفیت پایین' },
];

const selectClass = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Bar of search conditions of the product grid; each change goes to the server through the page address */
export function MediaProductFiltersBar({ query, options, onChange }: Props) {
  const [searchText, setSearchText] = useState(query.search);

  useEffect(() => setSearchText(query.search), [query.search]);

  useEffect(() => {
    if (searchText === query.search) return undefined;
    const timer = setTimeout(() => onChange({ ...query, search: searchText, page: 1 }), 400);
    return () => clearTimeout(timer);
  }, [searchText, query, onChange]);

  const set = (patch: Partial<MediaProductQuery>) => onChange({ ...query, ...patch, page: 1 });
  const hasConditions = Boolean(query.search || query.collection || query.designYear || query.transferCode || query.category
    || query.withoutImages || query.withoutWhiteBackground || query.lowQuality);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2" aria-label="پالایش محصولات">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="search"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="جست‌وجوی کد یا نام محصول"
          aria-label="جست‌وجوی کد یا نام محصول"
          className="w-full h-9 rounded-lg border border-slate-200 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <select aria-label="کالکشن" className={selectClass} value={query.collection} onChange={e => set({ collection: e.target.value })}>
        <option value="">همه کالکشن‌ها</option>
        {(options?.collections ?? []).map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="سال طراحی" className={selectClass} value={query.designYear} onChange={e => set({ designYear: e.target.value })}>
        <option value="">همه سال‌ها</option>
        {(options?.designYears ?? []).map(y => <option key={y} value={String(y)}>{toPersianDigits(String(y))}</option>)}
      </select>
      <select aria-label="کد ترنسفر" className={selectClass} value={query.transferCode} onChange={e => set({ transferCode: e.target.value })}>
        <option value="">همه کدهای ترنسفر</option>
        {(options?.transferCodes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select aria-label="دسته‌بندی" className={selectClass} value={query.category} onChange={e => set({ category: e.target.value })}>
        <option value="">همه دسته‌بندی‌ها</option>
        {(options?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      {FLAGS.map(flag => (
        <label key={flag.key} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-2 h-9 rounded-lg border border-slate-200 cursor-pointer">
          <input type="checkbox" checked={query[flag.key]} onChange={e => set({ [flag.key]: e.target.checked })} />
          {flag.label}
        </label>
      ))}
      {hasConditions && (
        <button
          type="button"
          onClick={() => onChange({ ...query, search: '', collection: '', designYear: '', transferCode: '', category: '', withoutImages: false, withoutWhiteBackground: false, lowQuality: false, page: 1 })}
          className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50"
        >
          <X size={14} /> پاک کردن شرط‌ها
        </button>
      )}
    </div>
  );
}
