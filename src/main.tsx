import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './contexts/AuthContext';
import { SearchProvider } from './SearchContext';
import App from './App.tsx';
import { SystemStartingOverlay } from './components/common/SystemStartingOverlay';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SearchProvider>
          <App />
          <SystemStartingOverlay />
        </SearchProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);


