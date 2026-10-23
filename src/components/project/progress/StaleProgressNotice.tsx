import { RefreshCw } from 'lucide-react';
import type { ProductProgressTicks } from '../../../hooks/useProductProgressTicks';

/**
 * 10.3 (review of part 10): the matrix on screen is an older read because the last one failed (after a save too), so the
 * tab says so with «تلاش دوباره» instead of only a toast; nothing else reads it again until another write here.
 */
export function StaleProgressNotice({ ticks, buttonClassName = 'px-3 py-1.5' }: { ticks: ProductProgressTicks; buttonClassName?: string }) {
  const { loadError, loading, reload } = ticks;
  if (!loadError || ticks.products.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs" role="alert">
      <p className="font-bold text-rose-700">جدول پیشرفت تازه خوانده نشد و آنچه می‌بینید شاید کهنه باشد: {loadError}</p>
      <button
        type="button"
        onClick={reload}
        disabled={loading}
        className={`${buttonClassName} rounded-xl bg-blue-600 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60`}
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        تلاش دوباره
      </button>
    </div>
  );
}
