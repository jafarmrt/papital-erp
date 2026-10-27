import { useId } from 'react';
import { CalendarClock, Tag, Barcode } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { confirmAction } from '../ConfirmDialogHost';
import { useHasPermission } from '../../contexts/AuthContext';
import { useSetWcPriceListMutation, useSetWcSkuRenameMutation } from '../../hooks/queries/useWooCatalogQueries';
import {
  fieldRunText, PRICE_PUSH_ENABLE_CONFIRM, siteCurrencyLabel, SKU_RENAME_ENABLE_CONFIRM, WC_NIGHTLY_HOUR, type WcFieldPushView, type WcShopSyncView,
} from '../../lib/woocommerce/wcShopSync';
import { permissionDefinition } from '../../lib/permissions/permissionCatalog';
import { formatPersianDateTime, formatPersianNumber, getErrorMessage } from '../../utils';
import { WcItemList } from './WcCatalogLists';
import { WcDriftList, WcPriceSkipList } from './WcShopSyncLists';

/**
 * 10.2 package 6 (D-04 part C): «ارسال خودکار قیمت», «تغییر خودکار کد در سایت» and the nightly re-read. Both sends are off
 * by default; each runs once a minute while on, and the nightly re-read runs while any automatic send is on.
 */
function FieldRun({ label, view }: { label: string; view: WcFieldPushView }) {
  const run = view.lastRun;
  const tone = run?.status === 'failed' ? 'text-rose-700' : run?.status === 'partial' ? 'text-amber-700' : 'text-slate-700';
  return (
    <div className="text-xs space-y-1">
      <div className={tone}>
        <span className="font-medium text-slate-700">{label}: </span>
        {run?.at && `${formatPersianDateTime(run.at)} `}{fieldRunText(run)}
      </div>
      {view.failedRuns > 0 && view.nextAttemptAt && (
        <p className="text-amber-800">
          {formatPersianNumber(view.failedRuns)} بار پیاپی ناموفق بود؛ تلاش بعدی از {formatPersianDateTime(view.nextAttemptAt)}.
        </p>
      )}
    </div>
  );
}

/** review N-2: a muted line naming the second key an action of this tab needs */
function MissingKeyNote({ permission, action }: { permission: string; action: string }) {
  return <p className="text-xs text-slate-500">{action} مجوز «{permissionDefinition(permission)?.title ?? permission}» را هم می‌خواهد.</p>;
}

