import { useId, useState } from 'react';
import { Copy, KeyRound, MessageCircle, Phone, Handshake } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../common/Modal';
import { useBuyerActionMutation, useBuyerQuery, type BuyerAction } from '../../hooks/queries/useStorefrontBuyerQueries';
import type { BuyerAccountDetail, PasswordLinkAnswer } from '../../lib/storefront/storefrontBuyerContracts';
import { setPasswordLinkOf } from '../../lib/storefront/storefrontBuyerRules';
import { BuyerStatusChip } from './BuyerStatusChip';
import { formatPersianCode } from '../../utils/persianNumber';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';

/**
 * v11 phase 8.2b (start plan §6): one buyer account of the site for a colleague: who they are, their wholesale request,
 * and the next step. Approving needs a buyer group and a customer (the one with the same phone, or a new one); it ends
 * any sign-in the account had and answers a one-time set-password link, shown once here to be sent to the buyer on
 * WhatsApp or copied. The server decides and checks every step again.
 */
const button = 'min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50';
const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base sm:text-sm';

export function StorefrontBuyerDetail({ id, canManage, onClose }: { id: number; canManage: boolean; onClose: () => void }) {
  const buyer = useBuyerQuery(id);
  const act = useBuyerActionMutation(id);
  const [link, setLink] = useState<PasswordLinkAnswer | null>(null);
  const data = buyer.data;

  const run = (action: BuyerAction, done: string) => {
    if (!data) return;
    act.mutate({ action, version: data.version }, {
      onSuccess: (answer) => {
        toast.success(done);
        if (answer && 'token' in answer) setLink(answer);
      },
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <Modal isOpen onClose={onClose} size="lg" icon={<Handshake className="h-5 w-5" />}
      title={data ? (data.companyName || data.name) : 'خریدار سایت'}
      badge={data && <BuyerStatusChip status={data.status} application={data.applicationStatus} />}
      subtitle={data && `از ${formatPersianDateTime(data.createdAt)}`}
      containerClassName="max-h-[94dvh]"
      footer={data && canManage ? <BuyerSteps buyer={data} busy={act.isPending} run={run} /> : undefined}>
      {buyer.isLoading && <p className="text-sm text-slate-500">در حال خواندن…</p>}
      {buyer.isError && <p className="text-sm text-rose-700">{errorMessageOf(buyer.error)}</p>}
      {link && <PasswordLinkBox answer={link} />}
      {data && <BuyerBody buyer={data} canManage={canManage} busy={act.isPending} run={run} />}
    </Modal>
  );
}

type Run = (action: BuyerAction, done: string) => void;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-end text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function BuyerBody({ buyer, canManage, busy, run }: { buyer: BuyerAccountDetail; canManage: boolean; busy: boolean; run: Run }) {
  const needsReview = buyer.applicationStatus === 'pending' || buyer.applicationStatus === 'declined';
  return (
    <div className="space-y-4 text-sm">
      <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4">
        <Row label="نام">{buyer.name}</Row>
        {buyer.phone && (
          <Row label="شمارهٔ همراه">
            <a href={`tel:${buyer.phone}`} dir="ltr" className="inline-flex items-center gap-1 font-bold text-violet-700"><Phone className="h-3.5 w-3.5" />{formatPersianCode(buyer.phone)}</a>
          </Row>
        )}
        {buyer.email && <Row label="ایمیل"><a href={`mailto:${buyer.email}`} dir="ltr" className="font-bold text-violet-700">{buyer.email}</a></Row>}
        {buyer.companyName && <Row label="فروشگاه یا شرکت">{buyer.companyName}</Row>}
        {buyer.city && <Row label="شهر">{buyer.city}</Row>}
        {buyer.nationalId && <Row label="شناسهٔ ملی">{formatPersianCode(buyer.nationalId)}</Row>}
        {buyer.economicCode && <Row label="کد اقتصادی">{formatPersianCode(buyer.economicCode)}</Row>}
        {buyer.groupTitle && <Row label="گروه خریدار">{buyer.groupTitle}</Row>}
        {buyer.customerName && <Row label="طرف حساب">{buyer.customerName}</Row>}
        {buyer.appliedAt && <Row label="زمان درخواست">{formatPersianDateTime(buyer.appliedAt)}</Row>}
        {buyer.reviewedBy && <Row label="بررسی">{buyer.reviewedBy}{buyer.reviewedAt ? `، ${formatPersianDateTime(buyer.reviewedAt)}` : ''}</Row>}
        <Row label="رمز">{buyer.hasPassword ? 'گذاشته شده' : 'هنوز ندارد'}</Row>
        {buyer.phone && <Row label="تأیید شماره">{buyer.phoneVerified ? 'با پیامک تأیید شده' : 'با پیامک تأیید نشده'}</Row>}
        {buyer.email && <Row label="تأیید ایمیل">{buyer.emailVerified ? 'با کد ایمیلی تأیید شده' : 'تأیید نشده'}</Row>}
        {buyer.passwordLinkExpiresAt && <Row label="پیوند تعیین رمز">تا {formatPersianDateTime(buyer.passwordLinkExpiresAt)}</Row>}
        {buyer.lastLoginAt && <Row label="آخرین ورود">{formatPersianDateTime(buyer.lastLoginAt)}</Row>}
        {buyer.lockedUntil && <Row label="قفل ورود">تا {formatPersianDateTime(buyer.lockedUntil)}</Row>}
      </dl>
      {buyer.applicationNote && <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-700">{buyer.applicationNote}</p>}
      {canManage && (needsReview || buyer.applicationStatus === 'approved') && <GroupForm buyer={buyer} busy={busy} run={run} />}
    </div>
  );
}

function GroupForm({ buyer, busy, run }: { buyer: BuyerAccountDetail; busy: boolean; run: Run }) {
  const id = useId();
  const approving = buyer.applicationStatus !== 'approved';
  const [groupId, setGroupId] = useState<number>(buyer.groupId ?? 0);
  const [customerId, setCustomerId] = useState<number>(buyer.customerId ?? buyer.customerMatches[0]?.id ?? 0);
  const options = buyer.groupOptions;

  const submit = async () => {
    if (!groupId) { toast.error('گروه خریدار را انتخاب کنید.'); return; }
    if (approving) {
      const ok = await confirmAction({
        title: 'تأیید خرید عمده',
        message: 'اگر این حساب رمز یا ورود داشته باشد، پاک می‌شود و خریدار با پیوند تازه رمز می‌گذارد. پیوند را فقط به همین شماره بفرستید.',
        confirmText: 'تأیید',
      });
      if (!ok) return;
    }
    run({ kind: approving ? 'approve' : 'group', groupId, customerId }, approving ? 'خریدار تأیید شد؛ پیوند تعیین رمز را برایش بفرستید.' : 'گروه خریدار عوض شد.');
  };

  return (
    <form aria-label={approving ? 'تأیید خرید عمده' : 'تغییر گروه خریدار'} className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/40 p-4"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3 className="text-sm font-black text-slate-800">{approving ? 'تأیید خرید عمده' : 'گروه و طرف حساب'}</h3>
      <div>
        <label htmlFor={`${id}-group`} className="mb-1 block text-xs font-bold text-slate-700">گروه خریدار</label>
        <select id={`${id}-group`} className={field} value={groupId} onChange={e => setGroupId(Number(e.target.value))}>
          <option value={0}>انتخاب کنید</option>
          {options.map(g => <option key={g.id} value={g.id}>{g.title}{g.isActive ? '' : ' (خاموش)'}</option>)}
        </select>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-bold text-slate-700">طرف حساب در ERP</legend>
        {[...(buyer.customerId && !buyer.customerMatches.some(m => m.id === buyer.customerId) ? [{ id: buyer.customerId, name: buyer.customerName, city: '' }] : []), ...buyer.customerMatches].map(m => (
          <label key={m.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
            <input type="radio" name={`${id}-customer`} checked={customerId === m.id} onChange={() => setCustomerId(m.id)} />
            <span>{m.name}{m.city ? ` · ${m.city}` : ''}</span>
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
          <input type="radio" name={`${id}-customer`} checked={customerId === 0} onChange={() => setCustomerId(0)} />
          <span>طرف حساب تازه با نام «{buyer.companyName || buyer.name}»</span>
        </label>
      </fieldset>
      <button type="submit" disabled={busy} className={`${button} w-full bg-violet-700 text-white sm:w-auto`}>{approving ? 'تأیید و ساختن پیوند رمز' : 'ذخیرهٔ گروه'}</button>
    </form>
  );
}

function BuyerSteps({ buyer, busy, run }: { buyer: BuyerAccountDetail; busy: boolean; run: Run }) {
  const ask = async (title: string, message: string, action: BuyerAction, done: string) => {
    if (await confirmAction({ title, message, confirmText: title })) run(action, done);
  };
  return (
    <div className="flex w-full flex-wrap gap-2">
      {buyer.applicationStatus === 'pending' && (
        <button type="button" disabled={busy} className={`${button} border border-rose-200 text-rose-700`}
          onClick={() => { void ask('رد درخواست', 'درخواست خرید عمدهٔ این خریدار رد شود؟', { kind: 'decline' }, 'درخواست رد شد.'); }}>رد درخواست</button>
      )}
      {buyer.status === 'active' && (
        <button type="button" disabled={busy} className={`${button} border border-slate-300 text-slate-700`}
          onClick={() => { void ask('پیوند تازهٔ رمز', 'پیوند تازه ساخته شود؟ پیوندهای پیشین دیگر کار نمی‌کنند.', { kind: 'password-link' }, 'پیوند تازه ساخته شد.'); }}>
          <KeyRound className="me-1 inline h-4 w-4" />پیوند تازهٔ رمز
        </button>
      )}
      {buyer.status === 'active' && (
        <button type="button" disabled={busy} className={`${button} border border-slate-300 text-slate-700`}
          onClick={() => { void ask('تعلیق حساب', 'حساب معلق شود؟ خریدار از سایت بیرون می‌رود و تا فعال شدن دوباره نمی‌تواند وارد شود.', { kind: 'suspend' }, 'حساب معلق شد.'); }}>تعلیق</button>
      )}
      {buyer.status === 'suspended' && (
        <button type="button" disabled={busy} className={`${button} bg-slate-900 text-white`} onClick={() => run({ kind: 'reactivate' }, 'حساب دوباره فعال شد.')}>فعال کردن دوباره</button>
      )}
    </div>
  );
}

function PasswordLinkBox({ answer }: { answer: PasswordLinkAnswer }) {
  const url = setPasswordLinkOf(answer.token);
  const message = `سلام. برای گذاشتن رمز حساب خرید عمدهٔ پاپیتال این پیوند را باز کنید (تا ${formatPersianDateTime(answer.expiresAt)} و فقط یک بار کار می‌کند):\n${url}`;
  const whatsapp = `https://wa.me/98${answer.account.phone.replace(/^0/, '')}?text=${encodeURIComponent(message)}`;
  const copy = () => {
    navigator.clipboard.writeText(url).then(() => toast.success('پیوند کپی شد.'), () => toast.error('کپی نشد؛ پیوند را دستی بردارید.'));
  };
  return (
    <div role="status" className="mb-4 space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-black text-emerald-800">پیوند تعیین رمز (فقط همین یک بار نشان داده می‌شود)</p>
      <p dir="ltr" className="break-all rounded-xl bg-white p-2 text-xs text-slate-700">{url}</p>
      <div className="flex flex-wrap gap-2">
        {answer.account.phone && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${button} inline-flex items-center gap-1 bg-emerald-600 text-white`}>
            <MessageCircle className="h-4 w-4" />فرستادن در واتس‌اپ
          </a>
        )}
        <button type="button" onClick={copy} className={`${button} inline-flex items-center gap-1 border border-emerald-300 text-emerald-800`}>
          <Copy className="h-4 w-4" />کپی پیوند
        </button>
      </div>
    </div>
  );
}
