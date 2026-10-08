import { Play, Wrench } from 'lucide-react';
import { confirmAction } from '../ConfirmDialogHost';
import { formatPersianNumber } from '../../utils';
import type { OutboxHealth } from '../../lib/system/subsystemHealth';

/**
 * v9.0.391 (TD-623، B01-43، تصمیم ت۸): دکمه‌های صف رویدادها. هر دکمه فقط وقتی نشان داده می‌شود که چیزی برای اجرای
 * دوباره هست و پیش از ارسال می‌پرسد «… دوباره اجرا شوند؟» با «اجرای دوباره / انصراف»؛ اجرای دوباره رویدادهای ناموفق
 * وبهوک طرف سوم، اعلان و گردش کار آن‌ها را هم دوباره اجرا می‌کند. پیش‌تر یک کلیک بی پرسش و حتی با صف خالی می‌فرستاد.
 */

export type EventQueueAction = 'requeue_dlq' | 'clear_stuck_outbox';

export const EVENT_QUEUE_CONFIRMATIONS: Readonly<Record<EventQueueAction, (count: number) => { title: string; message: string }>> = {
  requeue_dlq: count => ({
    title: 'اجرای دوباره رویدادهای ناموفق',
    message: `${formatPersianNumber(count)} رویداد ناموفق دوباره اجرا شوند؟ وبهوک‌ها، اعلان‌ها و گردش کارهای این رویدادها هم دوباره اجرا می‌شوند.`,
  }),
  clear_stuck_outbox: count => ({
    title: 'اجرای دوباره رویدادهای مانده',
    message: `${formatPersianNumber(count)} رویداد که بیش از پنج دقیقه در صف ارسال مانده‌اند دوباره اجرا شوند؟`,
  }),
};

export function EventQueueActions({ outbox, busy, onRun }: {
  outbox?: OutboxHealth;
  busy: boolean;
  onRun: (action: EventQueueAction) => void | Promise<void>;
}) {
  const failed = typeof outbox?.dlqCount === 'number' ? outbox.dlqCount : 0;
  const stuck = typeof outbox?.stuckCount === 'number' ? outbox.stuckCount : 0;
  if (failed === 0 && stuck === 0) return null;

  const run = async (action: EventQueueAction, count: number) => {
    const { title, message } = EVENT_QUEUE_CONFIRMATIONS[action](count);
    if (!(await confirmAction({ title, message, confirmText: 'اجرای دوباره', cancelText: 'انصراف' }))) return;
    await onRun(action);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-700">
      {failed > 0 && (
        <button
          type="button"
          onClick={() => void run('requeue_dlq', failed)}
          disabled={busy}
          className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors disabled:opacity-60"
        >
          <Wrench size={12} />
          <span>اجرای دوباره رویدادهای ناموفق</span>
        </button>
      )}
      {stuck > 0 && (
        <button
          type="button"
          onClick={() => void run('clear_stuck_outbox', stuck)}
          disabled={busy}
          className="bg-slate-100 hover:bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-gray-600 px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors disabled:opacity-60"
        >
          <Play size={12} />
          <span>اجرای دوباره رویدادهای مانده در صف ارسال</span>
        </button>
      )}
    </div>
  );
}