function PriceSection({ view, canManage, canChoose }: { view: WcShopSyncView; canManage: boolean; canChoose: boolean }) {
  const setPriceList = useSetWcPriceListMutation();
  const selectId = useId();
  const onChange = async (title: string) => {
    if (title && !(await confirmAction({
      title: 'ارسال خودکار قیمت', message: PRICE_PUSH_ENABLE_CONFIRM(title), confirmText: 'روشن شود', cancelText: 'انصراف',
    }))) return;
    try {
      const res = await setPriceList.mutateAsync(title);
      toast.success(res.message || 'فهرست قیمت فروشگاه ذخیره شد', { duration: 8000 });
    } catch (err) {
      toast.error(getErrorMessage(err) || 'فهرست قیمت فروشگاه ذخیره نشد', { duration: 10000 });
    }
  };
  // review N-3: without the price key the list can still be turned off, never changed to another list
  const offered = canChoose ? view.priceLists : [];
  const lists = offered.includes(view.priceList) || !view.priceList ? offered : [view.priceList, ...offered];
  return (
    <section className="space-y-2" aria-label="ارسال خودکار قیمت">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={selectId} className="text-xs font-bold text-indigo-950 flex items-center gap-2">
          <Tag size={15} className="text-indigo-600" /> ارسال خودکار قیمت از فهرست
        </label>
        <select
          id={selectId}
          value={view.priceList}
          disabled={!canManage || setPriceList.isPending}
          onChange={e => { void onChange(e.target.value); }}
          className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white disabled:opacity-60"
        >
          <option value="">خاموش (قیمتی فرستاده نمی‌شود)</option>
          {lists.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {view.siteCurrency && (
          <span className="text-xs text-slate-600">
            واحد پول سایت: {siteCurrencyLabel(view.siteCurrency)}
            {view.siteDecimals !== null && `، اعشار سایت: ${formatPersianNumber(view.siteDecimals)}`}
          </span>
        )}
      </div>
      {canManage && !canChoose && <MissingKeyNote permission="products.edit_price" action="برگزیدن فهرست قیمت" />}
      {view.priceListMissing && (
        <p className="text-xs text-rose-700">فهرست «{view.priceList}» دیگر در تنظیمات قیمت‌گذاری نیست و قیمتی فرستاده نمی‌شود؛ فهرست دیگری برگزینید.</p>
      )}
      <p className="text-xs text-slate-600 leading-relaxed">
        قیمت فعال فهرست برگزیده هر دقیقه به «قیمت عادی» محصولات وصل‌شده می‌رود، فقط وقتی با قیمت سایت فرق دارد. قیمت حراج سایت دست نمی‌خورد.
        قیمت عادی‌ای که در سایت با دست عوض شود، تا وقتی این ارسال روشن است دوباره با قیمت فهرست جایگزین می‌شود.
      </p>
      {view.price.enabled && <FieldRun label="آخرین ارسال قیمت" view={view.price} />}
      <WcPriceSkipList rows={view.price.skipped} total={view.price.skippedTotal} />
      <WcItemList
        title="محصولاتی که سایت قیمت آن‌ها را چند بار پیاپی نپذیرفت"
        hint="ارسال قیمت این محصولات تا بازخوانی شبانه بعدی متوقف است. خطا را در سایت بررسی کنید."
        rows={view.price.stopped} total={view.price.stoppedTotal} tone="rose"
      />
    </section>
  );
}

function SkuSection({ view, canManage, canEnable }: { view: WcShopSyncView; canManage: boolean; canEnable: boolean }) {
  const setSkuRename = useSetWcSkuRenameMutation();
  const sku = view.sku;
  const onSwitch = async () => {
    const enabled = !sku.enabled;
    if (enabled && !(await confirmAction({
      title: 'تغییر خودکار کد در سایت', message: SKU_RENAME_ENABLE_CONFIRM(sku.pending), confirmText: 'روشن شود', cancelText: 'انصراف',
    }))) return;
    try {
      const res = await setSkuRename.mutateAsync(enabled);
      toast.success(res.message || (enabled ? 'تغییر خودکار کد روشن شد' : 'تغییر خودکار کد خاموش شد'));
    } catch (err) {
      toast.error(getErrorMessage(err) || 'تغییر خودکار کد ذخیره نشد', { duration: 10000 });
    }
  };
  return (
    <section className="space-y-2 border-t border-indigo-50 pt-2" aria-label="تغییر خودکار کد در سایت">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-indigo-950 flex items-center gap-2">
          <Barcode size={15} className="text-indigo-600" />
          تغییر خودکار کد در سایت: {sku.enabled ? <span className="text-emerald-700">روشن</span> : <span className="text-slate-600">خاموش</span>}
        </div>
        {canManage && (sku.enabled || canEnable) && (
          <button
            type="button"
            onClick={() => { void onSwitch(); }}
            disabled={setSkuRename.isPending}
            className={`${sku.enabled ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-700 hover:bg-emerald-800'} text-white font-medium py-1.5 px-3 rounded-lg text-xs disabled:opacity-50`}
          >
            {sku.enabled ? 'خاموش کردن' : 'روشن کردن'}
          </button>
        )}
      </div>
      {canManage && !canEnable && !sku.enabled && <MissingKeyNote permission="products.change_code" action="روشن کردن تغییر خودکار کد" />}
      <p className="text-xs text-slate-600 leading-relaxed">
        پس از «تغییر کد» یک کالا، شناسه محصول (SKU) همان محصول در سایت هم به کد تازه تغییر می‌کند.
        {sku.pending > 0 && ` کد ${formatPersianNumber(sku.pending)} محصول در سایت هنوز کد قدیم کالاست${sku.enabled ? ' و از دقیقه بعد تغییر می‌کند' : ''}.`}
      </p>
      {sku.enabled && <FieldRun label="آخرین تغییر کد" view={sku} />}
      <WcItemList
        title="محصولاتی که سایت کد تازه آن‌ها را چند بار پیاپی نپذیرفت"
        hint="شاید محصول دیگری در سایت همین کد را دارد. پس از رفع، بازخوانی شبانه دوباره امکان تلاش می‌دهد."
        rows={sku.stopped} total={sku.stoppedTotal} tone="rose"
      />
    </section>
  );
}

/**
 * `canManage` is the tab's `woocommerce.manage`, which turns either send off; choosing a price list also needs
 * `products.edit_price` and turning the SKU rename on `products.change_code`, the keys their routes ask (reviews M-3, N-3)
 */
export function WcShopSyncPanel({ view, canManage }: { view: WcShopSyncView; canManage: boolean }) {
  const canPrice = useHasPermission('products.edit_price');
  const canSku = useHasPermission('products.change_code');
  const nightly = view.lastNightly;
  return (
    <div className="bg-white border border-indigo-100 rounded-lg p-3 space-y-3" aria-label="ارسال قیمت، تغییر کد و بازخوانی شبانه">
      <PriceSection view={view} canManage={canManage} canChoose={canManage && canPrice} />
      <SkuSection view={view} canManage={canManage} canEnable={canManage && canSku} />
      <section className="space-y-2 border-t border-indigo-50 pt-2" aria-label="بازخوانی شبانه">
        <div className="text-xs font-bold text-indigo-950 flex items-center gap-2">
          <CalendarClock size={15} className="text-indigo-600" /> بازخوانی شبانه
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          تا وقتی یکی از ارسال‌های خودکار روشن است، هر شب از ساعت {formatPersianNumber(WC_NIGHTLY_HOUR)} محصولات سایت دوباره خوانده و ناهمخوانی‌ها فهرست می‌شود.
        </p>
        <div className={`text-xs ${nightly?.status === 'failed' ? 'text-rose-700' : 'text-slate-700'}`}>
          <span className="font-medium text-slate-700">آخرین بازخوانی شبانه: </span>
          {nightly?.at
            ? `${formatPersianDateTime(nightly.at)} ${nightly.status === 'failed' ? `(ناموفق) ${nightly.error}` : `(${formatPersianNumber(view.differencesTotal)} ناهمخوانی)`}`
            : 'هنوز انجام نشده'}
        </div>
        <WcDriftList rows={view.differences} total={view.differencesTotal} siteCurrency={view.differencesCurrency} />
      </section>
    </div>
  );
}
