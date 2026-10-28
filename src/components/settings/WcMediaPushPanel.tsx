import { useId, useState } from 'react';
import { Image as ImageIcon, Tags } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { confirmAction } from '../ConfirmDialogHost';
import { useHasAnyPermission, useHasPermission } from '../../contexts/AuthContext';
import { useSetWcCollectionPushMutation, useSetWcImagePushMutation } from '../../hooks/queries/useWooCatalogQueries';
import { fieldRunText, type WcFieldPushView } from '../../lib/woocommerce/wcShopSync';
import {
  checkMediaBaseUrl, COLLECTION_PUSH_ENABLE_CONFIRM, IMAGE_PUSH_ENABLE_CONFIRM, type WcCollectionPushView, type WcImagePushView,
} from '../../lib/woocommerce/wcMediaPush';
import { permissionDefinition } from '../../lib/permissions/permissionCatalog';
import { formatPersianDateTime, formatPersianNumber, getErrorMessage } from '../../utils';
import { WcItemList } from './WcCatalogLists';

/**
 * v11 phase 6.5 (D-04 part D, decisions ت۴۴ to ت۴۶): «ارسال تصویر شاخص» and «ارسال کالکشن‌ها», both off by default. Turning
 * the image push on needs `media.manage` and the program's public address, turning the collection push on a key that edits
 * a product's collections; turning either off needs only `woocommerce.manage` (`canManage`).
 */
const MEDIA_INFO_KEYS = ['media.manage', 'products.edit'];

function RunLine({ label, view }: { label: string; view: WcFieldPushView }) {
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

function SwitchButton({ on, pending, onClick }: { on: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`${on ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-700 hover:bg-emerald-800'} text-white font-medium py-1.5 px-3 rounded-lg text-xs disabled:opacity-50`}
    >
      {on ? 'خاموش کردن' : 'روشن کردن'}
    </button>
  );
}

const keyTitle = (key: string) => permissionDefinition(key)?.title ?? key;

function ImageSection({ view, canManage, canEnable }: { view: WcImagePushView; canManage: boolean; canEnable: boolean }) {
  const setImagePush = useSetWcImagePushMutation();
  const inputId = useId();
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const checked = baseUrl.trim() ? checkMediaBaseUrl(baseUrl) : null;
  const onSwitch = async () => {
    const enabled = !view.enabled;
    if (enabled) {
      if (!checked || 'error' in checked) {
        toast.error(checked && 'error' in checked ? checked.error : 'نشانی عمومی برنامه را بنویسید.', { duration: 10000 });
        return;
      }
      if (!(await confirmAction({
        title: 'ارسال تصویر شاخص', message: IMAGE_PUSH_ENABLE_CONFIRM(view.pending), confirmText: 'روشن شود', cancelText: 'انصراف',
      }))) return;
    }
    try {
      const res = await setImagePush.mutateAsync(enabled && checked && 'url' in checked ? { enabled, mediaBaseUrl: checked.url } : { enabled });
      toast.success(res.message || (enabled ? 'ارسال تصویر شاخص روشن شد' : 'ارسال تصویر شاخص خاموش شد'));
    } catch (err) {
      toast.error(getErrorMessage(err) || 'ارسال تصویر شاخص ذخیره نشد', { duration: 10000 });
    }
  };
  return (
    <section className="space-y-2 border-t border-indigo-50 pt-2" aria-label="ارسال تصویر شاخص">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-indigo-950 flex items-center gap-2">
          <ImageIcon size={15} className="text-indigo-600" />
          ارسال تصویر شاخص: {view.enabled ? <span className="text-emerald-700">روشن</span> : <span className="text-slate-600">خاموش</span>}
        </div>
        {canManage && (view.enabled || canEnable) && (
          <SwitchButton on={view.enabled} pending={setImagePush.isPending} onClick={() => { void onSwitch(); }} />
        )}
      </div>
      {canManage && !view.enabled && canEnable && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="text-xs text-slate-700">نشانی عمومی برنامه که سایت به آن دسترسی دارد:</label>
          <input
            id={inputId}
            dir="ltr"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://"
            className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white w-72 max-w-full"
          />
        </div>
      )}
      {checked && 'error' in checked && !view.enabled && <p className="text-xs text-rose-700">{checked.error}</p>}
      {canManage && !canEnable && !view.enabled && (
        <p className="text-xs text-slate-500">روشن کردن ارسال تصویر مجوز «{keyTitle('media.manage')}» را هم می‌خواهد.</p>
      )}
      {!view.secretsReady && (
        <p className="text-xs text-amber-800">کلید رمزنگاری سرور تنظیم نشده و پیوند امضاشدهٔ تصویر ساخته نمی‌شود؛ مدیر سامانه باید آن را تنظیم کند.</p>
      )}
      <p className="text-xs text-slate-600 leading-relaxed">
        وقتی جلد کالایی در کتابخانهٔ رسانه عوض شود، نسخهٔ سبک آن تصویر شاخص محصول وصل در سایت می‌شود؛ گالری سایت دست نمی‌خورد و برداشتن جلد
        تصویری را از سایت پاک نمی‌کند. سایت تصویر را با پیوندی کوتاه‌عمر و امضاشده از همین نشانی برمی‌دارد.
        {view.enabled && view.baseUrl && <> نشانی: <bdi dir="ltr">{view.baseUrl}</bdi>.</>}
        {view.pending > 0 && ` ${formatPersianNumber(view.pending)} محصول منتظر ارسال تصویر است.`}
        {view.notRead > 0 && ` تصویر ${formatPersianNumber(view.notRead)} محصول هنوز از سایت خوانده نشده؛ «بازخوانی محصولات سایت» را بزنید.`}
      </p>
      {view.enabled && <RunLine label="آخرین ارسال تصویر" view={view} />}
      <WcItemList
        title="محصولاتی که سایت تصویر آن‌ها را چند بار پیاپی نپذیرفت"
        hint="شاید سایت تصویر WEBP نمی‌پذیرد یا به نشانی برنامه دسترسی ندارد. پس از رفع، بازخوانی شبانه دوباره امکان تلاش می‌دهد."
        rows={view.stopped} total={view.stoppedTotal} tone="rose"
      />
    </section>
  );
}

