import { useEffect, useId, useState } from 'react';
import { Cake, Users } from 'lucide-react';
import { useSaveSocialPreferencesMutation, useSocialPreferencesQuery } from '../../../hooks/queries/useSocialQueries';
import { errorMessageOf } from '../../../utils';

/**
 * v10.2 package 9: the profile tab «پیشخوان گروهی». Each person decides whether colleagues see their birthday (day and
 * month only, on their personnel record) and whether they appear as «برخط است» / «امروز آمده». Both are on by default.
 */
export function SocialPreferencesPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { data, isLoading, isError } = useSocialPreferencesQuery();
  const save = useSaveSocialPreferencesMutation();
  const [error, setError] = useState('');
  const birthdayId = useId();
  const presenceId = useId();

  useEffect(() => { onBusyChange?.(save.isPending); }, [save.isPending, onBusyChange]);

  const change = async (input: { showBirthday?: boolean; showPresence?: boolean }) => {
    setError('');
    try {
      await save.mutateAsync(input);
    } catch (err) {
      setError(errorMessageOf(err));
    }
  };

  if (isLoading) return <p className="text-xs text-slate-500">در حال بارگذاری…</p>;
  if (isError || !data) return <p className="text-xs text-rose-600" role="alert">گزینه‌های پیشخوان گروهی خوانده نشد. دوباره باز کنید.</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600 leading-6">
        پیشخوان گروهی تولد همکاران و حضور امروزشان را نشان می‌دهد. هیچ مبلغی آنجا نیست و چیزی بیرون از برنامه فرستاده نمی‌شود.
      </p>

      <div className="rounded-2xl border border-slate-200 p-4 space-y-1.5">
        <label htmlFor={birthdayId} className="flex items-center gap-2 text-sm font-bold text-slate-800 cursor-pointer">
          <input
            id={birthdayId}
            type="checkbox"
            className="w-5 h-5"
            checked={data.showBirthday === true}
            disabled={data.showBirthday === null || save.isPending}
            onChange={(e) => { void change({ showBirthday: e.target.checked }); }}
          />
          <Cake className="w-4 h-4 text-amber-500" aria-hidden="true" />
          روز تولدم به همکاران نشان داده شود
        </label>
        <p className="text-[11px] text-slate-500 leading-5 pr-7">
          {data.showBirthday === null
            ? 'حساب شما به پرونده پرسنلی وصل نیست؛ تولد فقط از پرونده پرسنلی خوانده می‌شود.'
            : 'فقط روز و ماه دیده می‌شود، هرگز سال یا سن. اگر خاموش باشد، تبریک روز تولد را فقط خودتان می‌بینید.'}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4 space-y-1.5">
        <label htmlFor={presenceId} className="flex items-center gap-2 text-sm font-bold text-slate-800 cursor-pointer">
          <input
            id={presenceId}
            type="checkbox"
            className="w-5 h-5"
            checked={data.showPresence}
            disabled={save.isPending}
            onChange={(e) => { void change({ showPresence: e.target.checked }); }}
          />
          <Users className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          «برخط است» و «امروز آمده» برای من نشان داده شود
        </label>
        <p className="text-[11px] text-slate-500 leading-5 pr-7">
          همکاران فقط می‌بینند که امروز آمده‌اید یا در پنج دقیقه گذشته کار کرده‌اید؛ صفحه‌ای که در آن هستید هرگز دیده نمی‌شود.
        </p>
      </div>

      {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
