import { useId, useState } from 'react';
import { KeyRound, MessageCircle, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { MESSENGER_LABELS, type Messenger, type MessengerBotView } from '../../lib/messenger/messengerLinks';
import { useMessengerAdminLinksQuery, useMessengerBotsQuery, useSaveBotTokenMutation } from '../../hooks/queries/useMessengerQueries';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';

/**
 * v10.1.38 (messenger notifications plan part 1, ت۱ الف): the settings tab «ربات‌های پیام‌رسان» of the system admin. The
 * token of each staff bot (made with the messenger's bot maker, separate from the server alert bots) is typed here, checked
 * by the server and stored encrypted; the field is always empty, because the server never sends the token back. Below,
 * who is linked to which messenger, without any chat id.
 */
function BotCard({ bot }: { bot: MessengerBotView }) {
  const fieldId = useId();
  const label = MESSENGER_LABELS[bot.messenger];
  const [token, setToken] = useState('');
  const save = useSaveBotTokenMutation();

  const submit = (messenger: Messenger, value: string) => {
    save.mutate({ messenger, token: value }, {
      onSuccess: (view) => {
        setToken('');
        toast.success(value ? `ربات ${label} ذخیره شد${view?.botUsername ? ` (@${view.botUsername})` : ''}.` : `ربات ${label} برداشته شد.`);
      },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <section aria-label={`ربات ${label}`} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <MessageCircle className="w-4 h-4 text-sky-600" />
          ربات {label} کارکنان
        </h3>
        {bot.configured ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">راه‌اندازی شده</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">راه‌اندازی نشده</span>
        )}
      </div>
      {bot.configured && (
        <p className="text-xs leading-6 text-slate-600">
          ربات <span dir="ltr">@{bot.botUsername}</span>، {formatPersianNumber(bot.activeLinks)} کاربر وصل
          {bot.updatedAt ? `، آخرین تغییر ${formatPersianDateTime(bot.updatedAt)}` : ''}.
        </p>
      )}
      {bot.configured && !bot.tokenReadable && (
        <p className="text-xs leading-6 text-rose-700">نشانه ذخیره‌شده با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ نشانه را دوباره وارد کنید.</p>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => { e.preventDefault(); if (token.trim()) submit(bot.messenger, token.trim()); }}
      >
        <label htmlFor={`${fieldId}-token`} className="block text-xs font-bold text-slate-700">
          {bot.configured ? 'نشانه تازه ربات (برای عوض کردن)' : 'نشانه ربات'}
        </label>
        <input
          id={`${fieldId}-token`}
          type="password"
          autoComplete="off"
          dir="ltr"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="۱۲۳۴۵۶:ABC…"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono"
        />
        <p className="text-xs leading-6 text-slate-500">
          نشانه را از سازنده ربات {label} بگیرید (ربات تازه، جدا از ربات هشدار سرور) و همین‌جا وارد کنید؛ آن را برای کسی نفرستید.
          اگر ربات دیگری جای ربات کنونی بنشیند، کارکنان باید دوباره وصل شوند.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending || !token.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            <KeyRound className="w-4 h-4" />
            {save.isPending ? 'در حال بررسی…' : 'بررسی و ذخیره'}
          </button>
          {bot.configured && (
            <button type="button" disabled={save.isPending} onClick={() => {
              void confirmAction({ title: `برداشتن ربات ${label}`, message: `با برداشتن ربات، دیگر پیامی در ${label} فرستاده نمی‌شود. ادامه می‌دهید؟`, confirmText: 'بله، برداشته شود' })
                .then(ok => { if (ok) submit(bot.messenger, ''); });
            }} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              <Trash2 className="w-4 h-4" />
              برداشتن ربات
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

export function MessengerBotsTab() {
  const bots = useMessengerBotsQuery();
  const links = useMessengerAdminLinksQuery();
  const botRows = Array.isArray(bots.data) ? bots.data : [];
  const linkRows = Array.isArray(links.data) ? links.data : [];

  if (bots.isLoading) return <p className="p-6 text-center text-xs text-slate-500">در حال بارگذاری…</p>;
  if (bots.isError) return <p className="p-6 text-center text-xs text-rose-700">{errorMessageOf(bots.error)}</p>;
  return (
    <div className="space-y-4 font-farsi text-right">
      <p className="text-xs leading-6 text-slate-600">
        هر کاربر یک بار از «نمایه ← پیام‌رسان» به ربات وصل می‌شود و از آن پس اعلان‌هایش در بله یا تلگرام هم می‌رسد. پیام‌ها مبلغ ندارند.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {botRows.map(bot => <BotCard key={bot.messenger} bot={bot} />)}
      </div>
      <section aria-label="کاربران وصل" className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
          <Users className="w-4 h-4 text-slate-600" />
          کاربران وصل
        </h3>
        {links.isError ? (
          <p className="text-xs text-rose-700">{errorMessageOf(links.error)}</p>
        ) : linkRows.length === 0 ? (
          <p className="text-xs text-slate-500">هنوز کسی وصل نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="p-2 text-right font-bold">کاربر</th>
                  <th className="p-2 text-right font-bold">پیام‌رسان</th>
                  <th className="p-2 text-right font-bold">وصل از</th>
                </tr>
              </thead>
              <tbody>
                {linkRows.map(row => (
                  <tr key={`${row.userId}-${row.messenger}`} className="border-t border-slate-100">
                    <td className="p-2">{row.userFullName} <span className="text-slate-400" dir="ltr">({row.username})</span></td>
                    <td className="p-2">{MESSENGER_LABELS[row.messenger]}</td>
                    <td className="p-2">{row.linkedAt ? formatPersianDateTime(row.linkedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
