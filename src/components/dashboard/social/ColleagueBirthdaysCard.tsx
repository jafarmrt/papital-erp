import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Cake } from 'lucide-react';
import type { ColleagueBirthday } from '../../../lib/social/birthdays';
import { BIRTHDAY_WINDOW_DAYS, daysAwayLabel } from '../../../lib/social/birthdays';
import { formatPersianNumber } from '../../../utils';
import { ColleagueAvatar } from './ColleagueAvatar';
import { GreetingComposer } from './GreetingComposer';
import { GreetingList } from './GreetingList';

/** `?birthday=<personnel id>-<year>` of a bell notification: the row it points to */
function linkedPersonnelId(param: string | null): number | null {
  const id = Number((param ?? '').split('-')[0]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function BirthdayRow({ birthday, highlighted }: { birthday: ColleagueBirthday; highlighted: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);
  return (
    <li
      ref={ref}
      className={`rounded-2xl p-3 border ${birthday.isToday ? 'bg-amber-50/60 border-amber-100' : 'bg-white border-slate-100'} ${
        highlighted ? 'ring-2 ring-amber-400' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <ColleagueAvatar name={birthday.name} avatarUrl={birthday.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 truncate">
            {birthday.isMine ? `${birthday.name} (شما)` : birthday.name}
          </p>
          <p className="text-xs text-slate-500">{birthday.label}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${birthday.isToday ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
          {daysAwayLabel(birthday.daysAway)}
        </span>
      </div>
      {birthday.isToday && (
        <div className="mt-3 space-y-3">
          <GreetingList greetings={birthday.greetings} />
          {!birthday.isMine && <GreetingComposer birthday={birthday} />}
        </div>
      )}
    </li>
  );
}

/**
 * v10.2 package 9: colleagues' birthdays today and in the next seven days, the day and month only (never the year or
 * the age); today's birthdays take reactions and short greetings.
 */
export function ColleagueBirthdaysCard({ birthdays, loading }: { birthdays: ColleagueBirthday[]; loading: boolean }) {
  const [params] = useSearchParams();
  const linked = linkedPersonnelId(params.get('birthday'));
  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5" aria-labelledby="colleague-birthdays-title">
      <header className="flex items-center gap-2 mb-4">
        <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center" aria-hidden="true">
          <Cake size={18} />
        </span>
        <div>
          <h2 id="colleague-birthdays-title" className="text-sm font-extrabold text-slate-800">تولد همکاران</h2>
          <p className="text-[11px] text-slate-500">امروز و {formatPersianNumber(BIRTHDAY_WINDOW_DAYS)} روز آینده</p>
        </div>
      </header>
      {loading && birthdays.length === 0 ? (
        <p className="text-xs text-slate-500">در حال بارگذاری…</p>
      ) : birthdays.length === 0 ? (
        <p className="text-xs text-slate-500">در این روزها تولد هیچ همکاری نیست.</p>
      ) : (
        <ul className="space-y-2.5">
          {birthdays.map(b => (
            <BirthdayRow key={b.personnelId} birthday={b} highlighted={linked === b.personnelId} />
          ))}
        </ul>
      )}
    </section>
  );
}
