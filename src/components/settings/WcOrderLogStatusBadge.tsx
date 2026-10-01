import React from 'react';
import { Check, RefreshCw, AlertTriangle, Clock, Ban, Eye } from 'lucide-react';

/**
 * v7.0.30 (TD-190): برچسب وضعیت لاگ سفارش ووکامرس — هم‌راستا با WcOrderLogStatus در
 * src/services/woocommerce/wooOrderSync.service.ts
 */
const STATUS_STYLES: Record<string, { label: string; className: string; Icon: typeof Check }> = {
  processed: { label: 'فاکتور صادر شد', className: 'bg-emerald-100 text-emerald-800', Icon: Check },
  deferred: { label: 'در انتظار پرداخت', className: 'bg-sky-100 text-sky-800', Icon: Clock },
  voided: { label: 'فاکتور ابطال شد', className: 'bg-slate-200 text-slate-700', Icon: Ban },
  cancelled: { label: 'لغو پیش از فاکتور', className: 'bg-slate-100 text-slate-600', Icon: Ban },
  needs_review: { label: 'نیازمند بررسی حسابدار', className: 'bg-amber-100 text-amber-800', Icon: Eye },
  duplicate: { label: 'تکراری (نادیده گرفته شد)', className: 'bg-amber-100 text-amber-800', Icon: RefreshCw },
  failed: { label: 'خطا', className: 'bg-rose-100 text-rose-800', Icon: AlertTriangle },
};

export const WcOrderLogStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.failed;
  const { Icon } = style;
  return (
    <span className={`${style.className} text-[11px] px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1`}>
      <Icon size={12} /> {style.label}
    </span>
  );
};
