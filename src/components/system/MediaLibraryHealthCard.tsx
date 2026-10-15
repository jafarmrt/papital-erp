import { AlertTriangle, CheckCircle2, HelpCircle, Images } from 'lucide-react';
import { formatPersianNumber } from '../../utils/persianNumber';
import { MEDIA_REBUILD_LIGHT_COMMAND, formatByteSize, type MediaLibraryHealth } from '../../lib/system/mediaLibraryHealth';

/**
 * v10.1.3 (N-05 PR 4): کارت کتابخانه تصاویر در صفحه سلامت؛ شمار پرونده‌ها، حجم اصل و نسخه‌های سبک، فضای آزاد دیسک و
 * تصویرهایی که نسخه سبکشان باید دوباره ساخته شود. پاسخ ناخوانده «نامعلوم» نشان داده می‌شود، نه صفر.
 */
export function MediaLibraryHealthCard({ media }: { media?: MediaLibraryHealth }) {
  const status = media?.status ?? 'unknown';
  const tone = status === 'ok'
    ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
    : status === 'warning' ? 'bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800' : 'bg-slate-50 border-slate-200 dark:bg-gray-900/40 dark:border-gray-700';
  const size = (bytes: number | null | undefined) => (bytes === null || bytes === undefined ? 'نامعلوم' : formatByteSize(bytes));
  const count = (n: number | null | undefined) => (n === null || n === undefined ? 'نامعلوم' : formatPersianNumber(n));
  const messages = Array.isArray(media?.messages) && media.messages.length > 0 ? media.messages : ['وضعیت کتابخانه تصاویر خوانده نشد.'];
  return (
    <div className={`p-4 border rounded-xl transition-all ${tone}`} data-status={status} data-testid="media-library-health">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
          <Images size={18} className={status === 'ok' ? 'text-emerald-600' : status === 'warning' ? 'text-amber-600' : 'text-slate-500'} />
          <span>کتابخانه تصاویر</span>
        </div>
        {status === 'ok' && (
          <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 size={12} /> سالم
          </span>
        )}
        {status === 'warning' && (
          <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <AlertTriangle size={12} /> نیازمند رسیدگی
          </span>
        )}
        {status === 'unknown' && (
          <span className="bg-slate-200 text-slate-700 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <HelpCircle size={12} /> نامعلوم
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
        <dt>پرونده‌ها</dt>
        <dd data-field="files">{count(media?.fileCount)} ({count(media?.imageCount)} عکس، {count(media?.videoCount)} فیلم)</dd>
        <dt>حجم اصل پرونده‌ها</dt>
        <dd data-field="original">{size(media?.originalBytes)}</dd>
        <dt>حجم نسخه‌های سبک و کوچک</dt>
        <dd data-field="light">{media?.lightBytes == null || media?.thumbBytes == null ? 'نامعلوم' : formatByteSize(media.lightBytes + media.thumbBytes)}</dd>
        <dt>فضای آزاد دیسک</dt>
        <dd data-field="disk">{media?.diskFreeBytes == null ? 'نامعلوم' : `${formatByteSize(media.diskFreeBytes)} از ${size(media.diskTotalBytes)}`}</dd>
      </dl>
      <ul className="mt-3 space-y-1 text-xs">
        {messages.map(message => (
          <li key={message} className={status === 'warning' ? 'text-amber-800 dark:text-amber-300 font-bold' : 'text-slate-600 dark:text-slate-300'}>{message}</li>
        ))}
      </ul>
      {((media?.lightFailedCount ?? 0) > 0 || (media?.lightMissingCount ?? 0) > 0) && (
        <p className="mt-2 text-[10px] text-slate-600 dark:text-slate-300" dir="ltr" data-technical>{MEDIA_REBUILD_LIGHT_COMMAND}</p>
      )}
      {media?.path && <p className="mt-2 text-[10px] text-slate-500 truncate" dir="ltr" title={media.path} data-technical>{media.path}</p>}
    </div>
  );
}
