import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Package, Box, UsersRound, ClipboardList, Layers, ArrowLeft, Loader2 } from 'lucide-react';
import { useSearch } from '../SearchContext';
import { fetchJson } from '../api';
import { SafeImage } from './SafeImage';
import { formatPersianNumber, formatPersianDate } from '../utils';

interface SearchResultItems {
  id: number;
  name: string;
  code: string;
  type: 'product' | 'raw_material';
  category?: string;
  unit?: string;
  currentStock?: number;
  thumbnail?: string;
}

interface SearchResultCustomer {
  id: number;
  name: string;
  city?: string;
  province?: string;
  address?: string;
}

interface SearchResultDocument {
  id: number;
  ref_number: string;
  buyer_name?: string;
  type: string;
  date?: string;
}

interface SearchResultProject {
  id: number;
  project_code: string;
  title: string;
  status: string;
  customer_name?: string;
}

interface GlobalSearchResults {
  items: SearchResultItems[];
  customers: SearchResultCustomer[];
  documents: SearchResultDocument[];
  projects: SearchResultProject[];
}

export default function GlobalHeaderSearch() {
  const { searchQuery, setSearchQuery } = useSearch();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchResults>({
    items: [],
    customers: [],
    documents: [],
    projects: []
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut (Ctrl+K or Command+K or /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch quick results when searchQuery changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults({ items: [], customers: [], documents: [], projects: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    // V9 Phase 4.2: لغو درخواست قبلی هنگام تایپ کاربر — پاسخ کهنه هرگز جدید را بازنویسی نمی‌کند
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchJson(`/global-search?q=${encodeURIComponent(searchQuery.trim())}`, { signal: controller.signal })
        .then((res: GlobalSearchResults) => {
          if (controller.signal.aborted) return;
          if (res) {
            setResults({
              items: Array.isArray(res.items) ? res.items : [],
              customers: Array.isArray(res.customers) ? res.customers : [],
              documents: Array.isArray(res.documents) ? res.documents : [],
              projects: Array.isArray(res.projects) ? res.projects : []
            });
          }
        })
        .catch(err => {
          if (err?.name === 'AbortError') return;
          console.error('Global search error:', err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalResults =
    (Array.isArray(results?.items) ? results.items.length : 0) +
    (Array.isArray(results?.customers) ? results.customers.length : 0) +
    (Array.isArray(results?.documents) ? results.documents.length : 0) +
    (Array.isArray(results?.projects) ? results.projects.length : 0);

  const handleSelectResult = (path: string) => {
    setIsOpen(false);
    navigate(path);
  };

  return (
    <div className="relative w-full max-w-lg font-sans" ref={containerRef}>
      <div className="relative flex items-center">
        <Search className="absolute right-3.5 text-slate-400 pointer-events-none" size={18} />
        <input 
          ref={inputRef}
          type="text" 
          placeholder="جستجوی سراسری کالا، مشتری، فاکتور، پروژه... (Ctrl+K)" 
          value={searchQuery}
          onFocus={() => setIsOpen(true)}
          onChange={e => {
            setSearchQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          className="w-full pr-10 pl-16 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/80 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-xs transition-all placeholder:text-slate-400" 
        />
        <div className="absolute left-2.5 flex items-center gap-1">
          {searchQuery ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
              title="پاک کردن جستجو"
            >
              <X size={15} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-200/70 border border-slate-300 rounded shadow-2xs">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      {/* Floating Results Modal */}
      {isOpen && searchQuery.trim().length > 0 && (
        <div className="absolute top-full right-0 left-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 max-h-[75vh] flex flex-col transition-all">
          <div className="p-3 bg-slate-50 border-b flex justify-between items-center text-xs text-slate-500">
            <span className="font-semibold flex items-center gap-1.5">
              🔍 نتایج جستجوی سریع برای «{searchQuery}»
            </span>
            {loading && <Loader2 className="animate-spin text-blue-600" size={15} />}
          </div>

          <div className="overflow-y-auto p-2 space-y-3 custom-scrollbar flex-1">
            {!loading && totalResults === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs font-medium">
                هیچ موردی متناسب با جستجوی شما یافت نشد.
              </div>
            )}

            {/* Items */}
            {results.items.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[11px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                  <Package size={13} className="text-blue-500" />
                  کالاها و مواد اولیه ({formatPersianNumber(results.items.length)})
                </div>
                <div className="space-y-1 mt-1">
                  {results.items.map(item => {
                    const targetPath = item.type === 'raw_material' ? '/products?type=raw_material' : '/products';
                    return (
                      <button
                        key={`item-${item.id}`}
                        onClick={() => handleSelectResult(targetPath)}
                        className="w-full text-right p-2 hover:bg-blue-50/70 rounded-xl transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {item.thumbnail ? (
                            <SafeImage src={item.thumbnail} alt={item.name} className="w-8 h-8 rounded-lg object-cover border shrink-0" fallbackIcon={<Package size={14} />} />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 font-bold text-xs">
                              {item.type === 'raw_material' ? <Box size={16} /> : <Package size={16} />}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate group-hover:text-blue-600">{item.name}</p>
                            <p className="text-[10px] text-slate-400 flex items-center gap-2">
                              <span>کد: {item.code}</span>
                              {item.category && <span>• دسته‌بندی: {item.category}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600">
                            موجودی: {formatPersianNumber(item.currentStock || 0)} {item.unit || ''}
                          </span>
                          <ArrowLeft size={14} className="text-slate-300 group-hover:text-blue-500 transition-transform group-hover:-translate-x-1" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Customers */}
            {results.customers.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[11px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider border-t pt-2">
                  <UsersRound size={13} className="text-emerald-500" />
                  طرفین حساب ({formatPersianNumber(results.customers.length)})
                </div>
                <div className="space-y-1 mt-1">
                  {results.customers.map(cust => (
                    <button
                      key={`cust-${cust.id}`}
                      onClick={() => handleSelectResult('/customers')}
                      className="w-full text-right p-2 hover:bg-emerald-50/70 rounded-xl transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 font-bold text-xs">
                          <UsersRound size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate group-hover:text-emerald-600">{cust.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {[cust.province, cust.city, cust.address].filter(Boolean).join(' - ') || 'بدون آدرس'}
                          </p>
                        </div>
                      </div>
                      <ArrowLeft size={14} className="text-slate-300 group-hover:text-emerald-500 transition-transform group-hover:-translate-x-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Invoices */}
            {results.documents.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[11px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider border-t pt-2">
                  <ClipboardList size={13} className="text-purple-500" />
                  اسناد و فاکتورها ({formatPersianNumber(results.documents.length)})
                </div>
                <div className="space-y-1 mt-1">
                  {results.documents.map(doc => (
                    <button
                      key={`doc-${doc.id}`}
                      onClick={() => handleSelectResult('/invoices')}
                      className="w-full text-right p-2 hover:bg-purple-50/70 rounded-xl transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 font-bold text-xs">
                          <ClipboardList size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate group-hover:text-purple-600">
                            شماره مرجع: {doc.ref_number}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            خریدار/طرف حساب: {doc.buyer_name || 'ثبت نشده'} {doc.date ? `• تاریخ: ${formatPersianDate(doc.date)}` : ''}
                          </p>
                        </div>
                      </div>
                      <ArrowLeft size={14} className="text-slate-300 group-hover:text-purple-500 transition-transform group-hover:-translate-x-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Projects */}
            {results.projects.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[11px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider border-t pt-2">
                  <Layers size={13} className="text-amber-500" />
                  پروژه‌های تولید ({formatPersianNumber(results.projects.length)})
                </div>
                <div className="space-y-1 mt-1">
                  {results.projects.map(proj => (
                    <button
                      key={`proj-${proj.id}`}
                      onClick={() => handleSelectResult('/projects')}
                      className="w-full text-right p-2 hover:bg-amber-50/70 rounded-xl transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 font-bold text-xs">
                          <Layers size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate group-hover:text-amber-600">
                            [{proj.project_code}] {proj.title}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            مشتری: {proj.customer_name || 'عام'} • وضعیت: {proj.status}
                          </p>
                        </div>
                      </div>
                      <ArrowLeft size={14} className="text-slate-300 group-hover:text-amber-500 transition-transform group-hover:-translate-x-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="p-2 bg-slate-100 border-t text-[11px] text-slate-500 flex justify-between items-center px-4">
            <span>کلیک روی هر مورد برای انتقال مستقیم</span>
            <span className="font-mono text-[10px] text-slate-400">ESC برای بستن</span>
          </div>
        </div>
      )}
    </div>
  );
}
