import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface SearchContextValue {
  searchQuery: string;
  debouncedSearchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
}

const SearchContext = createContext<SearchContextValue>({
  searchQuery: '',
  debouncedSearchQuery: '',
  setSearchQuery: () => {},
  clearSearch: () => {},
});

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

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

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        debouncedSearchQuery,
        setSearchQuery,
        clearSearch,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  return useContext(SearchContext);
}

