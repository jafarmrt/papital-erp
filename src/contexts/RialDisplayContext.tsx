import { createContext, useContext, type ReactNode } from 'react';
import { useRialDisplay } from '../hooks/useAppCurrency';
import { rialDisplayOf, type RialDisplay } from '../lib/rialDisplay';

/**
 * v11 phase 6.3 (U3, decision ت۵۷): the display unit of rial amounts for the screens that only show amounts (the invoice
 * list and its detail window, the quick settlement, the approval inbox). The app frame provides the setting
 * (`RialDisplayProvider`, under the signed-in layout); outside it (a test, the sign-in page) amounts stay in rial. A
 * printed invoice or proforma never reads it: it stays in rial.
 */
const RialDisplayContext = createContext<RialDisplay>(rialDisplayOf('IRR'));

export function RialDisplayProvider({ children }: { children: ReactNode }) {
  const rial = useRialDisplay();
  return <RialDisplayContext.Provider value={rial}>{children}</RialDisplayContext.Provider>;
}

/** The display unit of the app frame, without a read of its own (a leaf of a list or a window) */
export function useShownRial(): RialDisplay {
  return useContext(RialDisplayContext);
}
