import { useId } from 'react';
import { Bell } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMyMessengerPreferencesQuery, useSetMessengerPreferenceMutation } from '../../hooks/queries/useMessengerQueries';
import { errorMessageOf } from '../../utils';

/**
 * v10.1.41 (messenger notifications plan part 2, §2.3): «در پیام‌رسان هم بفرست» per notification category in the profile.
 * Every category is on by default; turning one off keeps it in the app's bell only. Each tick is saved at once and is
 * disabled while its answer is on the way.
 */
export function MessengerPreferencesList() {
  const baseId = useId();
  const query = useMyMessengerPreferencesQuery();
  const save = useSetMessengerPreferenceMutation();
  const rows = Array.isArray(query.data) ? query.data : [];

  if (query.isLoading) return <p className="text-xs text-slate-500">در حال بارگذاری…</p>;
  if (query.isError) return <p className="text-xs text-rose-700">{errorMessageOf(query.error)}</p>;
  return (
    <section aria-label="اعلان‌هایی که در پیام‌رسان هم می‌آید" className="rounded-2xl border border-slate-200 p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
        <Bell className="w-4 h-4 text-amber-600" />
        چه اعلان‌هایی در پیام‌رسان هم بیاید؟
      </h3>
      <p className="text-xs leading-6 text-slate-500">هر اعلانی که تیکش را بردارید فقط در زنگ برنامه می‌ماند.</p>
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const id = `${baseId}-${index}`;
          return (
            <li key={row.category} className="flex items-center gap-2">
              <input
                id={id}
                type="checkbox"
                className="h-5 w-5 rounded border-slate-300"
                checked={row.sendToMessenger}
                disabled={save.isPending}
                onChange={(e) => save.mutate(
                  { category: row.category, sendToMessenger: e.target.checked },
                  { onError: (err) => toast.error(errorMessageOf(err)) },
                )}
              />
              <label htmlFor={id} className="text-xs text-slate-700 min-h-[44px] md:min-h-0 flex items-center">{row.label}</label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
