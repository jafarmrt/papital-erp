import { useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { errorMessageOf } from '../../../utils';
import { useMovePageMutation } from '../../../hooks/queries/useStorefrontPageQueries';
import { PAGE_SLUG_MAX } from '../../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10c: «تغییر نشانی» of a page that is on the site. A draft save never moves such a page; this asks for the
 * new address and sends it under the version the screen has read. The server sends the old address on to the new one,
 * so links made before keep working. It waits for a screen with nothing unsaved, like «انتشار».
 */
export function PageAddressMove({ pageId, slug, version, blocked, onMoved, onFailed }: {
  pageId: number; slug: string; version: number;
  /** why the address cannot be changed now ('' = it can): unsaved edits, or a newer copy not yet read */
  blocked: string;
  /** the move was sent: the editor takes the answer as its own change; and it failed */
  onMoved: () => void;
  onFailed: () => void;
}) {
  const id = useId();
  const move = useMovePageMutation(pageId);
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState('');
  const sending = useRef(false);
  const next = wanted.trim();
  const submit = () => {
    if (sending.current || blocked || !next || next === slug) return;
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
      <button type="button" onClick={() => { setWanted(slug); setOpen(true); }} className="mt-1 text-xs font-bold text-sky-800 underline-offset-4 hover:underline">
        تغییر نشانی
      </button>
    );
  }
  return (
    <div role="group" aria-label="تغییر نشانی صفحه" className="mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p>
        این صفحه روی سایت است. با تغییر نشانی، نشانی کنونی (<bdi dir="ltr">/pages/{slug}</bdi>) برای همیشه به نشانی تازه منتقل می‌شود تا پیوندهای پیشین کار کنند.
      </p>
      <label htmlFor={`${id}-new`} className="block font-bold">نشانی لاتین تازه</label>
      <input
        id={`${id}-new`} dir="ltr" className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm" maxLength={PAGE_SLUG_MAX}
        value={wanted} onChange={e => setWanted(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {blocked && <p className="font-bold">{blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={move.isPending || Boolean(blocked) || !next || next === slug} onClick={submit} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50">
          نشانی عوض شود
        </button>
        <button type="button" disabled={move.isPending} onClick={() => setOpen(false)} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
      </div>
    </div>
  );
}
