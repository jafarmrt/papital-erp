import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../utils';
import { fetchJson } from '../api';

interface Option {
  value: string | number;
  label: string;
  disabled?: boolean;
  _raw?: any;
}

interface SearchableSelectProps {
  options?: Option[];
  value: string | number;
  onChange: (value: string, raw?: any) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  fetchUrl?: string; // e.g. "/items"
  mapResultToOption?: (item: any) => Option; // Function to convert response to Option
  maxResults?: number;
}

export function SearchableSelect({
  options: propOptions = [],
  value,
  onChange,
  placeholder = 'انتخاب کنید...',
  className,
  disabled,
  fetchUrl,
  mapResultToOption,
  maxResults = 50
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [asyncOptions, setAsyncOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number; showAbove: boolean }>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 280,
    showAbove: false
  });

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;

    const showAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableSpace = showAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(160, Math.min(280, availableSpace));

    let left = rect.left;
    const width = Math.max(rect.width, 240);
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }

    setCoords({
      top: showAbove ? rect.top - 4 : rect.bottom + 4,
      left,
      width,
      maxHeight,
      showAbove
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleScrollOrResize = () => {
        updatePosition();
      };
      window.addEventListener('resize', handleScrollOrResize);
      window.addEventListener('scroll', handleScrollOrResize, true);
      return () => {
        window.removeEventListener('resize', handleScrollOrResize);
        window.removeEventListener('scroll', handleScrollOrResize, true);
      };
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const isInsideWrapper = wrapperRef.current && wrapperRef.current.contains(target);
      const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(target);
      if (!isInsideWrapper && !isInsideDropdown) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!fetchUrl) return;

    const controller = new AbortController();
    const delayDebounceFn = setTimeout(() => {
      setLoading(true);
      const limit = maxResults || 4;
      const url = `${fetchUrl}${fetchUrl.includes('?') ? '&' : '?'}search=${encodeURIComponent(search)}&limit=${limit}`;
      fetchJson(url, { signal: controller.signal })
        .then((res: any) => {
          if (controller.signal.aborted) return;
          const data = res.data || res;
          if (Array.isArray(data) && mapResultToOption) {
            setAsyncOptions(data.slice(0, limit).map((item: any) => {
              const opt = mapResultToOption(item);
              opt._raw = item;
              return opt;
            }));
          }
        })
        .catch(err => {
          if (err?.name === 'AbortError') return;
          console.error('SearchableSelect fetch error:', err);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 300);

    return () => {
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [search, fetchUrl, mapResultToOption, maxResults]);

  const limit = maxResults || 4;

  const normalizeSearch = (str: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
      .trim();
  };

  const filteredPropOptions = React.useMemo(() => {
    if (!search.trim()) {
      return propOptions.slice(0, limit);
    }
    const query = normalizeSearch(search);
    const matches = propOptions.filter(opt => normalizeSearch(opt.label).includes(query));
    
    matches.sort((a, b) => {
      const aLabel = normalizeSearch(a.label);
      const bLabel = normalizeSearch(b.label);
      const aStarts = aLabel.startsWith(query);
      const bStarts = bLabel.startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return 0;
    });

    return matches.slice(0, limit);
  }, [propOptions, search, limit]);

  const safeStr = (v: any): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return String(v);
    } catch {
      return '';
    }
  };

  const displayOptions = fetchUrl ? asyncOptions : filteredPropOptions;
  const valStr = safeStr(value);
  const foundOpt = propOptions.find(o => safeStr(o?.value) === valStr);
  const currentLabel = foundOpt ? foundOpt.label : (valStr ? selectedLabel : placeholder);

  return (
    <div className={cn("relative", className)} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full bg-white border border-slate-200 rounded-xl shadow-2xs text-xs px-3 py-2 flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-800",
          disabled && "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200",
          className
        )}
      >
        <span className="truncate text-right font-medium">{currentLabel}</span>
        <ChevronDown size={15} className="text-slate-400 shrink-0 mr-1.5" />
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[99999] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden text-slate-800"
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            transform: coords.showAbove ? 'translateY(-100%)' : 'none',
          }}
        >
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/90">
            <Search size={14} className="text-slate-400 shrink-0 mr-1" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجو..."
              className="w-full bg-transparent text-xs font-bold text-slate-800 focus:outline-none"
            />
            {loading && <Loader2 size={14} className="text-blue-500 animate-spin shrink-0 ml-1" />}
          </div>
          <ul className="overflow-auto py-1 text-xs" style={{ maxHeight: `${Math.max(100, coords.maxHeight - 45)}px` }}>
            <li
              className="px-3 py-2 text-slate-500 hover:bg-slate-100 cursor-pointer font-medium"
              onClick={() => {
                onChange('');
                setSelectedLabel('');
                setIsOpen(false);
                setSearch('');
              }}
            >
              -- {placeholder} --
            </li>
            {displayOptions.length > 0 ? (
              displayOptions.map((opt, index) => (
                <li
                  key={`${opt.value ?? ''}-${index}`}
                  className={cn(
                    "px-3 py-2 cursor-pointer transition-colors leading-relaxed",
                    opt.disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : "hover:bg-blue-50 text-slate-700",
                    valStr === safeStr(opt.value) && "bg-blue-100/80 text-blue-900 font-bold"
                  )}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(String(opt.value), opt._raw);
                    setSelectedLabel(opt.label);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  {opt.label}
                </li>
              ))
            ) : (
              <li className="px-3 py-3 text-slate-400 text-center font-medium">
                {loading ? 'در حال جستجو...' : 'موردی یافت نشد'}
              </li>
            )}
            {displayOptions.length > 0 && propOptions.length > limit && (
              <li className="px-3 py-1.5 text-[10px] font-medium text-slate-400 bg-slate-50 border-t border-slate-100 text-center select-none">
                برای مشاهده موارد بیشتر عبارت مورد نظر را جستجو کنید
              </li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
