import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * v7.0.76 (audit P3-6، تصمیم مالک محصول): Vitest فقط برای تست‌های تازه واحد و فرانت؛ رانر قبلی
 * (scripts/run-tests.ts) برای مجموعه‌های پایگاه‌داده و دامنه می‌ماند. تست‌ها در src/tests/vitest/ هستند.
 */
export default defineConfig({
  resolve: {
    // v10.0.16 (D-11): the app build gets this module from vite-plugin-pwa
    alias: { 'virtual:pwa-register': path.resolve(__dirname, 'src/tests/vitest/stubs/pwaRegister.ts') },
  },
  test: {
    include: ['src/tests/vitest/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
    // One jsdom per worker instead of one per file (41% of the run); each file still gets its own context, and unlike
    // vmThreads a forked worker honours process.env.TZ (processTimezone, notificationRelativeTime)
    pool: 'vmForks',
    // Repo-scanning ratchets and heavy page tests run slowly on a loaded two-core CI runner; the 5 s defaults flaked there.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Testing Library's findBy* / waitFor wait 5 s instead of 1 s (see the setup file)
    setupFiles: ['src/tests/vitest/setup/testingLibrary.ts'],
  },
});
