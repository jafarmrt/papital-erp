import { WC_UNMATCHED_REASON_LABELS, type WcCatalogItem, type WcUnmatchedProduct } from '../../lib/woocommerce/wcCatalog';
import { formatPersianCode, formatPersianNumber } from '../../utils';

/** 10.2 package 6 (D-04 part A): what the catalog refresh and the stock push left for a person to look at */

export function MoreRow({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <li className="text-slate-500">و {formatPersianNumber(total - shown)} مورد دیگر</li>;
}

export function ListBox({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="bg-white border border-slate-200 rounded-lg p-3 text-xs">
      <summary className="font-bold text-slate-800 cursor-pointer">{title}</summary>
      <p className="text-slate-500 mt-2 leading-relaxed">{hint}</p>
      <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto">{children}</ul>
    </details>
  );
}

export function WcUnmatchedList({ rows, total }: { rows: WcUnmatchedProduct[]; total: number }) {
  if (total === 0) return null;
  return (
    <ListBox
      title={`محصولات سایت بی کالای متناظر (${formatPersianNumber(total)})`}
      hint="موجودی این محصولات از برنامه فرستاده نمی‌شود. شناسه محصول (SKU) را در سایت با کد کالا در برنامه یکی کنید و دوباره بازخوانی کنید."
    >
      {rows.map(row => (
        <li key={`${row.productId}-${row.variationId}`} className="flex flex-wrap gap-x-2">
          <span className="font-medium text-slate-800">{row.name || `محصول ${formatPersianCode(row.productId)}`}</span>
          {row.sku && <span dir="ltr" className="font-mono text-slate-600">{row.sku}</span>}
          <span className="text-amber-700">{WC_UNMATCHED_REASON_LABELS[row.reason]}</span>
        </li>
      ))}
      <MoreRow shown={rows.length} total={total} />
    </ListBox>
  );
}

export function WcItemList({ title, hint, rows, total, tone }: {
  title: string; hint: string; rows: WcCatalogItem[]; total: number; tone: 'slate' | 'rose';
}) {
  if (total === 0) return null;
  return (
    <ListBox title={`${title} (${formatPersianNumber(total)})`} hint={hint}>
      {rows.map(row => (
        <li key={row.itemId} className="flex flex-wrap gap-x-2">
          <span dir="ltr" className="font-mono text-slate-600">{row.code}</span>
          <span className="font-medium text-slate-800">{row.name}</span>
          {row.error && <span className={tone === 'rose' ? 'text-rose-700' : 'text-slate-500'}>{row.error}</span>}
        </li>
      ))}
      <MoreRow shown={rows.length} total={total} />
    </ListBox>
  );
}
