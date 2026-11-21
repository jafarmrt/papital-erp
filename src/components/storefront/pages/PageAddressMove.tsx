import { useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { errorMessageOf } from '../../../utils';
import type { useMovePageMutation } from '../../../hooks/queries/useStorefrontPageQueries';
import { PAGE_SLUG_MAX, RESERVED_PAGE_SLUG_MESSAGE, isReservedPageSlug } from '../../../lib/storefront/storefrontPageRules';
import { STOREFRONT_SLUG_PATTERN } from '../../../lib/storefront/storefrontRules';

/**
 * v12 phase 10c: «تغییر نشانی» of a page that is on the site. A draft save never moves such a page; this asks for the
 * new address and sends it under the version the screen has read. The server sends the old address on to the new one,
 * so links made before keep working. It waits for a screen with nothing unsaved, like «انتشار». The editor owns the
 * request (`move`), so it is closed while the request is on its way.
 */
export function PageAddressMove({ move, slug, version, blocked, onMoved, onFailed }: {
  move: ReturnType<typeof useMovePageMutation>; slug: string; version: number;
  /** why the address cannot be changed now ('' = it can): unsaved edits, or a newer copy not yet read */
  blocked: string;
  /** the move was sent: the editor takes the answer as its own change; and it failed */
  onMoved: () => void;
  onFailed: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState('');
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const focusIn = useRef<'page' | 'step'>('page');
  const wasPending = useRef(false);
  // the step takes the focus when it opens and gives it back to its button when it closes; after a move that waits
  // until the editor is open again (a button inside a closed editor cannot take the focus)
  useEffect(() => {
    if (open && focusIn.current === 'page') {
      input.current?.focus();
      focusIn.current = 'step';
    } else if (!open && focusIn.current === 'step' && !move.isPending) {
      opener.current?.focus();
      focusIn.current = 'page';
    }
    // a move that failed leaves the step open: the focus goes back to its field once the editor is open again
    if (open && wasPending.current && !move.isPending) input.current?.focus();
    wasPending.current = move.isPending;
  }, [open, move.isPending]);

  const next = wanted.trim();
  const shape = !next || next === slug ? ''
    : isReservedPageSlug(next) ? RESERVED_PAGE_SLUG_MESSAGE
      : !STOREFRONT_SLUG_PATTERN.test(next) ? 'فقط حرف کوچک انگلیسی، رقم و خط تیره میان کلمه‌ها، مانند our-story.' : '';
  const reason = blocked || shape;
  const submit = () => {
    if (sending.current || reason || !next || next === slug) return;
    sending.current = true;
    onMoved();
    move.mutate({ slug: next, version }, {
      onSuccess: () => {
        toast.success('نشانی صفحه عوض شد و نشانی پیشین به آن منتقل می‌شود.');
        setOpen(false);
        setWanted('');
      },
      onError: (err) => { onFailed(); toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  if (!open) {
    return (
      <button ref={opener} type="button" onClick={() => { setWanted(slug); setOpen(true); }} className="mt-1 text-xs font-bold text-sky-800 underline-offset-4 hover:underline">
        تغییر نشانی
      </button>
    );
  }
  return (
    <div role="group" aria-label="تغییر نشانی صفحه" className="mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p>
        این صفحه روی سایت است. با تغییر نشانی، نشانی کنونی (<bdi dir="ltr">/pages/{slug}</bdi>) برای همیشه به نشانی تازه منتقل می‌شود تا پیوندهای پیشین کار کنند.
        اگر نشانی تازه پیش‌تر به جای دیگری منتقل می‌شد، آن انتقال برداشته می‌شود.
      </p>
      <label htmlFor={`${id}-new`} className="block font-bold">نشانی لاتین تازه</label>
      <input
        ref={input} id={`${id}-new`} dir="ltr" className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm" maxLength={PAGE_SLUG_MAX}
        aria-describedby={reason ? `${id}-reason` : undefined} aria-invalid={shape ? true : undefined}
        value={wanted} onChange={e => setWanted(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {reason && <p id={`${id}-reason`} className="font-bold">{reason}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button" disabled={move.isPending || Boolean(reason) || !next || next === slug} aria-describedby={reason ? `${id}-reason` : undefined} onClick={submit}
          className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50"
        >
          نشانی عوض شود
        </button>
        <button type="button" disabled={move.isPending} onClick={() => setOpen(false)} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
      </div>
    </div>
  );
}
