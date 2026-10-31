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
import { reloadOnceForNewVersion } from './lib/system/chunkReload';
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

// v11 (owner report 9 Aban 1405, blank page in Firefox): a chunk Vite could not load, also one outside the error boundaries,
// earns the same single reload with the newest service worker (src/lib/system/chunkReload.ts); never a loop
window.addEventListener('vite:preloadError', event => {
  if (reloadOnceForNewVersion(event.payload, true)) event.preventDefault();
});

// v10.0.16 (D-11): installable app; registers only in the production build
listenForInstallPrompt();
void registerAppServiceWorker();
