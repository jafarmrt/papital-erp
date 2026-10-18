import { Zap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { confirmAction } from '../ConfirmDialogHost';
import { useSetWcAutoPushMutation } from '../../hooks/queries/useWooCatalogQueries';
import { AUTO_PUSH_ENABLE_CONFIRM, type WcAutoPushView } from '../../lib/woocommerce/wcAutoPush';
import { formatPersianDateTime, formatPersianNumber, getErrorMessage } from '../../utils';
import { WcItemList } from './WcCatalogLists';

/**
 * 10.2 package 6 (D-04 part B): «ارسال خودکار موجودی». Off by default; while on, the server sends the changed stock of the
 * linked products once a minute, less the shop's open orders, and only to products whose stock tracking is on in the shop.
 * The switch, the last automatic run and the products it leaves out are shown here.
 */
export function WcAutoPushPanel({ view, canManage }: { view: WcAutoPushView; canManage: boolean }) {
  const setAutoPush = useSetWcAutoPushMutation();

  const onSwitch = async () => {
    const enabled = !view.enabled;
    if (enabled && !(await confirmAction({
      title: 'روشن کردن ارسال خودکار', message: AUTO_PUSH_ENABLE_CONFIRM, confirmText: 'روشن شود', cancelText: 'انصراف',
    }))) return;
    try {
      const res = await setAutoPush.mutateAsync(enabled);
      toast.success(res.message || (enabled ? 'ارسال خودکار روشن شد' : 'ارسال خودکار خاموش شد'));
    } catch (err) {
      toast.error(getErrorMessage(err) || 'تغییر ارسال خودکار انجام نشد', { duration: 10000 });
    }
  };

  const run = view.lastRun;
  return (
    <div className="bg-white border border-indigo-100 rounded-lg p-3 space-y-2" aria-label="ارسال خودکار موجودی">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-indigo-950 flex items-center gap-2">
          <Zap size={15} className="text-indigo-600" />
          ارسال خودکار موجودی: {view.enabled ? <span className="text-emerald-700">روشن</span> : <span className="text-slate-600">خاموش</span>}
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => { void onSwitch(); }}
            disabled={setAutoPush.isPending}
            className={`${view.enabled ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white font-medium py-1.5 px-3 rounded-lg text-xs disabled:opacity-50`}
          >
            {view.enabled ? 'خاموش کردن' : 'روشن کردن'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        هر دقیقه موجودی قابل فروش کالاهایی که تغییر کرده، منهای سفارش‌های باز سایت، به محصولات وصل‌شده فرستاده می‌شود. ردیابی
        موجودی هیچ محصولی در سایت خودکار روشن نمی‌شود.
      </p>
      <div className="text-xs text-slate-700">
        <span className="font-medium">آخرین ارسال خودکار: </span>
        {run?.at ? (
          <>
            {formatPersianDateTime(run.at)}{' '}
            {run.status === 'failed'
              ? <span className="text-rose-700">(ناموفق){run.error && ` ${run.error}`}</span>
              : <span className="text-emerald-700">({formatPersianNumber(Number(run.summary.syncedCount) || 0)} محصول به‌روز شد)</span>}
          </>
        ) : 'هنوز انجام نشده'}
      </div>
      {view.failedRuns > 0 && view.nextAttemptAt && (
        <p className="text-xs text-amber-800">
          {formatPersianNumber(view.failedRuns)} بار پیاپی ناموفق بود؛ تلاش بعدی از {formatPersianDateTime(view.nextAttemptAt)}.
        </p>
      )}
      <WcItemList
        title="محصولاتی که ردیابی موجودی آن‌ها در سایت خاموش است"
        hint="ارسال خودکار به این محصولات چیزی نمی‌فرستد. ردیابی موجودی را در سایت روشن کنید و محصولات را دوباره بازخوانی کنید، یا یک بار «ارسال موجودی همه کالاها» را بزنید."
        rows={view.untracked} total={view.untrackedTotal} tone="slate"
      />
      <WcItemList
        title="محصولاتی که ارسال خودکار آن‌ها پس از چند خطای پیاپی متوقف شد"
        hint="خطا را بررسی کنید؛ پس از یک ارسال دستی موفق، ارسال خودکار آن‌ها دوباره انجام می‌شود."
        rows={view.stopped} total={view.stoppedTotal} tone="rose"
      />
    </div>
  );
}
