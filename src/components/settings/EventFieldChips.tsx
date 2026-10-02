import type { EventFieldOption } from '../../lib/eventPayloadFields';

/**
 * v7.0.90 (TD-085 بند ۳): متغیرهای رویداد انتخاب‌شده. با onInsert هر متغیر با کلیک به متن پیام اضافه می‌شود؛
 * بدون آن فقط راهنمای نوشتن `{{مسیر}}` است.
 */
export function EventFieldChips({ fields, onInsert }: { fields: EventFieldOption[]; onInsert?: (path: string) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
      {fields.map((f) => {
        const content = (
          <>
            <span>{f.label}</span>
            <span className="font-mono text-indigo-400">{`{{${f.path}}}`}</span>
          </>
        );
        const className = 'inline-flex items-center gap-1 px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-indigo-200 dark:border-indigo-800';
        return onInsert ? (
          <button key={f.path} type="button" onClick={() => onInsert(f.path)} title="افزودن به متن پیام" className={`${className} hover:bg-indigo-100 dark:hover:bg-indigo-900/60`}>
            {content}
          </button>
        ) : (
          <span key={f.path} className={className}>{content}</span>
        );
      })}
    </div>
  );
}
