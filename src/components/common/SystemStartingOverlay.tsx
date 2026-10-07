import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { isSystemStarting, subscribeSystemStarting } from '../../lib/systemStarting';

/**
 * v9.0.164 (TD-584, product-owner decision ت۲): a waiting page while the server finishes an update; the
 * requests behind it are retried by `fetchThroughStartup` and the page closes on the first real answer.
 */
export function SystemStartingOverlay() {
  const [starting, setStarting] = useState(isSystemStarting);
  useEffect(() => subscribeSystemStarting(setStarting), []);
  if (!starting) return null;
  return (
    <div
      role="alertdialog"
      aria-live="polite"
      aria-label="سامانه در حال به‌روزرسانی است"
      dir="rtl"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
    >
      <div className="max-w-sm w-full rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 text-center">
        <Loader2 className="w-8 h-8 mx-auto text-amber-600 animate-spin" />
        <p className="mt-4 text-sm font-bold text-slate-800 dark:text-slate-100">سامانه در حال به‌روزرسانی است</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-6">
          چند لحظه صبر کنید؛ درخواست شما پس از آماده شدن سامانه خودکار دوباره فرستاده می‌شود.
        </p>
      </div>
    </div>
  );
}

export default SystemStartingOverlay;
