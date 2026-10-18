import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useDismissWhatsNewMutation, useWhatsNewQuery } from '../../../hooks/queries/useSocialQueries';
import { errorMessageOf, toPersianDigits } from '../../../utils';

/**
 * v10.2 package 9: «تازه‌های این نسخه», the current version's changelog entry (its title and first lines); each user
 * closes it for themselves, and it comes back with the next version.
 */
export function WhatsNewCard() {
  const { data } = useWhatsNewQuery();
  const dismiss = useDismissWhatsNewMutation();
  const [error, setError] = useState('');
  if (!data || data.dismissed) return null;

  const close = async () => {
    setError('');
    try {
      await dismiss.mutateAsync(data.version);
    } catch (err) {
      setError(errorMessageOf(err));
    }
  };

  return (
    <section className="rounded-3xl p-5 bg-indigo-50/70 border border-indigo-100 shadow-xs" aria-labelledby="whats-new-title">
      <header className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-white text-indigo-500 flex items-center justify-center shrink-0" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="whats-new-title" className="text-sm font-extrabold text-slate-800">
            تازه‌های این نسخه <span className="font-normal text-slate-500">({toPersianDigits(data.version)})</span>
          </h2>
          <p className="text-xs text-slate-700 mt-1 font-bold">{data.title}</p>
        </div>
        <button
          type="button"
          onClick={() => { void close(); }}
          disabled={dismiss.isPending}
          aria-label="بستن تازه‌های این نسخه"
          title="دیدم، تا نسخه بعد نشان نده"
          className="w-9 h-9 rounded-xl text-slate-500 hover:bg-white flex items-center justify-center disabled:opacity-50"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {data.lines.length > 0 && (
        <ul className="mt-3 space-y-1.5 list-disc pr-5 text-xs text-slate-600 leading-6">
          {data.lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {error && <p className="text-xs text-rose-600 mt-2" role="alert">{error}</p>}
    </section>
  );
}
