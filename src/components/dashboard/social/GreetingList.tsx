import type { BirthdayGreetingView } from '../../../lib/social/birthdays';
import { BIRTHDAY_REACTION_EMOJI, BIRTHDAY_REACTION_LABELS, BIRTHDAY_REACTIONS } from '../../../lib/social/birthdays';
import { formatPersianNumber } from '../../../utils';
import { ColleagueAvatar } from './ColleagueAvatar';

/** v10.2 package 9: the reactions of a birthday counted by kind, and the messages with their senders */
export function GreetingList({ greetings }: { greetings: BirthdayGreetingView[] }) {
  if (greetings.length === 0) return null;
  const counts = BIRTHDAY_REACTIONS
    .map(reaction => ({ reaction, count: greetings.filter(g => g.reaction === reaction).length }))
    .filter(r => r.count > 0);
  const messages = greetings.filter(g => g.message.trim() !== '');
  return (
    <div className="space-y-2">
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {counts.map(({ reaction, count }) => (
            <span
              key={reaction}
              className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100 text-xs text-slate-700"
              title={BIRTHDAY_REACTION_LABELS[reaction]}
            >
              <span aria-hidden="true">{BIRTHDAY_REACTION_EMOJI[reaction]}</span>
              <span className="sr-only">{BIRTHDAY_REACTION_LABELS[reaction]}</span>
              <span className="mr-1">{formatPersianNumber(count)}</span>
            </span>
          ))}
        </div>
      )}
      {messages.length > 0 && (
        <ul className="space-y-1.5">
          {messages.map(g => (
            <li key={g.id} className="flex items-start gap-2 text-xs">
              <ColleagueAvatar name={g.senderName} avatarUrl={g.senderAvatarUrl} size={24} />
              <p className="bg-slate-50 rounded-xl px-2.5 py-1.5 text-slate-700 leading-6">
                <span className="font-bold text-slate-800 ml-1">{g.mine ? 'شما' : g.senderName}:</span>
                {g.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
