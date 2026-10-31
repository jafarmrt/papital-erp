import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './contexts/AuthContext';
import { SearchProvider } from './SearchContext';
import App from './App.tsx';
import { SystemStartingOverlay } from './components/common/SystemStartingOverlay';
import { PwaStatusBanners } from './components/pwa/PwaStatusBanners';
import { registerAppServiceWorker } from './lib/pwa/registerServiceWorker';
import { listenForInstallPrompt } from './lib/pwa/installPrompt';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SearchProvider>
          <App />
          <SystemStartingOverlay />
          <PwaStatusBanners />
        </SearchProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// v10.0.16 (D-11): installable app; registers only in the production build
listenForInstallPrompt();
void registerAppServiceWorker();
