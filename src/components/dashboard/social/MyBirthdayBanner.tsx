import { PartyPopper } from 'lucide-react';
import type { BirthdaysAnswer } from '../../../lib/social/birthdays';
import { formatPersianNumber } from '../../../utils';
import { GreetingList } from './GreetingList';

/**
 * v10.2 package 9: the viewer's own birthday greeting, seen only by them (the answer says so only to its owner), with
 * the reactions and greetings colleagues left when the birthday is shown to them.
 */
export function MyBirthdayBanner({ answer, firstName }: { answer: BirthdaysAnswer; firstName: string }) {
  if (!answer.myBirthdayToday) return null;
  const mine = answer.birthdays.find(b => b.isMine && b.isToday);
  const greetings = mine?.greetings ?? [];
  return (
    <section
      className="rounded-3xl p-5 bg-gradient-to-l from-amber-100 via-rose-50 to-white border border-amber-200 shadow-xs"
      aria-labelledby="my-birthday-title"
    >
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-2xl bg-white text-amber-500 flex items-center justify-center shrink-0 shadow-xs" aria-hidden="true">
          <PartyPopper size={22} />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="my-birthday-title" className="text-base font-extrabold text-slate-800">
            {firstName ? `${firstName} عزیز، تولدتان مبارک!` : 'تولدتان مبارک!'}
          </h2>
          <p className="text-sm text-slate-600 leading-7">
            امیدواریم سالی پر از سلامتی و شادی پیش رو داشته باشید.
            {greetings.length > 0 && ` ${formatPersianNumber(greetings.length)} همکار به شما تبریک گفته‌اند.`}
          </p>
        </div>
      </div>
      {greetings.length > 0 && <div className="mt-3"><GreetingList greetings={greetings} /></div>}
    </section>
  );
}
