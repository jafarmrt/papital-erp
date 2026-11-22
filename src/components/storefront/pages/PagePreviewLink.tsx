import { useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Eye, ExternalLink } from 'lucide-react';
import { errorMessageOf, formatPersianDateTime } from '../../../utils';
import { copyToClipboard } from '../../../utils/clipboard';
import { usePagePreviewMutation } from '../../../hooks/queries/useStorefrontPageQueries';
import type { PagePreviewLink as Link } from '../../../lib/storefront/storefrontPageContracts';

/**
 * v12 phase 10c: «پیش‌نمایش»: asks the server for a one-hour link on the site that shows the page's saved draft, and
 * shows that link to open or copy. The link's key is only in this answer (the server keeps its hash), so it is held on
 * this screen and nowhere else; making a new link ends the earlier one. It shows the draft as saved, so it waits for a
 * screen with nothing unsaved.
 */
export function PagePreviewLink({ pageId, blocked }: {
  pageId: number;
  /** why no link can be made now ('' = it can): unsaved edits, or a newer version of the page not yet read */
  blocked: string;
}) {
  const make = usePagePreviewMutation(pageId);
  const [link, setLink] = useState<Link | null>(null);
  const sending = useRef(false);
  const reasonId = useId();
  const ask = () => {
    if (sending.current || blocked) return;
    sending.current = true;
    make.mutate(undefined, {
      onSuccess: setLink,
      onError: (err) => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };
  const copy = () => {
    if (!link) return;
    // without a secure context the browser has no clipboard: the link stays on the screen to be taken by hand
    void copyToClipboard(link.url).then(done => (done ? toast.success('پیوند پیش‌نمایش کپی شد.') : toast.error('کپی نشد؛ پیوند را از همین‌جا بردارید.')));
  };
  return (
    <div className="space-y-2">
      <button
        type="button" disabled={make.isPending || Boolean(blocked)} aria-describedby={blocked ? reasonId : undefined} onClick={ask}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
      >
        <Eye className="h-4 w-4" />
        {make.isPending ? 'در حال ساختن پیوند…' : 'پیش‌نمایش روی سایت'}
      </button>
      {blocked && <p id={reasonId} className="text-xs text-slate-500">{blocked}</p>}
      {/* a screen reader hears that the link is there; the link itself is in the group below */}
      <p role="status" className="sr-only">{link ? 'پیوند پیش‌نمایش ساخته شد.' : ''}</p>
      {link && (
        <div role="group" aria-label="پیوند پیش‌نمایش" className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          <p>
            {`این پیوند تا ${formatPersianDateTime(link.expiresAt)} پیش‌نویس ذخیره‌شدهٔ همین صفحه را روی سایت نشان می‌دهد. هر کس پیوند را داشته باشد آن را می‌بیند؛ ساختن پیوند تازه، این یکی را از کار می‌اندازد.`}
          </p>
          {!link.addressSet && (
            <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
              «نشانی فروشگاه سایت» در «جست‌وجو و آمار» نوشته نشده است، پس این پیوند با دامنهٔ اصلی ساخته شد. اگر سایت تازه هنوز روی دامنهٔ اصلی نیست، این پیوند آنجا باز نمی‌شود؛ نخست آن نشانی را بنویسید و پیوند تازه بسازید.
            </p>
          )}
          <p dir="ltr" className="break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] text-slate-700">{link.url}</p>
          <div className="flex flex-wrap gap-2">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-sky-800 px-3 py-1.5 font-bold text-white">
              <ExternalLink className="h-3.5 w-3.5" />
              باز کردن پیش‌نمایش
            </a>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 font-bold">
              <Copy className="h-3.5 w-3.5" />
              کپی پیوند
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
