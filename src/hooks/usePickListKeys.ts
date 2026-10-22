import { useEffect, useId, useState, type KeyboardEvent } from 'react';

/**
 * Keyboard of a pick list (v10.2.24, TD-1325, OBS-R2-93), used by `SearchableSelect`: the arrow keys move the active
 * option and skip disabled ones, Enter picks it, Esc closes only the list (`preventDefault`, so the window under it
 * stays open; `dialogEscapeStack`) and Tab closes the list and lets focus move on from its button.
 */
export interface PickListOption {
  disabled?: boolean;
}

/** The next option that can be picked from `from` in `step` direction, wrapping around; -1 when none can */
export function nextEnabledOption(options: readonly PickListOption[], from: number, step: 1 | -1): number {
  const count = options.length;
  for (let i = 1; i <= count; i += 1) {
    const index = (((from + step * i) % count) + count) % count;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function usePickListKeys<T extends PickListOption>({ isOpen, options, onPick, onClose }: {
  isOpen: boolean;
  options: readonly T[];
  onPick: (option: T) => void;
  /** Closes the list and puts focus back on its button */
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => nextEnabledOption(options, current < 0 && step === -1 ? 0 : current, step));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) onPick(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      onClose();
    }
  };

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const option = document.getElementById(`${listId}-option-${activeIndex}`);
    if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex, listId]);

  return {
    activeIndex,
    setActiveIndex,
    listId,
    optionId,
    activeDescendant: activeIndex >= 0 && options[activeIndex] ? optionId(activeIndex) : undefined,
    onKeyDown,
  };
}
