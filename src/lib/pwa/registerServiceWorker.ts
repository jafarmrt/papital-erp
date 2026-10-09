import { markUpdateReady } from './pwaStatus';

/**
 * v10.0.16 (D-11): service worker برنامه نصب‌پذیر فقط در ساخت تولید ثبت می‌شود (در توسعه و آزمون هیچ کاری نمی‌کند).
 * نسخه تازه هنگام بازگشت کاربر به برنامه (رویداد visibilitychange) بررسی می‌شود، هر بار حداکثر یک بار در نیم ساعت؛
 * زمان‌سنج پیوسته ندارد تا باتری گوشی مصرف نشود.
 */

export const UPDATE_CHECK_MIN_INTERVAL_MS = 30 * 60 * 1000;

export function shouldCheckForUpdate(lastCheckAt: number, now: number): boolean {
  return now - lastCheckAt >= UPDATE_CHECK_MIN_INTERVAL_MS;
}

export async function registerAppServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      markUpdateReady(() => updateServiceWorker(true));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      let lastCheckAt = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !shouldCheckForUpdate(lastCheckAt, Date.now())) return;
        lastCheckAt = Date.now();
        // a failed check (offline) is retried on the next return to the app
        registration.update().catch(() => undefined);
      });
    },
  });
}
