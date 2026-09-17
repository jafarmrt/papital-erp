import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { normalizePersianText } from '../../utils';
import type { Account } from '../../types';
import { useClickOutside } from '../../hooks/useClickOutside';

interface AccountSearchSelectProps {
  accounts: Account[];
  value: number | '';
  onChange: (accountId: number | '') => void;
  onAdvance?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}

export function AccountSearchSelect({
  accounts,
  value,
  onChange,
  onAdvance,
  placeholder = 'انتخاب یا جستجوی کد/عنوان حساب...',
  className = '',
  autoFocus = false,
  inputRef: externalInputRef,
}: AccountSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedAccount = useMemo(() => {
    return accounts.find(a => a.id === Number(value)) || null;
  }, [accounts, value]);

  // Filter selectable accounts (primarily subsidiary and detailed, but allow general too)
  const filteredAccounts = useMemo(() => {
    const query = normalizePersianText(searchQuery);
    if (!query) {
      return accounts.slice(0, 100);
    }
    return accounts.filter(acc => {
      const matchCode = acc.code.toLowerCase().includes(query);
      const matchName = normalizePersianText(acc.name).includes(query);
      const matchType = acc.accountType ? normalizePersianText(acc.accountType).includes(query) : false;
      const matchDesc = acc.description ? normalizePersianText(acc.description).includes(query) : false;
      return matchCode || matchName || matchType || matchDesc;
    }).slice(0, 100);
  }, [accounts, searchQuery]);

  useEffect(() => {
    if (selectedAccount && !isOpen) {
      setSearchQuery(`${selectedAccount.code} - ${selectedAccount.name}`);
    } else if (!value && !isOpen) {
      setSearchQuery('');
    }
  }, [selectedAccount, isOpen, value]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredAccounts]);

  // Click outside listener
  useClickOutside([containerRef], () => {
    setIsOpen(false);
    if (selectedAccount) {
      setSearchQuery(`${selectedAccount.code} - ${selectedAccount.name}`);
    } else {
      setSearchQuery('');
    }
  });

  const handleSelect = (account: Account) => {
    onChange(account.id);
    setSearchQuery(`${account.code} - ${account.name}`);
    setIsOpen(false);
    if (onAdvance) {
      setTimeout(() => onAdvance(), 50);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex(prev => (prev + 1 < filteredAccounts.length ? prev + 1 : prev));
        scrollHighlightedIntoView(highlightedIndex + 1);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) {
        setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : 0));
        scrollHighlightedIntoView(highlightedIndex - 1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && filteredAccounts[highlightedIndex]) {
        handleSelect(filteredAccounts[highlightedIndex]);
      } else if (isOpen && filteredAccounts.length === 1) {
        handleSelect(filteredAccounts[0]);
      } else if (!isOpen && onAdvance) {
        onAdvance();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      if (selectedAccount) {
        setSearchQuery(`${selectedAccount.code} - ${selectedAccount.name}`);
      }
    } else if (e.key === 'Tab') {
      if (isOpen && filteredAccounts[highlightedIndex] && searchQuery) {
        handleSelect(filteredAccounts[highlightedIndex]);
      }
      setIsOpen(false);
    }
  };

  const scrollHighlightedIntoView = (index: number) => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('li');
    if (items[index]) {
      items[index].scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            // Select text on focus for rapid code replacement
            inputRef.current?.select();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-12 pr-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-xs font-medium"
        />
        <div className="absolute left-2 flex items-center gap-1">
          {(value !== '' || searchQuery) && (
            <button
              type="button"
              tabIndex={-1}
              onClick={handleClear}
              title="پاک کردن انتخاب"
              className="text-slate-400 hover:text-rose-500 transition p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setIsOpen(!isOpen);
              inputRef.current?.focus();
            }}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute z-50 right-0 left-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-64 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 min-w-[280px]">
          {filteredAccounts.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
              حسابی با این کد یا عنوان یافت نشد
            </div>
          ) : (
            <ul ref={listRef} className="py-1 divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
              {filteredAccounts.map((acc, index) => {
                const isSelected = acc.id === Number(value);
                const isHighlighted = index === highlightedIndex;

                const levelBadge = acc.level === 'subsidiary' 
                  ? { label: 'معین', bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' }
                  : acc.level === 'detailed'
                  ? { label: 'تفصیلی', bg: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' }
                  : { label: 'کل', bg: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' };

                return (
                  <li
                    key={acc.id || `acc-sel-${acc.code}-${index}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelect(acc)}
                    className={`px-3 py-2 cursor-pointer flex items-center justify-between transition ${
                      isHighlighted 
                        ? 'bg-indigo-50/80 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-200 font-semibold' 
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded shrink-0">
                        {acc.code}
                      </span>
                      <span className="truncate">{acc.name}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${levelBadge.bg}`}>
                        {levelBadge.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
