import { useEffect, useState } from 'react';

/**
 * v11 phase 6.1ch (M13): a screen paged on the server prints every row. The screen fetches the rows, sets them here, and
 * this prints once they are on the page and drops them after the print, so the screen goes back to its page.
 */
export function usePrintSnapshot<T>() {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  useEffect(() => {
    if (snapshot === null) return undefined;
    const clear = () => setSnapshot(null);
    window.addEventListener('afterprint', clear, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', clear);
  }, [snapshot]);
  return [snapshot, setSnapshot] as const;
}