function CollectionSection({ view, canManage, canEnable }: { view: WcCollectionPushView; canManage: boolean; canEnable: boolean }) {
  const setCollectionPush = useSetWcCollectionPushMutation();
  const onSwitch = async () => {
    const enabled = !view.enabled;
    if (enabled && !(await confirmAction({
      title: 'ارسال کالکشن‌ها', message: COLLECTION_PUSH_ENABLE_CONFIRM(view.pending), confirmText: 'روشن شود', cancelText: 'انصراف',
    }))) return;
    try {
      const res = await setCollectionPush.mutateAsync(enabled);
      toast.success(res.message || (enabled ? 'ارسال کالکشن‌ها روشن شد' : 'ارسال کالکشن‌ها خاموش شد'));
    } catch (err) {
      toast.error(getErrorMessage(err) || 'ارسال کالکشن‌ها ذخیره نشد', { duration: 10000 });
    }
  };
  return (
    <section className="space-y-2 border-t border-indigo-50 pt-2" aria-label="ارسال کالکشن‌ها">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-indigo-950 flex items-center gap-2">
          <Tags size={15} className="text-indigo-600" />
          ارسال کالکشن‌ها به برچسب‌های سایت: {view.enabled ? <span className="text-emerald-700">روشن</span> : <span className="text-slate-600">خاموش</span>}
        </div>
        {canManage && (view.enabled || canEnable) && (
          <SwitchButton on={view.enabled} pending={setCollectionPush.isPending} onClick={() => { void onSwitch(); }} />
        )}
      </div>
      {canManage && !canEnable && !view.enabled && (
        <p className="text-xs text-slate-500">
          روشن کردن ارسال کالکشن‌ها مجوز «{keyTitle('media.manage')}» یا «{keyTitle('products.edit')}» را هم می‌خواهد.
        </p>
      )}
      <p className="text-xs text-slate-600 leading-relaxed">
        کالکشن‌های هر کالا برچسب محصول ساده یا مادر آن در سایت می‌شود، نه گونه‌ها. برنامه فقط برچسب‌هایی را که خودش افزوده کم یا زیاد می‌کند.
        {view.pending > 0 && ` برچسب‌های ${formatPersianNumber(view.pending)} محصول با کالکشن‌های کالا فرق دارد${view.enabled ? ' و در دقیقه‌های بعد فرستاده می‌شود' : ''}.`}
      </p>
      {view.enabled && <RunLine label="آخرین ارسال کالکشن‌ها" view={view} />}
      <WcItemList
        title="محصولاتی که سایت برچسب‌های آن‌ها را چند بار پیاپی نپذیرفت"
        hint="ارسال برچسب این محصولات تا بازخوانی شبانه بعدی متوقف است."
        rows={view.stopped} total={view.stoppedTotal} tone="rose"
      />
    </section>
  );
}

export function WcMediaPushPanel({ image, collection, canManage }: { image: WcImagePushView; collection: WcCollectionPushView; canManage: boolean }) {
  const canMedia = useHasPermission('media.manage');
  const canProductInfo = useHasAnyPermission(MEDIA_INFO_KEYS);
  return (
    <>
      <ImageSection view={image} canManage={canManage} canEnable={canManage && canMedia} />
      <CollectionSection view={collection} canManage={canManage} canEnable={canManage && canProductInfo} />
    </>
  );
}
