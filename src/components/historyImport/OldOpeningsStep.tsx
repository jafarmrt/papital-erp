import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { OldOpeningList, OldOpeningWithdrawResult } from '../../lib/historyImport/oldOpening';
import { errorMessageOf, formatPersianCode, formatPersianNumber, isoToJalaliDate } from '../../utils';

/**
 * v11 history import, tool 8 (1405 replay): the first step of the stock import. The opening stock entered earlier through
 * the item form (dated the day the item was defined, with a draft opening voucher) is listed and, once the user chooses,
 * taken back: the opening rows get a reversal on their own day and the draft voucher is deleted, so the replay can enter
 * the stock of 1 Farvardin and every movement after it. An item with other movements or an approved voucher is listed
 * with the reason and left alone.
 */
export function OldOpeningsStep() {
  const queryClient = useQueryClient();
  const [list, setList] = useState<OldOpeningList | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<OldOpeningWithdrawResult | null>(null);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<OldOpeningList>('/inventory/history-import/old-openings');
      setList(res);
      setChosen(new Set(res.items.filter(i => i.withdrawable).map(i => i.itemId)));
    } catch (err) {
      setError(errorMessageOf(err) || 'فهرست خوانده نشد.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (busy || chosen.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<OldOpeningWithdrawResult>('/inventory/history-import/old-openings/withdraw', { method: 'POST', body: JSON.stringify({ itemIds: [...chosen] }) });
      setDone(res);
      for (const key of [QUERY_KEYS.items.all, QUERY_KEYS.inventory.all, QUERY_KEYS.transactions.all]) void queryClient.invalidateQueries({ queryKey: key });
      setList(await fetchJson<OldOpeningList>('/inventory/history-import/old-openings'));
      setChosen(new Set());
    } catch (err) {
      setError(errorMessageOf(err) || 'سرور پاسخ نداد؛ دوباره تلاش کنید.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number, on: boolean) => setChosen(prev => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const withdrawable = list?.items.filter(i => i.withdrawable) ?? [];
  const blocked = list?.items.filter(i => !i.withdrawable) ?? [];

  return (
    <section className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2 text-xs text-slate-700 dark:text-slate-200">
      <h3 className="font-bold">گام اول: برداشتن موجودی اولیهٔ قبلی</h3>
      <p>موجودی اولیه‌ای که پیش‌تر هنگام تعریف کالا ثبت شده، تاریخ همان روز را دارد و جلوی ثبت گردش‌های فروردین به بعد را می‌گیرد. پیش از ورود ماه اول، این موجودی‌ها را بردارید: ردیف‌های کاردکسشان در همان روز برگشت می‌خورد و سند افتتاحیهٔ پیش‌نویسشان حذف می‌شود. کالایی که گردش دیگری دارد یا سند افتتاحیه‌اش تأیید شده دست نمی‌خورد.</p>
      {error && <p role="alert" className="font-bold text-rose-600 whitespace-pre-line">{error}</p>}
      {done && <p className="font-bold text-emerald-700">موجودی اولیهٔ {formatPersianNumber(done.items)} کالا برداشته شد و {formatPersianNumber(done.vouchers)} سند افتتاحیهٔ پیش‌نویس حذف شد.</p>}
      {!list && (
        <button type="button" className="rounded-lg border border-amber-300 px-3 py-1 font-bold" disabled={busy} onClick={() => { void load(); }}>
          {busy ? 'در حال خواندن…' : 'نمایش موجودی‌های اولیهٔ قبلی'}
        </button>
      )}
      {list && list.items.length === 0 && <p>هیچ موجودی اولیه‌ای در کاردکس نیست؛ می‌توانید پرونده را انتخاب کنید.</p>}
      {withdrawable.length > 0 && (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-slate-500"><th className="w-6"></th><th className="text-right">کالا</th><th className="text-right">مقدار</th><th className="text-right">ارزش (ریال)</th><th className="text-right">تاریخ</th><th className="text-right">سند</th></tr></thead>
            <tbody>
              {withdrawable.map(i => (
                <tr key={i.itemId}>
                  <td><input type="checkbox" aria-label={`برداشتن ${i.name}`} checked={chosen.has(i.itemId)} onChange={e => toggle(i.itemId, e.target.checked)} /></td>
                  <td>{i.name} ({formatPersianCode(i.code)})</td>
                  <td>{formatPersianNumber(Number(i.quantity))} {i.unit}</td>
                  <td>{formatPersianNumber(Number(i.value))}</td>
                  <td>{formatPersianCode(isoToJalaliDate(i.day))}</td>
                  <td>{i.vouchers.map(v => formatPersianCode(v.number)).join('، ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {blocked.length > 0 && (
        <details>
          <summary className="cursor-pointer">{formatPersianNumber(blocked.length)} کالا برداشته نمی‌شود</summary>
          <ul className="list-disc pr-4 text-[11px]">
            {blocked.map(i => <li key={i.itemId}>{i.name} ({formatPersianCode(i.code)}): {i.reason}</li>)}
          </ul>
        </details>
      )}
      {withdrawable.length > 0 && (
        <button type="button" className="rounded-lg bg-amber-600 text-white px-3 py-1 font-bold disabled:opacity-50" disabled={busy || chosen.size === 0} onClick={() => { void withdraw(); }}>
          {busy ? 'در حال برداشتن…' : `برداشتن موجودی اولیهٔ ${formatPersianNumber(chosen.size)} کالا`}
        </button>
      )}
    </section>
  );
}
