import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useStorefrontProductsQuery } from '../../hooks/queries/useStorefrontQueries';
import { CAMPAIGN_PRODUCTS_MAX } from '../../lib/storefront/storefrontCampaignRules';
import { formatPersianNumber } from '../../utils/persianNumber';
import { formatPersianCode } from '../../utils';

/**
 * v11 phase 8.5b: the chosen items of a campaign page, in the order the page shows them. An item is found by its code or
 * name; one that is not on the site yet may be chosen and shows once it is published.
 */
export interface ChosenProduct { itemId: number; code: string; name: string }

const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base sm:text-sm';

export function StorefrontCampaignProducts({ chosen, onChange }: { chosen: ChosenProduct[]; onChange: (next: ChosenProduct[]) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const products = useStorefrontProductsQuery({ page: 1, q, published: 'all' });
  const full = chosen.length >= CAMPAIGN_PRODUCTS_MAX;
  const move = (from: number, to: number) => {
    const next = [...chosen];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-q`} className="mb-1 block text-xs font-bold text-slate-700">
        {`محصولات صفحه (${formatPersianNumber(chosen.length)} از حداکثر ${formatPersianNumber(CAMPAIGN_PRODUCTS_MAX)})`}
      </label>
      <input id={`${id}-q`} autoComplete="off" className={field} placeholder="کد یا نام کالا" value={q} disabled={full} onChange={e => setQ(e.target.value)} />
      {q.trim() && !full && (
        <ul className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm">
          {(products.data?.data ?? []).filter(p => !chosen.some(c => c.itemId === p.itemId)).slice(0, 12).map(p => (
            <li key={p.itemId}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-slate-50"
                onClick={() => { onChange([...chosen, { itemId: p.itemId, code: p.code, name: p.name }]); setQ(''); }}>
                <span>{p.name} <bdi dir="ltr" className="text-xs text-slate-500">{formatPersianCode(p.code)}</bdi></span>
                {!p.published && <span className="text-xs text-amber-700">منتشرنشده</span>}
              </button>
            </li>
          ))}
          {products.data && products.data.data.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">کالایی پیدا نشد.</li>}
        </ul>
      )}
      {chosen.length > 0 && (
        <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {chosen.map((c, i) => (
            <li key={c.itemId} className="flex items-center gap-1 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {c.name || 'کالا'} <bdi dir="ltr" className="text-xs text-slate-500">{formatPersianCode(c.code)}</bdi>
              </span>
              <button type="button" aria-label={`بالاتر بردن ${c.name}`} disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded-lg p-2.5 text-slate-500 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label={`پایین‌تر بردن ${c.name}`} disabled={i === chosen.length - 1} onClick={() => move(i, i + 1)} className="rounded-lg p-2.5 text-slate-500 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label={`برداشتن ${c.name}`} onClick={() => onChange(chosen.filter(x => x.itemId !== c.itemId))} className="rounded-lg p-2.5 text-rose-600"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
