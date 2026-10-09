import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { MEDIA_SHOT_TYPES, MEDIA_SHOT_TYPE_LABELS, type MediaShotType } from '../../lib/media/mediaRules';
import { EMPTY_SECTION_QUERY, hasSectionConditions, type MediaSectionQuery } from '../../lib/media/mediaSectionsApi';

interface Props {
  query: MediaSectionQuery;
  tags: string[];
  onChange: (next: MediaSectionQuery) => void;
}

export const SECTION_SEARCH_LABEL = 'جست‌وجوی عنوان، توضیح یا برچسب';

const selectClass = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

/** v10.0.27 (N-05 PR 3): search conditions of a custom section's files; each change goes to the server through the page address */
export function MediaSectionFiltersBar({ query, tags, onChange }: Props) {
  const [searchText, setSearchText] = useState(query.search);

  useEffect(() => setSearchText(query.search), [query.search]);

  useEffect(() => {
    if (searchText === query.search) return undefined;
    const timer = setTimeout(() => onChange({ ...query, search: searchText, page: 1 }), 400);
    return () => clearTimeout(timer);
  }, [searchText, query, onChange]);

  const set = (patch: Partial<MediaSectionQuery>) => onChange({ ...query, ...patch, page: 1 });
  const tagOptions = query.tag && !tags.some(t => t.toLowerCase() === query.tag.toLowerCase()) ? [query.tag, ...tags] : tags;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2" aria-label="پالایش فایل‌های بخش">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="search"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder={SECTION_SEARCH_LABEL}
          aria-label={SECTION_SEARCH_LABEL}
          className="w-full h-9 rounded-lg border border-slate-200 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <select aria-label="برچسب" className={selectClass} value={query.tag} onChange={e => set({ tag: e.target.value })}>
        <option value="">همه برچسب‌ها</option>
        {tagOptions.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select aria-label="نوع فایل" className={selectClass} value={query.kind} onChange={e => set({ kind: e.target.value as MediaSectionQuery['kind'] })}>
        <option value="">تصویر و فیلم</option>
        <option value="image">فقط تصویر</option>
        <option value="video">فقط فیلم</option>
      </select>
      <select aria-label="نوع نما" className={selectClass} value={query.shotType} onChange={e => set({ shotType: e.target.value as '' | MediaShotType })}>
        <option value="">همه نماها</option>
        {MEDIA_SHOT_TYPES.map(t => <option key={t} value={t}>{MEDIA_SHOT_TYPE_LABELS[t]}</option>)}
      </select>
      <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-2 h-9 rounded-lg border border-slate-200 cursor-pointer">
        <input type="checkbox" checked={query.lowQuality} onChange={e => set({ lowQuality: e.target.checked })} />
        کیفیت پایین
      </label>
      {hasSectionConditions(query) && (
        <button type="button" onClick={() => onChange(EMPTY_SECTION_QUERY)} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50">
          <X size={14} /> پاک کردن شرط‌ها
        </button>
      )}
    </div>
  );
}
