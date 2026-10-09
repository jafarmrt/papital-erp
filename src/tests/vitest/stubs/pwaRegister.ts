// v10.0.16 (D-11): Vitest runs without vite-plugin-pwa, which provides `virtual:pwa-register` in the app build
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
