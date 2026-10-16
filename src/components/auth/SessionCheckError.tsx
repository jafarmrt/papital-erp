import { useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

/**
 * OBS-R1-33: the session check at start failed with a network or server error. The token and cache are kept and the
 * user retries here; only a 401 sends them to the login page.
 */
export function SessionCheckError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 font-sans">
      <div role="alert" className="w-full max-w-sm rounded-2xl border border-rose-200 bg-white dark:bg-slate-800 p-6 text-center shadow-lg">
        <WifiOff size={28} className="mx-auto mb-3 text-rose-600" />
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-7">{message}</p>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          <RefreshCw size={15} className={retrying ? 'animate-spin' : ''} />
          تلاش دوباره
        </button>
      </div>
    </div>
  );
}
