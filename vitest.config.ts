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
  },
});
