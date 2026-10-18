import { useEffect, useId, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import type { BirthdayReaction, ColleagueBirthday } from '../../../lib/social/birthdays';
import { BIRTHDAY_REACTION_EMOJI, BIRTHDAY_REACTION_LABELS, BIRTHDAY_REACTIONS, GREETING_MESSAGE_MAX } from '../../../lib/social/birthdays';
import { useDeleteGreetingMutation, useSaveGreetingMutation } from '../../../hooks/queries/useSocialQueries';
import { useOnlineStatus } from '../../../lib/pwa/useOnlineStatus';
import { OFFLINE_SUBMIT_TITLE } from '../../../lib/pwa/phoneLayout';
import { errorMessageOf, formatPersianNumber } from '../../../utils';

/**
 * v10.2 package 9: the viewer's own reaction and short message on a colleague's birthday. A reaction is saved at once;
 * the message has its own send button; the viewer edits or removes only their own greeting.
 */
export function GreetingComposer({ birthday }: { birthday: ColleagueBirthday }) {
  const mine = birthday.greetings.find(g => g.mine) ?? null;
  const [message, setMessage] = useState(mine?.message ?? '');
  const [error, setError] = useState('');
  const save = useSaveGreetingMutation();
  const remove = useDeleteGreetingMutation();
  const online = useOnlineStatus();
  const fieldId = useId();
  const busy = save.isPending || remove.isPending;

  useEffect(() => { setMessage(mine?.message ?? ''); }, [mine?.message]);

  const send = async (reaction: BirthdayReaction | null, text: string) => {
    setError('');
    try {
      if (reaction === null && text.trim() === '') {
        if (mine) await remove.mutateAsync(birthday.personnelId);
        return;
      }
      await save.mutateAsync({ personnelId: birthday.personnelId, reaction, message: text.trim() });
    } catch (err) {
      setError(errorMessageOf(err));
    }
  };

  const toggleReaction = (reaction: BirthdayReaction) => {
    void send(mine?.reaction === reaction ? null : reaction, mine?.message ?? '');
  };

  const removeMine = async () => {
    setError('');
    try {
      await remove.mutateAsync(birthday.personnelId);
      setMessage('');
    } catch (err) {
      setError(errorMessageOf(err));
    }
  };

  const disabledTitle = online ? undefined : OFFLINE_SUBMIT_TITLE;
  const messageChanged = message.trim() !== (mine?.message ?? '').trim();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`واکنش شما به تولد ${birthday.name}`}>
        {BIRTHDAY_REACTIONS.map(reaction => {
          const chosen = mine?.reaction === reaction;
          return (
            <button
              key={reaction}
              type="button"
              aria-pressed={chosen}
              aria-label={BIRTHDAY_REACTION_LABELS[reaction]}
              title={disabledTitle ?? BIRTHDAY_REACTION_LABELS[reaction]}
              disabled={busy || !online}
              onClick={() => toggleReaction(reaction)}
              className={`w-11 h-11 rounded-xl text-lg border transition-colors disabled:opacity-50 ${
                chosen ? 'bg-amber-100 border-amber-300' : 'bg-white border-slate-200 hover:bg-amber-50'
              }`}
            >
              <span aria-hidden="true">{BIRTHDAY_REACTION_EMOJI[reaction]}</span>
            </button>
          );
        })}
        {mine && (
          <button
            type="button"
            onClick={() => { void removeMine(); }}
            disabled={busy || !online}
            title={disabledTitle}
            className="mr-auto px-2.5 h-11 rounded-xl text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>حذف تبریک من</span>
          </button>
        )}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); void send(mine?.reaction ?? null, message); }}
      >
        <label htmlFor={fieldId} className="sr-only">پیام تبریک برای {birthday.name}</label>
        <input
          id={fieldId}
          type="text"
          value={message}
          maxLength={GREETING_MESSAGE_MAX}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="پیام کوتاه تبریک…"
          className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
        <button
          type="submit"
          disabled={busy || !online || !messageChanged || (message.trim() === '' && !mine?.reaction)}
          title={disabledTitle}
          className="h-11 px-3 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50"
        >
          <Send size={14} aria-hidden="true" />
          <span>{mine?.message ? 'ویرایش پیام' : 'فرستادن'}</span>
        </button>
      </form>
      <p className="text-[11px] text-slate-400">
        {formatPersianNumber(message.length)} از {formatPersianNumber(GREETING_MESSAGE_MAX)} نویسه
      </p>
      {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
