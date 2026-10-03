import { useCallback, useState } from 'react';

/**
 * انتخاب تیک‌دار اقلام یک جدول صفحه نقطه سفارش (مواد اولیه یا محصولات) برای عملیات یکجا.
 * «انتخاب همه» وقتی همه اقلام نمایش‌داده‌شده انتخاب شده‌اند، انتخاب را پاک می‌کند.
 */
export function useReorderSelection(visibleItems: Array<{ id: number }>) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = selectedIds.size === visibleItems.length && visibleItems.length > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleItems.map(i => i.id)));
    }
  };

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, allSelected, toggle, toggleAll, clear };
}
