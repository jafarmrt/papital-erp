import { defineConfig } from 'vitest/config';

/**
 * v7.0.76 (audit P3-6، تصمیم مالک محصول): Vitest فقط برای تست‌های تازه واحد و فرانت؛ رانر قبلی
 * (scripts/run-tests.ts) برای مجموعه‌های پایگاه‌داده و دامنه می‌ماند. تست‌ها در src/tests/vitest/ هستند.
 */
export default defineConfig({
  test: {
    include: ['src/tests/vitest/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
  },
});
