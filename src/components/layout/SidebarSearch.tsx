import React from 'react';
import { Search, X } from 'lucide-react';

interface SidebarSearchProps {
  query: string;
  onQueryChange: (q: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  totalResultsCount: number;
}

export const SidebarSearch: React.FC<SidebarSearchProps> = ({
  query,
  onQueryChange,
  inputRef,
  totalResultsCount
}) => {
  return (
    <div className="relative mb-2">
      <div className="relative flex items-center">
        <input
          ref={inputRef as any}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="جستجوی منو... (Ctrl+K)"
          className="w-full bg-slate-800/90 text-slate-100 placeholder:text-slate-500 text-[11px] rounded-xl pl-7 pr-7 py-1.5 border border-slate-750 focus:border-blue-500 focus:bg-slate-800 focus:outline-none transition-all shadow-inner"
        />
        <Search
          size={13}
          className="absolute right-2 text-slate-500 pointer-events-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute left-2 text-slate-400 hover:text-white p-0.5 rounded cursor-pointer transition-colors"
            title="پاک کردن جستجو"
          >
            <X size={13} />
          </button>
        ) : (
          <kbd className="absolute left-2 hidden xl:inline-flex items-center gap-0.5 px-1 py-0.2 text-[9px] font-mono text-slate-500 bg-slate-900/80 rounded border border-slate-700/60 pointer-events-none">
            Ctrl+K
          </kbd>
        )}
      </div>

      {query.trim() && (
        <div className="flex items-center justify-between px-1 mt-1 text-[10px] text-slate-400">
          <span>نتایج جستجو:</span>
          <span className="font-bold text-blue-400">
            {totalResultsCount} مورد
          </span>
        </div>
      )}
    </div>
  );
};

export default SidebarSearch;
