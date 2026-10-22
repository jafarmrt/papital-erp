import { useCallback, useEffect, useState, type RefObject } from 'react';

/** Where a portal drop-down sits next to its button: below it, or above it when there is more room there */
export interface DropdownCoords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  showAbove: boolean;
}

/** Keeps a drop-down beside its button while it is open, following resize and every scroll (from `SearchableSelect`) */
export function useDropdownPosition(buttonRef: RefObject<HTMLElement | null>, isOpen: boolean): DropdownCoords {
  const [coords, setCoords] = useState<DropdownCoords>({ top: 0, left: 0, width: 0, maxHeight: 280, showAbove: false });

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const showAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(280, showAbove ? spaceAbove : spaceBelow));
    const width = Math.max(rect.width, 240);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    setCoords({ top: showAbove ? rect.top - 4 : rect.bottom + 4, left, width, maxHeight, showAbove });
  }, [buttonRef]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  return coords;
}
