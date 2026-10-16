import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, Link2Off, MessageCircle, RefreshCw, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  LINK_CODE_TTL_MINUTES, MESSENGER_LABELS, UNLINK_REASON_LABELS,
  type LinkCodeIssued, type Messenger, type MyMessengerLink,
} from '../../lib/messenger/messengerLinks';
import {
  useIssueLinkCodeMutation, useMyMessengerLinksQuery, useRefreshMyMessengerLinks, useSendTestMessageMutation, useUnlinkMessengerMutation,
} from '../../hooks/queries/useMessengerQueries';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { formatPersianCode, formatPersianNumber } from '../../utils/persianNumber';
import { errorMessageOf } from '../../utils';
import { MessengerPreferencesList } from './MessengerPreferencesList';

/**
 * v10.1.38 (messenger notifications plan part 1, §2.2): the profile tab «پیام‌رسان». The user links their own Bale or
 * Telegram account to the staff bot with a one-time code, sends a test message and ends the link; nobody else can link
 * them. While a code is shown the state is read again every five seconds, so the card turns «وصل» once the bot got it.
 */
const RECHECK_MS = 5000;

function LinkCodeBox({ issued }: { issued: LinkCodeIssued }) {
  const label = MESSENGER_LABELS[issued.messenger];
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700 space-y-2">
      <p className="font-bold">کد اتصال شما:</p>
      <p className="text-2xl font-black text-slate-900 text-center" dir="ltr">{formatPersianCode(issued.code)}</p>
      <ol className="list-decimal pr-5 space-y-1 leading-6">
        <li>ربات {label} پاپیتال را باز کنید{issued.botUsername ? <span dir="ltr"> (@{issued.botUsername})</span> : null}.</li>
        <li>دکمه «شروع» را بزنید. اگر کد خودکار فرستاده نشد، همین کد را برای ربات بفرستید.</li>
        <li>چند لحظه بعد همین‌جا «وصل» نشان داده می‌شود.</li>
      </ol>
      <p className="text-slate-500">این کد {formatPersianNumber(LINK_CODE_TTL_MINUTES)} دقیقه اعتبار دارد و یک بار به کار می‌رود.</p>
      {issued.startLink && (
        <a
          href={issued.startLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 font-bold text-white min-h-[44px] md:min-h-0"
        >
          <ExternalLink className="w-4 h-4" />
          باز کردن ربات {label}
        </a>
      )}
    </div>
  );
}

function MessengerCard({ link, issued, onIssued }: { link: MyMessengerLink; issued: LinkCodeIssued | null; onIssued: (code: LinkCodeIssued | null) => void }) {
  const label = MESSENGER_LABELS[link.messenger];
  const issue = useIssueLinkCodeMutation();
  const test = useSendTestMessageMutation();
  const unlink = useUnlinkMessengerMutation();
  const busy = issue.isPending || test.isPending || unlink.isPending;

  const handleIssue = () => {
    issue.mutate(link.messenger, {
      onSuccess: (code) => onIssued(code),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };
  const handleTest = () => {
    test.mutate(link.messenger, {
      onSuccess: () => toast.success(`پیام آزمایشی به ${label} فرستاده شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };
  const handleUnlink = () => {
    unlink.mutate(link.messenger, {
      onSuccess: () => toast.success(`اتصال ${label} قطع شد.`),
      onError: (err) => toast.error(errorMessageOf(err)),
    });
  };

  return (
    <section aria-label={`اتصال ${label}`} className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <MessageCircle className="w-4 h-4 text-sky-600" />
          {label}
        </h3>
        {link.linked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            وصل
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">وصل نیست</span>
        )}
      </div>

      {!link.botConfigured ? (
        <p className="mt-2 text-xs leading-6 text-slate-500">ربات {label} هنوز راه‌اندازی نشده است. مدیر سامانه باید آن را در تنظیمات وارد کند.</p>
      ) : link.linked ? (
        <div className="mt-2 space-y-3 text-xs text-slate-600">
          <p className="leading-6">
            از {link.linkedAt ? formatPersianDateTime(link.linkedAt) : 'پیش‌تر'} وصل است{link.chatName ? <> به «{link.chatName}»</> : null}. اعلان‌های شما در {label} هم می‌رسد.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleTest} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 font-bold text-white disabled:opacity-50 min-h-[44px] md:min-h-0">
              <Send className="w-4 h-4" />
              پیام آزمایشی
            </button>
            <button type="button" onClick={handleUnlink} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 min-h-[44px] md:min-h-0">
              <Link2Off className="w-4 h-4" />
              قطع اتصال
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-600">
          {link.lastUnlink && (
            <p className="mb-2 leading-6 text-amber-700">
              اتصال پیشین {link.lastUnlink.at ? `در ${formatPersianDateTime(link.lastUnlink.at)} ` : ''}قطع شد: {UNLINK_REASON_LABELS[link.lastUnlink.reason]}.
            </p>
          )}
          <button type="button" onClick={handleIssue} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 font-bold text-white disabled:opacity-50 min-h-[44px] md:min-h-0">
            <Link2 className="w-4 h-4" />
            {issued ? 'کد تازه' : `اتصال به ${label}`}
          </button>
          {issued && <LinkCodeBox issued={issued} />}
        </div>
      )}
    </section>
  );
}

export function MessengerLinksPanel() {
  const query = useMyMessengerLinksQuery();
  const refresh = useRefreshMyMessengerLinks();
  const [issued, setIssued] = useState<Partial<Record<Messenger, LinkCodeIssued | null>>>({});
  const links = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  const waiting = links.some(l => !l.linked && issued[l.messenger]);

  // a shown code is read back until the bot links it; a link made clears its code
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => { void refresh(); }, RECHECK_MS);
    return () => clearInterval(id);
  }, [waiting, refresh]);
  useEffect(() => {
    if (links.some(l => l.linked && issued[l.messenger])) {
      setIssued(prev => Object.fromEntries(Object.entries(prev).filter(([m]) => !links.find(l => l.messenger === m)?.linked)));
    }
  }, [links, issued]);

  if (query.isLoading) return <p className="text-center text-xs text-slate-500 py-6">در حال بارگذاری…</p>;
  if (query.isError) {
    return (
      <div className="text-center text-xs text-rose-700 py-6 space-y-2">
        <p>وضعیت پیام‌رسان‌ها خوانده نشد.</p>
        <button type="button" onClick={() => void query.refetch()} className="inline-flex items-center gap-1 font-bold text-slate-700">
          <RefreshCw className="w-4 h-4" />
          دوباره
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-xs leading-6 text-slate-600">
        با وصل کردن بله یا تلگرام، اعلان‌هایی که برای شما در برنامه می‌آید (مثل کار تازه در کارتابل) در پیام‌رسان هم به شما می‌رسد. هیچ مبلغی در پیام فرستاده نمی‌شود.
      </p>
      {links.map(link => (
        <MessengerCard
          key={link.messenger}
          link={link}
          issued={issued[link.messenger] ?? null}
          onIssued={(code) => setIssued(prev => ({ ...prev, [link.messenger]: code }))}
        />
      ))}
      {links.some(l => l.linked) && <MessengerPreferencesList />}
    </div>
  );
}
