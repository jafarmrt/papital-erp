import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'erp_sidebar_favorite_paths';

export function useSidebarFavorites() {
  const [favoritePaths, setFavoritePaths] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse favorites from localStorage:', e);
    }
    // Default favorites for new users
    return ['/', '/invoices', '/accounting/treasury'];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favoritePaths));
    } catch (e) {
      console.error('Failed to save favorites to localStorage:', e);
    }
  }, [favoritePaths]);

  const toggleFavorite = useCallback((path: string) => {
    setFavoritePaths(prev => {
      if (prev.includes(path)) {
        return prev.filter(p => p !== path);
      } else {
        return [...prev, path];
      }
    });
  }, []);

  const isFavorite = useCallback((path: string) => {
    return favoritePaths.includes(path);
  }, [favoritePaths]);

  return {
    favoritePaths,
    toggleFavorite,
    isFavorite
  };
}
