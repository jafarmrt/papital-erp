import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { voucherPrimaryAction } from '../../../lib/accounting/voucherRowActions';

/** v10.0.121 (TD-1120): دکمه اصلی ردیف سند؛ «قفل دفاتر» فقط برای سند دائم (استخراج‌شده از JournalVouchersTab) */
export function VoucherPrimaryActionCell({ status, onApprove, onFinalize }: {
  status: string;
  onApprove?: () => void;
  onFinalize?: () => void;
}) {
  const action = voucherPrimaryAction(status, { canApprove: Boolean(onApprove), canFinalize: Boolean(onFinalize) });
  if (action === 'approve' && onApprove) {
    return (
      <button
        onClick={onApprove}
        title="تایید حسابداری سند و انتقال به دفاتر رسمی"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60 rounded-lg border border-blue-200 dark:border-blue-800 transition cursor-pointer shadow-xs"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
        <span>تایید سند</span>
      </button>
    );
  }
  if (action === 'finalize' && onFinalize) {
    return (
      <button
        onClick={onFinalize}
        title="قطعی‌سازی و قفل سند در دفاتر رسمی"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 rounded-lg border border-emerald-200 dark:border-emerald-800 transition cursor-pointer shadow-xs"
      >
        <Lock className="w-3.5 h-3.5 text-emerald-600" />
        <span>قطعی‌سازی</span>
      </button>
    );
  }
  if (action === 'locked') {
    return (
      <span
        title="سند دائم در دفاتر کل قفل است و تغییر مستقیم نمی‌پذیرد"
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60"
      >
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        <span>قفل دفاتر</span>
      </span>
    );
  }
  return null;
}
