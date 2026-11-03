import type { StorefrontStock } from '@erp/storefront/storefrontContracts';
import { STOCK_STATUS_TITLES } from '@erp/storefront/storefrontRules';
import { faNumber } from '../lib/format';

const TONE = {
  in_stock: 'bg-card text-success border-success/30',
  low: 'bg-brand-soft text-brand border-brand/30',
  out: 'bg-muted text-muted-foreground border-border',
} as const;

/** «موجود»، «تعداد کم» or «ناموجود»; the count only when the ERP settings show it (it is null otherwise) */
export function StockBadge({ stock, className = '' }: { stock: StorefrontStock; className?: string }) {
  const count = stock.quantity !== null && stock.status !== 'out' ? `، ${faNumber(stock.quantity)} عدد` : '';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-6 ${TONE[stock.status]} ${className}`}>
      {STOCK_STATUS_TITLES[stock.status]}{count}
    </span>
  );
}
