import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { useState, type ReactElement, type ReactNode } from 'react';

/** A fresh React Query client for one render, kept across its rerenders: the user and role forms save through mutations (OBS-R1-38). */
export function QueryWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** render inside {@link QueryWrapper}; since 10.3 the payroll, settlement and remittance windows read through the shared cache */
export const renderWithQuery = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) => render(ui, { wrapper: QueryWrapper, ...options });
