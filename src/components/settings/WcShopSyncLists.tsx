import { WC_PRICE_SKIP_LABELS, type WcDriftRow, type WcPriceSkipRow } from '../../lib/woocommerce/wcShopSync';
import { formatPersianNumber } from '../../utils';
import { ListBox, MoreRow } from './WcCatalogLists';

/** 10.2 package 6 (D-04 part C): the prices not sent and the differences the nightly re-read found */

const shown = (v: string | null) => (v === null || v === '' ? 'ندارد' : formatPersianNumber(Number(v)));

export function WcPriceSkipList({ rows, total }: { rows: WcPriceSkipRow[]; total: number }) {
  if (total === 0) return null;
  return (
    <ListBox
      title={`کالاهایی که قیمتشان به سایت فرستاده نمی‌شود (${formatPersianNumber(total)})`}
      hint="قیمت این محصولات در سایت دست نمی‌خورد. علت هر کدام کنار آن آمده است."
    >
      {rows.map(row => (
        <li key={row.itemId} className="flex flex-wrap gap-x-2">
          <span dir="ltr" className="font-mono text-slate-600">{row.code}</span>
          <span className="font-medium text-slate-800">{row.name}</span>
          <span className="text-amber-700">{WC_PRICE_SKIP_LABELS[row.reason]}</span>
        </li>
      ))}
      <MoreRow shown={rows.length} total={total} />
    </ListBox>
  );
}

export function WcDriftList({ rows, total }: { rows: WcDriftRow[]; total: number }) {
  if (total === 0) return null;
  return (
    <ListBox
      title={`ناهمخوانی‌های سایت و برنامه در بازخوانی شبانه (${formatPersianNumber(total)})`}
      hint="عدد سایت با آنچه برنامه فرستاده یا می‌فرستد یکی نبود. اگر ارسال خودکار همان مورد روشن باشد، در دور بعد درست می‌شود."
    >
      {rows.map(row => (
        <li key={`${row.itemId}-${row.kind}`} className="flex flex-wrap gap-x-2">
          <span dir="ltr" className="font-mono text-slate-600">{row.code}</span>
          <span className="font-medium text-slate-800">{row.name}</span>
          <span className="text-amber-700">
            {row.kind === 'stock' ? 'موجودی' : 'قیمت عادی'} در سایت {shown(row.site)}، در برنامه {shown(row.program)}
          </span>
        </li>
      ))}
      <MoreRow shown={rows.length} total={total} />
    </ListBox>
  );
}
