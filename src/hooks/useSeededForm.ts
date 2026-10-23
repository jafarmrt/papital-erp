import { useCallback, useState, type SetStateAction } from 'react';

const RESEED = Symbol('reseed');

interface SeededForm<S, T> {
  form: T;
  /** the record the form was last filled from; RESEED asks for a fill from the current record on the next render */
  source: S | undefined | typeof RESEED;
  edited: boolean;
}

/**
 * 10.3 (ARCH review finding 3, part 13): a settings form filled from a record read through the shared cache. While the
 * user has not edited it, it follows each newer read of the record (a save elsewhere shows at once); once edited it
 * keeps the user's values when a newer read arrives, until `refill` (after its own save, or when another record is
 * picked) fills it again from the record as read now. `source` must keep its identity while it is unchanged (a row of
 * the query's data, not an object built in render).
 */
export function useSeededForm<S, T>(source: S | undefined, fill: (source: S | undefined) => T) {
  const [state, setState] = useState<SeededForm<S, T>>(() => ({ form: fill(source), source, edited: false }));
  let current = state;
  if (state.source !== source && (!state.edited || state.source === RESEED)) {
    current = { form: fill(source), source, edited: false };
    setState(current);
  }

  const edit = useCallback((change: SetStateAction<T>) => {
    setState(prev => ({
      ...prev,
      edited: true,
      form: typeof change === 'function' ? (change as (form: T) => T)(prev.form) : change,
    }));
  }, []);
  const refill = useCallback(() => {
    setState(prev => ({ ...prev, source: RESEED, edited: false }));
  }, []);

  return { form: current.form, edited: current.edited, edit, refill };
}
