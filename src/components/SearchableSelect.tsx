import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../utils';
import { fetchJson } from '../api';
import { useClickOutside } from '../hooks/useClickOutside';
import { normalizeSearchText } from '../lib/search/searchText';
import { usePickListKeys } from '../hooks/usePickListKeys';
import { useDropdownPosition } from '../hooks/useDropdownPosition';

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
  /** v9.0.309 (TD-680): برچسب مقدار ازپیش‌انتخاب‌شده‌ای که هنوز در نتایج `fetchUrl` نیامده است (مثلاً نام خریدار) */
  valueLabel?: string;
  /** Id of the opening button, so a `<label htmlFor>` names it; the chosen value is its description (v10.1.31, TD-1278). */
  id?: string;
}

/**
 * v9.0.309 (TD-680، B16-16): نشانی جست‌وجوی فهرست انتخاب؛ `search` و `limit` جایگزین همان پارامترهای `fetchUrl` می‌شوند،
 * نه افزوده (پیش‌تر `/customers?limit=1000&search=&limit=50` ساخته می‌شد و سرور ۱٬۰۰۰ ردیف می‌خواند).
 */
export function pickListRequestUrl(fetchUrl: string, search: string, limit: number): string {
  const [path, query = ''] = fetchUrl.split('?');
  const params = new URLSearchParams(query);
  params.set('search', search);
  params.set('limit', String(limit));
  return `${path}?${params.toString()}`;
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
  maxResults = 50,
  valueLabel,
  id
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [asyncResults, setAsyncResults] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<{ value: string; label: string } | null>(null);
  
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const coords = useDropdownPosition(buttonRef, isOpen);

  useClickOutside([wrapperRef, dropdownRef], () => setIsOpen(false));

  useEffect(() => {
    if (!fetchUrl) return;

    const controller = new AbortController();
    const delayDebounceFn = setTimeout(() => {
      setLoading(true);
      const limit = maxResults || 4;
      fetchJson(pickListRequestUrl(fetchUrl, search, limit), { signal: controller.signal })
        .then((res: any) => {
          if (controller.signal.aborted) return;
          const data = res.data || res;
          if (Array.isArray(data)) {
            setAsyncResults(data.slice(0, limit));
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
    // TD-234 (بند ۱): mapResultToOption در وابستگی‌ها نیست؛ والدی که تابع درجا می‌سازد با هر رندر جستجو را دوباره نمی‌فرستد.
    // نگاشت نتایج در useMemo زیر انجام می‌شود تا برچسب‌ها با تغییر تابع (مثلاً رزرو پروژه) تازه بمانند.
  }, [search, fetchUrl, maxResults]);

  const asyncOptions = useMemo<Option[]>(() => {
    if (!asyncResults || !mapResultToOption) return [];
    return asyncResults.map((item: unknown) => {
      const opt = mapResultToOption(item);
      opt._raw = item;
      return opt;
    });
  }, [asyncResults, mapResultToOption]);

  const limit = maxResults || 4;

  // v9.0.291 (TD-675): همان یکسان‌سازی جست‌وجوی سراسری سرور
  const filteredPropOptions = React.useMemo(() => {
    if (!search.trim()) {
      return propOptions.slice(0, limit);
    }
    const query = normalizeSearchText(search);
    const matches = propOptions.filter(opt => normalizeSearchText(opt.label).includes(query));
    
    matches.sort((a, b) => {
      const aLabel = normalizeSearchText(a.label);
      const bLabel = normalizeSearchText(b.label);
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
  // v9.0.309 (TD-680): مقدار ازپیش‌انتخاب‌شده برچسبش را از نتایج `fetchUrl` هم می‌گیرد، سپس از `valueLabel`؛ هرگز متن خالی
  const foundOpt = propOptions.find(o => safeStr(o?.value) === valStr) ?? asyncOptions.find(o => safeStr(o?.value) === valStr);
  const currentLabel = !valStr ? placeholder : (foundOpt?.label || (chosen?.value === valStr ? chosen.label : '') || valueLabel || placeholder);

  const close = (refocus: boolean) => {
    setIsOpen(false);
    setSearch('');
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (opt: Option) => {
    if (opt.disabled) return;
    onChange(String(opt.value), opt._raw);
    setChosen({ value: String(opt.value), label: opt.label });
    close(true);
  };

  // TD-1325 (OBS-R2-93): arrow keys, Enter, Esc and Tab of the list
  const { activeIndex, setActiveIndex, listId, optionId, activeDescendant, onKeyDown } = usePickListKeys({
    isOpen, options: displayOptions, onPick: choose, onClose: () => close(true),
  });

  const openList = () => {
    setActiveIndex(displayOptions.findIndex((opt) => safeStr(opt.value) === valStr));
    setIsOpen(true);
  };

  return (
    <div className={cn("relative", className)} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        aria-describedby={id ? `${id}-value` : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => (isOpen ? close(false) : openList())}
        onKeyDown={(event) => {
          if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openList();
          }
        }}
        className={cn(
          "w-full bg-white border border-slate-200 rounded-xl shadow-2xs text-xs px-3 py-2 flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-800",
          disabled && "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200",
          className
        )}
      >
        <span id={id ? `${id}-value` : undefined} className="truncate text-right font-medium">{currentLabel}</span>
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
              role="combobox"
              aria-label="جست‌وجو در فهرست"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendant}
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setActiveIndex(e.target.value.trim() ? 0 : -1);
              }}
              onKeyDown={onKeyDown}
              placeholder="جست‌وجو..."
              className="w-full bg-transparent text-xs font-bold text-slate-800 focus:outline-none"
            />
            {loading && <Loader2 size={14} className="text-blue-500 animate-spin shrink-0 ml-1" />}
          </div>
          <ul id={listId} role="listbox" className="overflow-auto py-1 text-xs" style={{ maxHeight: `${Math.max(100, coords.maxHeight - 45)}px` }}>
            <li
              role="option"
              aria-selected={!valStr}
              className="px-3 py-2 text-slate-500 hover:bg-slate-100 cursor-pointer font-medium"
              onClick={() => {
                onChange('');
                setChosen(null);
                close(true);
              }}
            >
              -- {placeholder} --
            </li>
            {displayOptions.length > 0 ? (
              displayOptions.map((opt, index) => (
                <li
                  key={`${opt.value ?? ''}-${index}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={valStr === safeStr(opt.value)}
                  aria-disabled={opt.disabled || undefined}
                  className={cn(
                    "px-3 py-2 cursor-pointer transition-colors leading-relaxed",
                    opt.disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : "hover:bg-blue-50 text-slate-700",
                    valStr === safeStr(opt.value) && "bg-blue-100/80 text-blue-900 font-bold",
                    index === activeIndex && !opt.disabled && "bg-blue-50 ring-1 ring-inset ring-blue-300"
                  )}
                  onMouseEnter={() => { if (!opt.disabled) setActiveIndex(index); }}
                  onClick={() => choose(opt)}
                >
                  {opt.label}
                </li>
              ))
            ) : (
              <li role="presentation" className="px-3 py-3 text-slate-400 text-center font-medium">
                {loading ? 'در حال جست‌وجو...' : 'موردی یافت نشد'}
              </li>
            )}
            {displayOptions.length > 0 && propOptions.length > limit && (
              <li role="presentation" className="px-3 py-1.5 text-[10px] font-medium text-slate-400 bg-slate-50 border-t border-slate-100 text-center select-none">
                برای مشاهده موارد بیشتر عبارت مورد نظر را جست‌وجو کنید
              </li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
