import { useEffect } from 'react';
import { LogOut, MonitorSmartphone, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCloseManySessionsMutation, useCloseSessionMutation, useUserSessionsQuery } from '../../hooks/queries/useUserSessionQueries';
import { confirmAction } from '../ConfirmDialogHost';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import type { UserSessionView } from '../../lib/auth/userSessions';

/**
 * 10.2 package 8 (D-07): the devices an account is signed in on. In the profile (`userId` null) the user closes one of
 * their other devices or all of them, and leaves this one with «خروج»; on the users page a holder of «مدیریت
 * کاربران» closes one device of another user (a worker's lost phone) or all of them.
 */
export function UserSessionsPanel({ userId = null, userName, onBusyChange }: {
  userId?: number | null;
  userName?: string;
  /** the window holding the panel keeps Esc and close off while a close is being sent */
  onBusyChange?: (busy: boolean) => void;
}) {
  const own = userId === null;
  const query = useUserSessionsQuery(userId);
  const closeOne = useCloseSessionMutation(userId);
  const closeMany = useCloseManySessionsMutation(userId);
  const busy = closeOne.isPending || closeMany.isPending;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const sessions = Array.isArray(query.data) ? query.data : [];
  const others = sessions.filter(s => !s.isCurrent);

  const handleClose = async (session: UserSessionView) => {
    const ok = await confirmAction({
      title: 'بستن دستگاه',
      message: `«${session.deviceLabel}» از حساب خارج شود؟ این دستگاه در درخواست بعدی‌اش به صفحهٔ ورود می‌رود.`,
      confirmText: 'بستن',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    closeOne.mutate(session.id, {
      onSuccess: () => toast.success('دستگاه از حساب خارج شد.'),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  const handleCloseMany = async () => {
    const ok = await confirmAction({
      title: own ? 'بستن دستگاه‌های دیگر' : 'خروج از همهٔ دستگاه‌ها',
      message: own
        ? 'همهٔ دستگاه‌های دیگر شما از حساب خارج شوند؟ همین دستگاه وارد می‌ماند.'
        : `${userName ? `«${userName}»` : 'این کاربر'} از همهٔ دستگاه‌هایش خارج شود؟`,
      confirmText: own ? 'بستن دستگاه‌های دیگر' : 'خروج از همه',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    closeMany.mutate(undefined, {
      onSuccess: (res) => toast.success(`${formatPersianNumber(res?.closedCount ?? 0)} دستگاه از حساب خارج شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <div className="space-y-4 text-sm" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <p className="text-slate-600 text-xs leading-6">
          {own
            ? 'دستگاه‌هایی که با حساب شما وارد شده‌اند. اگر دستگاهی را نمی‌شناسید یا گم شده است، آن را ببندید.'
            : 'دستگاه‌هایی که این کاربر با آن‌ها وارد شده است.'}
        </p>
        <button
          type="button"
          onClick={() => { void query.refetch(); }}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="به‌روزرسانی فهرست دستگاه‌ها"
          title="به‌روزرسانی"
        >
          <RefreshCw className={`w-4 h-4 ${query.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {query.isError ? (
        <p className="rounded-xl bg-red-50 text-red-700 p-3 text-xs">{errorMessageOf(query.error)}</p>
      ) : query.isLoading ? (
        <p className="text-slate-500 text-xs">در حال بارگذاری…</p>
      ) : sessions.length === 0 ? (
        <p className="text-slate-500 text-xs">هیچ دستگاهی وارد نیست.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map(session => (
            <li key={session.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              <MonitorSmartphone className="w-5 h-5 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="font-bold text-slate-800 truncate">
                  {session.deviceLabel}
                  {session.isCurrent && <span className="mr-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">همین دستگاه</span>}
                </p>
                <p className="text-xs text-slate-500">
                  آخرین استفاده: {formatPersianDateTime(session.lastSeenAt)} · ورود: {formatPersianDateTime(session.signedInAt)}
                </p>
                {session.ipAddress && <p className="text-xs text-slate-400">نشانی IP: <span dir="ltr">{session.ipAddress}</span></p>}
              </div>
              {!session.isCurrent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void handleClose(session); }}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 min-h-[44px] md:min-h-0"
                >
                  بستن
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(own ? others.length > 0 : sessions.length > 0) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => { void handleCloseMany(); }}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 min-h-[44px]"
        >
          <LogOut className="w-4 h-4" />
          {own ? 'بستن همهٔ دستگاه‌های دیگر' : 'خروج از همهٔ دستگاه‌ها'}
        </button>
      )}
    </div>
  );
}
