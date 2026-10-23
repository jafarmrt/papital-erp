import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { QUERY_DEFAULTS } from '../../../lib/queryDefaults';

/**
 * 10.3: a client with the app's read defaults (data fresh for five minutes), without retries: a screen that must read
 * again on each opening has to say so itself, as it must in the app
 */
export const appQueryClient = () => new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS, retry: false } } });

/** A fresh React Query client for one render, kept across its rerenders: the user and role forms save through mutations (OBS-R1-38). */
export function QueryWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** render inside {@link QueryWrapper}; since 10.3 the payroll, settlement and remittance windows read through the shared cache */
export const renderWithQuery = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) => render(ui, { wrapper: QueryWrapper, ...options });
