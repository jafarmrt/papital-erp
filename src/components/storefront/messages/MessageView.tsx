import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Eye, RotateCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeleteMessageMutation, useMessageStatusMutation } from '../../../hooks/queries/useStorefrontMessageQueries';
import type { MessageDetail } from '../../../lib/storefront/storefrontMessageContracts';
import { MESSAGE_STATUS_TITLES, type MessageAnswer, type MessageStatus } from '../../../lib/storefront/storefrontMessageRules';
import { errorMessageOf, formatPersianDate } from '../../../utils';
import { formatPersianDateTime } from '../../../utils/dateUtils';
import { formatPersianCode } from '../../../utils/persianNumber';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): one message of the site: every answer under its
 * field's name as the visitor wrote it (plain text, never read as anything else), its state, and for a holder of
 * `site_messages.manage` the state to give it and its removal. A new message opened by such a holder becomes
 * «دیده‌شده» by itself, once.
 */
const STATUS_TONES: Readonly<Record<MessageStatus, string>> = { new: 'bg-sky-50 text-sky-800', seen: 'bg-slate-100 text-slate-700', answered: 'bg-emerald-50 text-emerald-800' };
export const statusChip = (status: MessageStatus) => `rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONES[status]}`;
const action = 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-40';

/** An answer as the screen shows it: a day in the Jalali calendar, a number or a phone in Persian digits, anything else as written */
function AnswerValue({ answer }: { answer: MessageAnswer }) {
  if (answer.value === '') return <span className="text-slate-400">نوشته نشده</span>;
  if (answer.kind === 'date') return <span>{formatPersianDate(answer.value)}</span>;
  if (answer.kind === 'mobile' || answer.kind === 'number') return <span dir="ltr">{formatPersianCode(answer.value)}</span>;
  if (answer.kind === 'email') return <span dir="ltr">{answer.value}</span>;
  return <span className="whitespace-pre-line break-words">{answer.value}</span>;
}

export function MessageView({ detail, canManage, onBack, onDeleted }: { detail: MessageDetail; canManage: boolean; onBack: () => void; onDeleted: () => void }) {
  const turn = useMessageStatusMutation(detail.id);
  const remove = useDeleteMessageMutation();
  const [asking, setAsking] = useState(false);
  const busy = turn.isPending || remove.isPending;
  const answers = Array.isArray(detail.answers) ? detail.answers : [];

  // a request started from a button or a second click runs once (AGENTS.md §6.4)
  const sending = useRef(false);
  const setStatus = (status: MessageStatus, quiet = false) => {
    if (sending.current || !canManage) return;
    sending.current = true;
    turn.mutate({ status, version: detail.version }, {
      onSuccess: () => { if (!quiet) toast.success(`پیام «${MESSAGE_STATUS_TITLES[status]}» شد.`); },
      onError: (err) => { if (!quiet) toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  // opened by someone who handles the messages: a new message is seen, once for this opening
  const seenOnce = useRef(false);
  const markSeen = useEffectEvent(() => {
    if (seenOnce.current || !canManage || detail.status !== 'new') return;
    seenOnce.current = true;
    setStatus('seen', true);
  });
  useEffect(() => { markSeen(); }, [detail.id]);

  const removeMessage = () => {
    setAsking(false);
    if (sending.current) return;
    sending.current = true;
    remove.mutate({ id: detail.id, version: detail.version }, {
      onSuccess: () => { toast.success('پیام حذف شد.'); onDeleted(); },
      onError: err => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (asking) confirmation.current?.focus(); }, [asking]);

  return (
    <article aria-label="پیام سایت" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
          <ArrowRight className="h-4 w-4" />
          همهٔ پیام‌ها
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-black text-slate-800">{`پیام فرم «${detail.formTitle}»`}</h2>
        <span className={statusChip(detail.status)}>{MESSAGE_STATUS_TITLES[detail.status]}</span>
      </div>
      <p className="text-xs text-slate-500">
        {`شمارهٔ پیام ${formatPersianCode(detail.id)}، رسیده در ${formatPersianDateTime(detail.createdAt)}`}
        {detail.statusBy && `؛ آخرین رسیدگی: ${detail.statusBy}${detail.statusAt ? `، ${formatPersianDateTime(detail.statusAt)}` : ''}`}
      </p>

      <dl aria-label="پاسخ‌های فرم" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {answers.map((answer, index) => (
          <div key={index} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-xs font-bold text-slate-600">{answer.label}</dt>
            <dd className="text-sm text-slate-800"><AnswerValue answer={answer} /></dd>
          </div>
        ))}
      </dl>

      {detail.leadId !== null && (
        <p className="text-xs text-slate-600">
          این پیام یک پروندهٔ فروش هم ساخته است:{' '}
          <Link to={`/crm?leadId=${detail.leadId}`} className="font-bold text-violet-700 underline underline-offset-4">دیدن پروندهٔ فروش</Link>
        </p>
      )}

      {canManage && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={action} disabled={busy || detail.status === 'answered'} onClick={() => setStatus('answered')}>
              <Check className="h-4 w-4" />
              پاسخ داده شد
            </button>
            <button type="button" className={action} disabled={busy || detail.status === 'seen'} onClick={() => setStatus('seen')}>
              <Eye className="h-4 w-4" />
              دیده‌شده
            </button>
            <button type="button" className={action} disabled={busy || detail.status === 'new'} onClick={() => setStatus('new')}>
              <RotateCcw className="h-4 w-4" />
              برگرداندن به تازه
            </button>
            <button type="button" className={`${action} border-rose-200 text-rose-700`} disabled={busy} onClick={() => setAsking(true)}>
              <Trash2 className="h-4 w-4" />
              حذف پیام
            </button>
          </div>
          {asking && (
            <div ref={confirmation} tabIndex={-1} role="group" aria-label="تأیید حذف پیام" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="min-w-0 flex-1">{`این پیام از فهرست برداشته می‌شود و دیگر دیده نمی‌شود.${detail.leadId !== null ? ' پروندهٔ فروشی که ساخته است می‌ماند.' : ''}`}</p>
              <button type="button" disabled={busy} onClick={removeMessage} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50">بله، حذف شود</button>
              <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
