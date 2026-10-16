import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The page filter (the search box of a list page) shared by the list pages.
 *
 * OBS-R2-91: the header's global search keeps its own text; it no longer shares this state, so typing in a page filter
 * never sends `/global-search`. The filter belongs to one page: `SearchRouteReset` clears it when the route changes,
 * except the filter a global search hit opens its list with (`setSearchForNavigation`).
 */
interface SearchContextValue {
  searchQuery: string;
  debouncedSearchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  /** Sets the filter the page at `path` opens with; the route change to that path keeps it. */
  setSearchForNavigation: (query: string, path: string) => void;
  /** Called on every route change: clears the filter unless it was set for the new path. */
  resetForRoute: (pathname: string) => void;
}

const SearchContext = createContext<SearchContextValue>({
  searchQuery: '',
  debouncedSearchQuery: '',
  setSearchQuery: () => {},
  clearSearch: () => {},
  setSearchForNavigation: () => {},
  resetForRoute: () => {},
});

/** The pathname of an in-app link («/products?type=raw_material» → «/products») */
export function pathnameOf(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const carryToPathRef = useRef<string | null>(null);

  // Debounce search query updates with 350ms delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Immediate reset function
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);

  const setSearchForNavigation = useCallback((query: string, path: string) => {
    carryToPathRef.current = pathnameOf(path);
    setSearchQuery(query);
    setDebouncedSearchQuery(query);
  }, []);

  const resetForRoute = useCallback((pathname: string) => {
    const carried = carryToPathRef.current === pathname;
    carryToPathRef.current = null;
    if (!carried) {
      setSearchQuery('');
      setDebouncedSearchQuery('');
    }
  }, []);

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        debouncedSearchQuery,
        setSearchQuery,
        clearSearch,
        setSearchForNavigation,
        resetForRoute,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  return useContext(SearchContext);
}

/**
 * Clears the page filter when the route changes. Render it inside the router before the pages: a sibling's effects run
 * before the effects of the pages after it, so a page that sets its filter from the address on mount keeps it.
 */
export function SearchRouteReset() {
  const { pathname } = useLocation();
  const { resetForRoute } = useSearch();
  const previousPathRef = useRef(pathname);
  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    resetForRoute(pathname);
  }, [pathname, resetForRoute]);
  return null;
}
