import { useEffect, useRef } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRefreshWcCatalogMutation, useWcCatalogQuery } from '../../hooks/queries/useWooCatalogQueries';
import type { WcRunView } from '../../lib/woocommerce/wcCatalog';
import { formatPersianDateTime, formatPersianNumber, getErrorMessage } from '../../utils';
import { WcItemList, WcUnmatchedList } from './WcCatalogLists';

/**
 * 10.2 package 6 (D-04 part A, OBS-R2-83): the links between items and the shop's products. «بازخوانی محصولات سایت» reads
 * the shop's catalog once and links each product to the item its SKU finds; the stock push then goes through these links in
 * batches. Products and items left unlinked are listed here, never changed on the site.
 */

const RUN_STATUS_LABELS: Record<WcRunView['status'], string> = { ok: 'موفق', partial: 'با خطا در برخی کالاها', failed: 'ناموفق' };

function RunLine({ label, run }: { label: string; run: WcRunView | null }) {
  return (
    <div className="text-xs text-slate-700">
      <span className="font-medium">{label}: </span>
      {run?.at ? (
        <>
          {formatPersianDateTime(run.at)}{' '}
          <span className={run.status === 'ok' ? 'text-emerald-700' : 'text-rose-700'}>({RUN_STATUS_LABELS[run.status]})</span>
          {run.error && <span className="block text-rose-700">{run.error}</span>}
        </>
      ) : 'هنوز انجام نشده'}
    </div>
  );
}

export function WcCatalogPanel({ canManage, stockPushRunning }: { canManage: boolean; stockPushRunning: boolean }) {
  const catalog = useWcCatalogQuery();
  const refresh = useRefreshWcCatalogMutation();
  const { refetch } = catalog;
  // the bulk stock push of the same tab writes the links' push state: read it again when that push ends
  const wasPushing = useRef(stockPushRunning);
  useEffect(() => {
    if (wasPushing.current && !stockPushRunning) void refetch();
    wasPushing.current = stockPushRunning;
  }, [stockPushRunning, refetch]);

  const onRefresh = async () => {
    try {
      const res = await refresh.mutateAsync();
      if (res.success === false) toast.error(res.error || 'محصولات سایت خوانده نشد');
      else toast.success(res.message || 'محصولات سایت خوانده شد', { duration: 8000 });
    } catch (err) {
      toast.error(getErrorMessage(err) || 'محصولات سایت خوانده نشد', { duration: 12000 });
    }
  };

  const report = catalog.data;
  return (
    <section className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-5 space-y-3" aria-label="پیوند کالاها با محصولات سایت">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-bold text-indigo-950 text-sm flex items-center gap-2">
          <Link2 size={17} className="text-indigo-600" />
          پیوند کالاها با محصولات سایت
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => { void onRefresh(); }}
            disabled={refresh.isPending || stockPushRunning}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg text-xs flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : undefined} />
            {refresh.isPending ? 'در حال خواندن محصولات سایت…' : 'بازخوانی محصولات سایت'}
          </button>
        )}
      </div>
      <p className="text-xs text-indigo-900 leading-relaxed">
        هر محصول سایت با شناسه محصول (SKU) خود به کالای هم‌کد در برنامه وصل می‌شود (کد پیشین کالا هم پذیرفته است) و موجودی فقط به
        محصولات وصل‌شده، گروهی و صدتایی فرستاده می‌شود. پس از افزودن یا تغییر محصول در سایت دوباره بازخوانی کنید.
      </p>
      {catalog.isError ? (
        <p role="alert" className="text-xs text-rose-700">وضعیت پیوندها خوانده نشد: {getErrorMessage(catalog.error)}</p>
      ) : !report ? (
        <p className="text-xs text-slate-500">در حال خواندن…</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="text-xs text-slate-700">
              <span className="font-medium">کالاهای وصل به سایت: </span>{formatPersianNumber(report.linkedCount)}
            </div>
            <RunLine label="آخرین بازخوانی" run={report.lastRefresh} />
            <RunLine label="آخرین ارسال موجودی" run={report.lastPush} />
          </div>
          {!report.refreshed && (
            <p className="text-xs text-amber-800">محصولات سایت هنوز خوانده نشده است؛ نخستین ارسال موجودی ابتدا آن‌ها را می‌خواند.</p>
          )}
          <div className="space-y-2">
            <WcItemList
              title="کالاهایی که ارسال موجودی آن‌ها شکست خورد"
              hint="موجودی این کالاها در سایت به‌روز نیست. خطا را بررسی و دوباره ارسال کنید."
              rows={report.failing} total={report.failingTotal} tone="rose"
            />
            <WcUnmatchedList rows={report.unmatched} total={report.unmatchedTotal} />
            <WcItemList
              title="محصولات نهایی برنامه که در سایت نیستند"
              hint="این کالاها محصولی با کد خود در سایت ندارند؛ در سایت چیزی ساخته یا تغییر داده نمی‌شود."
              rows={report.itemsNotOnSite} total={report.itemsNotOnSiteTotal} tone="slate"
            />
          </div>
        </>
      )}
    </section>
  );
}
