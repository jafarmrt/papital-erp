import { Settings2 } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import type { MediaSection } from '../../lib/media/mediaSectionsApi';

export const MANAGE_SECTIONS_TEXT = 'مدیریت بخش‌ها';

interface Props {
  sections: MediaSection[];
  activeId: number | null;
  canManage: boolean;
  onSelect: (section: MediaSection) => void;
  onManage: () => void;
}

/** v10.0.27 (N-05 PR 3): the sections of the library as chips with their file counts, and the manager's button */
export function MediaSectionTabs({ sections, activeId, canManage, onSelect, onManage }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="بخش‌های کتابخانه">
      {sections.map(section => {
        const active = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(section)}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold border ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            {section.title}
            <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{formatPersianNumber(section.assetCount)}</span>
          </button>
        );
      })}
      {canManage && (
        <button type="button" onClick={onManage} className="inline-flex items-center gap-1 h-9 px-3 rounded-full text-xs font-bold text-blue-600 hover:bg-blue-50">
          <Settings2 size={14} /> {MANAGE_SECTIONS_TEXT}
        </button>
      )}
    </div>
  );
}
