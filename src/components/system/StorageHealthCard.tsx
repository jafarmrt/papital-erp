import { CheckCircle2, HardDrive, XCircle } from 'lucide-react';
import { STORAGE_LOCATION_LABELS, type StorageHealth } from '../../lib/system/storageHealth';

/**
 * v9.0.359 (TD-619، B01-39): کارت ذخیره‌سازی صفحه سلامت. هر پوشه‌ای که برنامه در آن می‌نویسد (پیوست‌ها و تصویرها) با
 * وضعیت و مسیر خودش؛ پاسخ سرور قدیمی بی فهرست پوشه‌ها «قابل نوشتن» خوانده نمی‌شود.
 */
export function StorageHealthCard({ storage }: { storage?: StorageHealth }) {
  const locations = Array.isArray(storage?.locations) ? storage.locations : [];
  const writable = locations.length > 0 && locations.every(l => l.writable);
  return (
    <div className={`p-4 border rounded-xl transition-all ${
      writable ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-red-50/50 border-red-200'
    }`} data-status={writable ? 'ok' : 'error'}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
          <HardDrive size={18} className={writable ? 'text-emerald-600' : 'text-red-600'} />
          <span>ذخیره‌سازی پرونده‌ها</span>
        </div>
        {writable ? (
          <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 size={12} /> قابل نوشتن
          </span>
        ) : (
          <span className="bg-red-100 text-red-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <XCircle size={12} /> خطای دسترسی
          </span>
        )}
      </div>
      {locations.length === 0 && (
        <p className="text-xs text-slate-700 dark:text-slate-300" role="status">وضعیت پوشه‌های ذخیره‌سازی خوانده نشد.</p>
      )}
      <ul className="space-y-2 text-xs">
        {locations.map(location => (
          <li key={location.kind} data-kind={location.kind} data-writable={location.writable ? 'yes' : 'no'}>
            <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
              {location.writable
                ? <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                : <XCircle size={12} className="text-rose-600 shrink-0" />}
              <span>{STORAGE_LOCATION_LABELS[location.kind] ?? location.kind}</span>
            </div>
            <p className={location.writable ? 'text-slate-600 dark:text-slate-300' : 'text-rose-700 font-bold'}>{location.message}</p>
            <p className="text-[10px] text-slate-500 truncate" dir="ltr" title={location.path}>{location.path}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
