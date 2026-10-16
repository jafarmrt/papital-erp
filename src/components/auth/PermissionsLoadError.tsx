import { AlertTriangle, RefreshCw } from 'lucide-react';

/** OBS-R1-33: the user's permissions could not be read; said on top of the app with a retry, never read as «no access» */
export function PermissionsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      dir="rtl"
      className="fixed top-2 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-[150] flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800 shadow-lg font-sans"
    >
      <AlertTriangle size={16} className="shrink-0 text-rose-600" />
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700"
      >
        <RefreshCw size={13} />
        تلاش دوباره
      </button>
    </div>
  );
}
