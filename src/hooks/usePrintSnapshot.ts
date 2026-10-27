import { useEffect, useState } from 'react';

/**
 * v11 phase 6.1ch (M13): a screen paged on the server prints every row. `start` loads the rows (one load at a time), this
 * prints once they are on the page and drops them after the print, so the screen goes back to its page. The rows belong
 * to `owner` (the report or selection on screen when the load started): when the owner changes, during the load or after
 * a print whose end the browser never reports, they are dropped and never printed.
 */
export function usePrintSnapshot<T>(owner: unknown) {
  const [snapshot, setSnapshot] = useState<{ owner: unknown; data: T } | null>(null);
  const [loading, setLoading] = useState(false);
  if (snapshot && !Object.is(snapshot.owner, owner)) setSnapshot(null);
  const data = snapshot && Object.is(snapshot.owner, owner) ? snapshot.data : null;

  useEffect(() => {
    if (data === null) return undefined;
    const clear = () => setSnapshot(null);
    window.addEventListener('afterprint', clear, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', clear);
  }, [data]);

  /** loads the rows and prints them; false when the load gave none */
  const start = async (load: () => Promise<T | null>): Promise<boolean> => {
    if (loading) return true;
    const loadedFor = owner;
    setLoading(true);
    try {
      const rows = await load();
      if (rows === null) return false;
      setSnapshot({ owner: loadedFor, data: rows });
      return true;
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, start };
}
