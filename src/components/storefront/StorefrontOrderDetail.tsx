import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, ShoppingBag } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../common/Modal';
import {
  useStorefrontOrderActionMutation, useStorefrontOrderQuery, type StorefrontOrderAction,
} from '../../hooks/queries/useStorefrontQueries';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import type { AdminOrderDetail, AdminReceipt } from '../../lib/storefront/storefrontOrderContracts';
import { REJECT_REASON_MAX, TRACKING_CODE_MAX } from '../../lib/storefront/storefrontOrderRules';
import { ORDER_STATUS_TONES, RECEIPT_STATUS_TONES } from './storefrontOrderTones';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { errorMessageOf } from '../../utils';

/**
 * v11 phase 8.2a (start plan §5): one site order for a colleague: who and where, what was sold (read from the ERP
 * document), each card-to-card receipt with «تأیید پرداخت» or «رد رسید», and the next step (cancel, ship with a tracking
 * code, deliver); 8.2b part 2: an on-account order of a buyer group gets «تأیید سفارش به حساب» instead of receipts.
 * The server decides what is allowed (`actions`) and checks it again; confirming also needs the
 * treasury and finalize keys, which the server checks and explains.
 */
const button = 'min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50';
const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base sm:text-sm';

export function StorefrontOrderDetail({ id, canManage, onClose }: { id: number; canManage: boolean; onClose: () => void }) {
  const order = useStorefrontOrderQuery(id);
  const act = useStorefrontOrderActionMutation(id);
  const data = order.data;

  const run = (action: StorefrontOrderAction, done: string, after?: () => void) => {
    if (!data) return;
    act.mutate({ action, version: data.version }, {
      onSuccess: () => { toast.success(done); after?.(); },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <Modal isOpen onClose={onClose} size="lg" icon={<ShoppingBag className="h-5 w-5" />}
      title={data ? `سفارش ${formatPersianCode(data.number)}` : 'سفارش سایت'}
      badge={data && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ORDER_STATUS_TONES[data.status]}`}>{data.statusTitle}</span>}
      subtitle={data && formatPersianDateTime(data.createdAt)}
      containerClassName="max-h-[94dvh]"
      footer={data && canManage ? <OrderSteps order={data} busy={act.isPending} run={run} /> : undefined}>
      {order.isLoading && <p className="text-sm text-slate-500">در حال خواندن…</p>}
      {order.isError && <p className="text-sm text-rose-700">{errorMessageOf(order.error)}</p>}
      {data && <OrderBody order={data} canManage={canManage} busy={act.isPending} run={run} />}
    </Modal>
  );
}

type Run = (action: StorefrontOrderAction, done: string, after?: () => void) => void;

function OrderBody({ order, canManage, busy, run }: { order: AdminOrderDetail; canManage: boolean; busy: boolean; run: Run }) {
  const rial = useRialDisplay();
  return (
    <div className="space-y-4 text-sm">
      {order.payBefore && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">کالاها تا {formatPersianDateTime(order.payBefore)} برای این سفارش نگه داشته شده‌اند.</p>}
      {order.cancelReasonTitle && <p className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{order.cancelReasonTitle}</p>}
      <BuyerBox order={order} />

      {/* v12 phase 8c (site review 2.5): the buyer, whom the customer is, when someone else receives the order */}
      {(order.orderedBy.name !== order.recipient.name || order.orderedBy.phone !== order.recipient.phone) && (
        <section aria-label="خریدار" className="space-y-1">
          <h4 className="text-xs font-black text-slate-500">خریدار</h4>
          <p className="font-bold text-slate-800">{order.orderedBy.name}</p>
          <a href={`tel:${order.orderedBy.phone}`} className="inline-flex min-h-11 items-center gap-1.5 font-bold text-sky-700" dir="ltr">
            <Phone className="h-4 w-4" />{formatPersianCode(order.orderedBy.phone)}
          </a>
        </section>
      )}
      {order.gift && (
        <p className="rounded-xl bg-violet-50 p-3 text-xs leading-6 text-violet-900">
          <span className="font-black">هدیه است:</span> قیمت روی بسته نیاید.{order.gift.message ? ` پیام کارت: ${order.gift.message}` : ''}
        </p>
      )}

      <section aria-label="گیرنده" className="space-y-1">
        <h4 className="text-xs font-black text-slate-500">گیرنده</h4>
        <p className="font-bold text-slate-800">{order.recipient.name}</p>
        <a href={`tel:${order.recipient.phone}`} className="inline-flex min-h-11 items-center gap-1.5 font-bold text-sky-700" dir="ltr">
          <Phone className="h-4 w-4" />{formatPersianCode(order.recipient.phone)}
        </a>
        <p className="text-slate-700">{order.recipient.province}، {order.recipient.city}، {order.recipient.address}</p>
        <p className="text-xs text-slate-500">کد پستی <span dir="ltr">{formatPersianCode(order.recipient.postalCode)}</span></p>
        {order.note && <p className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">یادداشت خریدار: {order.note}</p>}
      </section>

      <section aria-label="اقلام" className="space-y-2">
        <h4 className="text-xs font-black text-slate-500">اقلام</h4>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
          {order.lines.map(line => (
            <li key={`${line.sku}-${line.slug}`} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-800">{line.name}</p>
                <p className="text-xs text-slate-500"><span dir="ltr">{formatPersianCode(line.sku)}</span> · {formatPersianNumber(line.quantity)} عدد × {rial.number(line.unitPrice)}</p>
              </div>
              <span className="shrink-0 font-bold">{rial.number(line.lineAmount)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 rounded-xl bg-slate-50 p-3">
          <div className="flex justify-between"><dt className="text-slate-600">جمع کالاها</dt><dd>{rial.number(order.itemsAmount)}</dd></div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">{order.shipping.title}</dt>
            <dd>{order.shipping.kind === 'on_delivery' ? 'پس‌کرایه' : rial.number(order.shipping.amount)}</dd>
          </div>
          <div className="flex justify-between font-black"><dt>قابل پرداخت ({rial.label})</dt><dd>{rial.number(order.payableAmount)}</dd></div>
        </dl>
        <p className="text-xs text-slate-500">
          سند ERP: {order.documentRef ? <span dir="ltr">{formatPersianCode(order.documentRef)}</span> : `#${formatPersianNumber(order.documentId)}`}
          {order.documentStatus === 'voided' && ' (باطل‌شده)'}
          {order.trackingCode && <> · کد رهگیری ارسال <span dir="ltr">{order.trackingCode}</span></>}
        </p>
      </section>

      {order.paymentMethod === 'card' && (
        <section aria-label="رسیدهای کارت‌به‌کارت" className="space-y-2">
          <h4 className="text-xs font-black text-slate-500">رسیدهای کارت‌به‌کارت</h4>
          {order.receipts.length === 0 && <p className="text-xs text-slate-500">خریدار هنوز رسیدی نفرستاده است.</p>}
          {order.receipts.map(receipt => (
            <ReceiptCard key={receipt.id} receipt={receipt} payable={order.payableAmount}
              orderId={order.id} canReview={canManage && receipt.status === 'pending' && order.actions.confirm} busy={busy} run={run} />
          ))}
        </section>
      )}
    </div>
  );
}

/** v11 phase 8.2b part 2: the buyer account and group the order came with, and how it is paid */
function BuyerBox({ order }: { order: AdminOrderDetail }) {
  const rial = useRialDisplay();
  if (!order.buyer && order.paymentMethod === 'card') return null;
  return (
    <section aria-label="خریدار" className="space-y-1 rounded-xl border border-slate-200 p-3 text-xs">
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-bold text-slate-700">پرداخت: {order.paymentMethodTitle}</span>
        {order.group && <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 font-bold text-indigo-800">گروه خریدار: {order.group.title}</span>}
      </p>
      {order.buyer && <p className="text-slate-700">حساب سایت: {order.buyer.companyName ? `${order.buyer.companyName} (${order.buyer.name})` : order.buyer.name}</p>}
      {order.actions.approveOnAccount && (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
          پیش از تأیید، ماندهٔ حساب طرف حساب را در <Link to="/customers" state={{ editCustomerId: order.customerId }} className="font-bold underline">پروندهٔ طرف حساب</Link> ببینید.
          {order.group && BigInt(order.group.creditLimit || '0') > 0n && <> سقف اعتبار گروه: {rial.number(order.group.creditLimit)} {rial.label}.</>}
        </p>
      )}
    </section>
  );
}

function ReceiptCard({ receipt, orderId, payable, canReview, busy, run }: { receipt: AdminReceipt; orderId: number; payable: string; canReview: boolean; busy: boolean; run: Run }) {
  const rial = useRialDisplay();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const differs = receipt.amount !== payable;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{rial.number(receipt.amount)} <span className="text-xs text-slate-500">{rial.label}</span></span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${RECEIPT_STATUS_TONES[receipt.status]}`}>{receipt.statusTitle}</span>
      </div>
      <p className="text-xs text-slate-600">
        پیگیری <span dir="ltr">{receipt.reference}</span> · کارت ****<span dir="ltr">{formatPersianCode(receipt.cardLast4)}</span> · {formatPersianDateTime(receipt.paidAt)}
      </p>
      {receipt.hasImage && (
        <a href={`/api/storefront/orders/${orderId}/receipts/${receipt.id}/image`} target="_blank" rel="noopener noreferrer" className="block">
          <img src={`/api/storefront/orders/${orderId}/receipts/${receipt.id}/image`} alt="تصویر رسید" loading="lazy"
            className="max-h-64 w-full rounded-lg border border-slate-100 object-contain" />
        </a>
      )}
      {differs && receipt.status === 'pending' && <p className="text-xs font-bold text-rose-700">مبلغ رسید با مبلغ قابل پرداخت سفارش برابر نیست.</p>}
      {receipt.rejectReason && <p className="text-xs text-rose-700">دلیل رد: {receipt.rejectReason}</p>}
      {receipt.reviewedBy && <p className="text-xs text-slate-500">بررسی: {receipt.reviewedBy}{receipt.reviewedAt && ` · ${formatPersianDateTime(receipt.reviewedAt)}`}</p>}
      {canReview && !rejecting && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || differs} onClick={() => run({ kind: 'confirm', receiptId: receipt.id }, 'پرداخت تأیید شد و فاکتور قطعی شد.')}
            className={`${button} bg-emerald-600 text-white`}>تأیید پرداخت</button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={`${button} border border-rose-300 text-rose-700`}>رد رسید</button>
        </div>
      )}
      {canReview && rejecting && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ kind: 'reject-receipt', receiptId: receipt.id, reason }, 'رسید رد شد؛ خریدار می‌تواند رسید تازه بفرستد.', () => setRejecting(false)); }}>
          <label className="block text-xs font-bold text-slate-700" htmlFor={`reject-${receipt.id}`}>دلیل رد (خریدار آن را می‌بیند)</label>
          <textarea id={`reject-${receipt.id}`} rows={2} maxLength={REJECT_REASON_MAX} value={reason} onChange={e => setReason(e.target.value)} className={field} />
          <div className="grid grid-cols-2 gap-2">
            <button type="submit" disabled={busy || !reason.trim()} className={`${button} bg-rose-600 text-white`}>رد رسید</button>
            <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={`${button} border border-slate-300 text-slate-700`}>انصراف</button>
          </div>
        </form>
      )}
    </div>
  );
}

function OrderSteps({ order, busy, run }: { order: AdminOrderDetail; busy: boolean; run: Run }) {
  const [tracking, setTracking] = useState(order.trackingCode);
  const [cancelling, setCancelling] = useState(false);
  const next = order.actions.fulfil;
  if (!next && !order.actions.cancel && !order.actions.approveOnAccount) return null;
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
      {order.actions.approveOnAccount && !cancelling && (
        <button type="button" disabled={busy} onClick={() => run({ kind: 'approve-on-account' }, 'سفارش به حساب تأیید شد و فاکتور قطعی شد.')}
          className={`${button} bg-emerald-600 text-white`}>تأیید سفارش به حساب</button>
      )}
      {next === 'shipped' && (
        <form className="flex w-full flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); run({ kind: 'fulfil', status: 'shipped', trackingCode: tracking }, 'سفارش ارسال‌شده ثبت شد.'); }}>
          <label className="w-full text-xs font-bold text-slate-700">
            کد رهگیری مرسوله (اختیاری)
            <input value={tracking} maxLength={TRACKING_CODE_MAX} onChange={e => setTracking(e.target.value)} dir="ltr" className={`${field} mt-1`} />
          </label>
          <button type="submit" disabled={busy} className={`${button} shrink-0 bg-sky-600 text-white`}>ثبت ارسال</button>
        </form>
      )}
      {next === 'delivered' && (
        <button type="button" disabled={busy} onClick={() => run({ kind: 'fulfil', status: 'delivered', trackingCode: order.trackingCode }, 'تحویل سفارش ثبت شد.')}
          className={`${button} bg-violet-600 text-white`}>ثبت تحویل</button>
      )}
      {order.actions.cancel && !cancelling && (
        <button type="button" disabled={busy} onClick={() => setCancelling(true)} className={`${button} border border-rose-300 text-rose-700`}>لغو سفارش</button>
      )}
      {order.actions.cancel && cancelling && (
        <div className="flex w-full flex-col gap-2 rounded-xl bg-rose-50 p-3 sm:w-auto">
          <p className="text-xs font-bold text-rose-800">پیش‌فاکتور باطل و کالاها آزاد می‌شوند. لغو شود؟</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => run({ kind: 'cancel' }, 'سفارش لغو شد.', () => setCancelling(false))} className={`${button} bg-rose-600 text-white`}>بله، لغو شود</button>
            <button type="button" disabled={busy} onClick={() => setCancelling(false)} className={`${button} border border-slate-300 text-slate-700`}>نه</button>
          </div>
        </div>
      )}
    </div>
  );
}
