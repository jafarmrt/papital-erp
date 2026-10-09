import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { applyReadyUpdate, isUpdateReady, subscribeUpdateReady } from '../../lib/pwa/pwaStatus';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';

export const OFFLINE_BANNER_TEXT = 'اتصال قطع است؛ ثبت پس از وصل شدن ممکن است.';
export const UPDATE_BANNER_TEXT = 'نسخه تازه برنامه آماده است.';
export const UPDATE_BUTTON_TEXT = 'بارگذاری دوباره';

/**
 * v10.0.16 (D-11، تصمیم ت۱۰ الف): نوار «اتصال قطع است» بالای صفحه و نوار «نسخه تازه آماده است» پایین صفحه.
 * برنامه بی اینترنت باز می‌شود ولی هیچ ثبتی در صف نمی‌ماند؛ درخواست نوشتنی پس از خطای شبکه خودکار دوباره فرستاده نمی‌شود (TD-670).
 */
export function PwaStatusBanners() {
  const online = useOnlineStatus();
  const [updateReady, setUpdateReady] = useState(isUpdateReady);
  const [updating, setUpdating] = useState(false);
  useEffect(() => subscribeUpdateReady(setUpdateReady), []);

  const reload = async () => {
    setUpdating(true);
    try {
      await applyReadyUpdate();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      {!online && (
        <div
          role="status"
          dir="rtl"
          className="fixed top-0 inset-x-0 z-[9990] flex items-center justify-center gap-2 bg-amber-500 text-slate-950 text-xs font-bold px-3 py-1.5 print:hidden"
        >
          <WifiOff size={14} aria-hidden="true" />
          <span>{OFFLINE_BANNER_TEXT}</span>
        </div>
      )}
      {updateReady && (
        <div
          role="alert"
          dir="rtl"
          className="fixed inset-x-3 bottom-20 md:bottom-4 md:inset-x-auto md:left-4 z-[9990] flex items-center justify-between gap-3 rounded-2xl bg-slate-900 text-white text-sm px-4 py-3 shadow-xl print:hidden"
        >
          <span>{UPDATE_BANNER_TEXT}</span>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={updating}
            className="flex items-center gap-1.5 rounded-xl bg-amber-400 text-slate-950 font-bold px-3 py-1.5 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw size={14} aria-hidden="true" className={updating ? 'animate-spin' : undefined} />
            {UPDATE_BUTTON_TEXT}
          </button>
        </div>
      )}
    </>
  );
}

export default PwaStatusBanners;
