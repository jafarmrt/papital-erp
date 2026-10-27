import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';

/**
 * Keyboard of a pick list (v10.2.27, TD-1325, OBS-R2-93), used by `SearchableSelect`: the arrow keys move the active
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

/**
 * v11 phase 6.3b (U23): the letter a key types, or '' for a key that types none (Space presses the button, so it is none
 * here). A letter typed on the picker's button opens the list with that letter in the search: a fast typist or a barcode
 * scanner lost or reordered the first letter while the search box was still mounting.
 */
export function typedLetterOf(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey ? event.key : '';
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

/**
 * The keys of a pick list's closed or open button and the focus of its search box (`SearchableSelect`): ArrowDown and
 * ArrowUp open the list, Enter runs `onEnter` on a closed list, and (v11 phase 6.3b, U23) a letter opens the list with
 * that letter in the search, or adds it to the search of an open list whose button still has the focus. The search box
 * takes the focus in the same commit that shows it, with the caret after what the opening letter put there, so the next
 * key lands in it; before, a fast typist's «پارسیان» became «ارسیانپ».
 */
export function usePickListButton({ isOpen, open, setSearch, setActiveIndex, onEnter }: {
  isOpen: boolean;
  open: () => void;
  setSearch: Dispatch<SetStateAction<string>>;
  setActiveIndex: (index: number) => void;
  onEnter?: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = searchRef.current;
    if (!isOpen || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [isOpen]);

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const letter = typedLetterOf(event);
    if (letter) {
      event.preventDefault();
      if (!isOpen) open();
      setSearch(current => (isOpen ? current : '') + letter);
      setActiveIndex(0);
      searchRef.current?.focus();
    } else if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      open();
    } else if (!isOpen && event.key === 'Enter' && onEnter) {
      event.preventDefault();
      onEnter();
    }
  };
  return { searchRef, onButtonKeyDown };
}
