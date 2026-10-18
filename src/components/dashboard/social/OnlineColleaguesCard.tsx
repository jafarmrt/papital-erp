import { Users } from 'lucide-react';
import type { PresenceColleague } from '../../../lib/social/presence';
import { PRESENCE_LABELS } from '../../../lib/social/presence';
import { formatPersianNumber } from '../../../utils';
import { ColleagueAvatar } from './ColleagueAvatar';

/**
 * v10.2 package 9: colleagues who are online now (a request in the last five minutes) or came in today; never the
 * page they are on. A colleague who turned presence off is not listed.
 */
export function OnlineColleaguesCard({ colleagues, loading }: { colleagues: PresenceColleague[]; loading: boolean }) {
  const online = colleagues.filter(c => c.status === 'online').length;
  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5" aria-labelledby="online-colleagues-title">
      <header className="flex items-center gap-2 mb-4">
        <span className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center" aria-hidden="true">
          <Users size={18} />
        </span>
        <div>
          <h2 id="online-colleagues-title" className="text-sm font-extrabold text-slate-800">همکاران امروز</h2>
          <p className="text-[11px] text-slate-500">{formatPersianNumber(online)} نفر برخط</p>
        </div>
      </header>
      {loading && colleagues.length === 0 ? (
        <p className="text-xs text-slate-400">در حال بارگذاری…</p>
      ) : colleagues.length === 0 ? (
        <p className="text-xs text-slate-500">هنوز همکار دیگری امروز نیامده است.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {colleagues.map(c => (
            <li key={c.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-50">
              <span className="relative">
                <ColleagueAvatar name={c.name} avatarUrl={c.avatarUrl} size={32} />
                <span
                  className={`absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full border-2 border-white ${
                    c.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-800 truncate">{c.name}</span>
                <span className={`block text-[11px] ${c.status === 'online' ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {PRESENCE_LABELS[c.status]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
